import type { ConfigRepository } from '../config/ConfigRepository';
import type { DishLot, Order, SaveFile, SubmittedObjectRef } from '../domain/types';

export interface DemandRequirement {
  type: 'property' | 'field' | 'tag' | 'defect' | 'source' | 'form' | 'category';
  key: string;
  max_value?: number;
  min_value?: number;
  target_range?: number[];
  weight?: number;
  scoring_curve?: string;
  source_object_field?: string;
}

export interface DemandProfileConfig {
  id: string;
  demand_profile_id: string;
  display_name_key: string;
  issuer_npc_id?: string;
  accepted_object_types: string[];
  hard_requirements?: DemandRequirement[];
  weighted_requirements?: DemandRequirement[];
  forbidden_defects?: string[];
  acceptable_defects?: Record<string, string>;
  match_threshold: number;
  reward_rules?: {
    base_money?: number;
    score_bonus_per_10_over_threshold?: number;
    reputation_delta_on_success?: number;
    currency_id?: string;
  };
  explanation_keys?: Record<string, string>;
}

export interface DemandResolution {
  accepted: boolean;
  match_score: number;
  reward_money: number;
  reputation_delta: number;
  reason_code: string;
}

export class DemandResolver {
  constructor(private readonly configs: ConfigRepository) {}

  submitOrder(save: SaveFile, orderId: string, submittedRefs: SubmittedObjectRef[]): DemandResolution {
    const order = save.orders.find((item) => item.order_id === orderId);
    if (!order) throw new Error(`ERR_ORDER_NOT_FOUND:${orderId}`);
    if (order.status !== 'available') throw new Error('ERR_ORDER_NOT_AVAILABLE');
    const profile = this.resolveDemandProfile(order.demand_profile_id);
    const ref = submittedRefs[0];
    if (!ref) throw new Error('ERR_SUBMITTED_OBJECT_MISSING');
    if (!profile.accepted_object_types.includes(ref.object_type)) throw new Error('ERR_SUBMITTED_OBJECT_TYPE_UNSUPPORTED');
    if (ref.object_type !== 'DishLot') throw new Error('ERR_SUBMITTED_OBJECT_TYPE_UNSUPPORTED');
    const dish = save.dish_lots.find((item) => item.dish_lot_id === ref.object_id);
    if (!dish) throw new Error(`ERR_DISH_LOT_NOT_FOUND:${ref.object_id}`);
    const resolution = this.resolve(profile, dish, order);
    if (!resolution.accepted) throw new Error(resolution.reason_code);

    order.status = 'completed';
    order.submitted_object_refs = submittedRefs.map((item) => ({ ...item }));
    order.result_summary = {
      match_score: resolution.match_score,
      reward_final: resolution.reward_money,
      submitted_count: dish.serving_count,
      result_key: resolution.reason_code
    };
    const playerState = save.player_state as { money?: number; reputation_map?: Record<string, number> };
    playerState.money = Number(playerState.money ?? 0) + resolution.reward_money;
    if (!playerState.reputation_map) playerState.reputation_map = {};
    playerState.reputation_map.west_market_tavern = Number(playerState.reputation_map.west_market_tavern ?? 0) + resolution.reputation_delta;
    save.dish_lots = save.dish_lots.filter((item) => item.dish_lot_id !== ref.object_id);
    return resolution;
  }

  resolve(profile: DemandProfileConfig, dish: DishLot, order?: Order): DemandResolution {
    for (const hard of profile.hard_requirements ?? []) {
      if (!this.requirementPasses(hard, dish)) {
        return { accepted: false, match_score: 0, reward_money: 0, reputation_delta: 0, reason_code: this.reasonForHardRequirement(hard) };
      }
    }
    for (const defect of profile.forbidden_defects ?? []) {
      if ((dish.defects ?? []).includes(defect)) {
        return { accepted: false, match_score: 0, reward_money: 0, reputation_delta: 0, reason_code: 'ERR_DEMAND_REJECTED_DEFECT' };
      }
    }

    const weighted = profile.weighted_requirements ?? [];
    const totalWeight = weighted.reduce((sum, requirement) => sum + Number(requirement.weight ?? 1), 0) || 1;
    let weightedScore = 0;
    for (const requirement of weighted) {
      weightedScore += this.scoreRequirement(requirement, dish) * Number(requirement.weight ?? 1);
    }
    let score = Math.round(weightedScore / totalWeight);
    for (const defect of dish.defects ?? []) {
      const tolerance = profile.acceptable_defects?.[defect];
      if (tolerance === 'minor_penalty') score -= 8;
      if (tolerance === 'medium_penalty') score -= 15;
      if (tolerance === undefined) score -= 20;
    }
    score = Math.max(0, Math.min(100, score));
    const threshold = Number(order?.match_threshold ?? profile.match_threshold);
    const accepted = score >= threshold;
    const rewardRules = profile.reward_rules ?? {};
    const baseMoney = Number(order?.base_reward ?? rewardRules.base_money ?? 0);
    const bonusPer10 = Number(rewardRules.score_bonus_per_10_over_threshold ?? 0);
    const reward = accepted ? baseMoney + Math.max(0, Math.floor((score - threshold) / 10) * bonusPer10) : 0;
    return {
      accepted,
      match_score: score,
      reward_money: reward,
      reputation_delta: accepted ? Number(rewardRules.reputation_delta_on_success ?? 0) : 0,
      reason_code: accepted ? 'OK_DEMAND_ACCEPTED' : 'ERR_DEMAND_SCORE_TOO_LOW'
    };
  }

  resolveDemandProfile(demandProfileId: string): DemandProfileConfig {
    for (const [path, document] of Object.entries(this.configs.loadStage1A().documents)) {
      if (!path.startsWith('configs/demands/')) continue;
      if (!document || typeof document !== 'object') continue;
      const profile = document as Partial<DemandProfileConfig>;
      if (profile.id === demandProfileId || profile.demand_profile_id === demandProfileId) return profile as DemandProfileConfig;
    }
    throw new Error(`ERR_DEMAND_PROFILE_NOT_FOUND:${demandProfileId}`);
  }

  private requirementPasses(requirement: DemandRequirement, dish: DishLot): boolean {
    const value = this.readRequirementValue(requirement, dish);
    if (requirement.type === 'tag') return dish.suitability_tags.includes(requirement.key);
    if (requirement.type === 'defect') return !(dish.defects ?? []).includes(requirement.key);
    if (typeof value !== 'number') return false;
    if (typeof requirement.max_value === 'number' && value > requirement.max_value) return false;
    if (typeof requirement.min_value === 'number' && value < requirement.min_value) return false;
    return true;
  }

  private scoreRequirement(requirement: DemandRequirement, dish: DishLot): number {
    if (requirement.type === 'tag') return dish.suitability_tags.includes(requirement.key) ? 100 : 0;
    if (requirement.type === 'defect') return (dish.defects ?? []).includes(requirement.key) ? 0 : 100;
    const value = this.readRequirementValue(requirement, dish);
    if (typeof value !== 'number') return 0;
    if (typeof requirement.min_value === 'number' && value < requirement.min_value) return 0;
    if (typeof requirement.max_value === 'number' && value > requirement.max_value) return 0;
    if (Array.isArray(requirement.target_range) && requirement.target_range.length >= 2) {
      const min = Number(requirement.target_range[0]);
      const max = Number(requirement.target_range[1]);
      if (value >= min && value <= max) return 100;
      const distance = value < min ? min - value : value - max;
      return Math.max(0, 100 - distance * 4);
    }
    return 100;
  }

  private readRequirementValue(requirement: DemandRequirement, dish: DishLot): number | string | boolean | undefined {
    if (requirement.type === 'property') return dish.dish_profile[requirement.key];
    if (requirement.type === 'field') {
      if (requirement.source_object_field === 'DishLot.serving_count' || requirement.key === 'serving_count') return dish.serving_count;
      if (requirement.key === 'total_quantity') return dish.total_quantity.amount;
    }
    return undefined;
  }

  private reasonForHardRequirement(requirement: DemandRequirement): string {
    if (requirement.type === 'property' && requirement.key === 'safety_risk') return 'ERR_DEMAND_REJECTED_SAFETY';
    return 'ERR_DEMAND_HARD_REQUIREMENT_FAILED';
  }
}
