import type {
  ProbeCommand, ProbeFieldOption, ProbeHarvestableOption, ProbeMaterialOption, ProbeMenuSnapshot
} from './ProbeLifetime';

export interface ProbeFarmingView {
  readonly fieldOptions: readonly ProbeFieldOption[];
  readonly seedOptions: readonly ProbeMaterialOption[];
  readonly harvestableOptions: readonly ProbeHarvestableOption[];
  readonly materialOptions: readonly ProbeMaterialOption[];
  readonly selectedFieldId: string | null;
  readonly selectedSeedId: string | null;
  readonly selectedCropId: string | null;
  readonly seedAmount: number;
  readonly canPlant: boolean;
  readonly canHarvest: boolean;
}

// Local selection state consumes public observations; it never owns or changes game state.
export class ProbeFarming {
  private fields: readonly ProbeFieldOption[] = [];
  private seeds: readonly ProbeMaterialOption[] = [];
  private crops: readonly ProbeHarvestableOption[] = [];
  private materials: readonly ProbeMaterialOption[] = [];
  private fieldId: string | null = null;
  private seedId: string | null = null;
  private cropId: string | null = null;
  private seedAmount = 1;

  refresh(menu: ProbeMenuSnapshot): void {
    const selectable = menu.selectable_view_model;
    this.fields = structuredClone(selectable?.field_options ?? []);
    this.seeds = structuredClone(selectable?.seed_lot_options ?? []);
    this.crops = structuredClone(selectable?.harvestable_crop_options ?? []);
    this.materials = structuredClone(selectable?.splittable_lot_options ?? []);
    this.fieldId = this.enabled(this.fields, this.fieldId)?.id ?? null;
    this.seedId = this.enabled(this.seeds, this.seedId)?.id ?? null;
    this.cropId = this.enabled(this.crops, this.cropId)?.id ?? null;
  }

  selectNextField(): void {
    this.fieldId = this.next(this.fields, this.fieldId);
  }

  selectNextSeed(): void {
    const next = this.next(this.seeds, this.seedId);
    if (next !== this.seedId) this.seedAmount = 1;
    this.seedId = next;
  }

  selectNextCrop(): void {
    this.cropId = this.next(this.crops, this.cropId);
  }

  adjustSeedAmount(delta: number): void {
    if (!Number.isSafeInteger(delta)) return;
    const next = Math.max(1, this.seedAmount + delta);
    if (Number.isSafeInteger(next)) this.seedAmount = next;
  }

  plantCommand(): ProbeCommand | null {
    const field = this.enabled(this.fields, this.fieldId);
    const seed = this.enabled(this.seeds, this.seedId);
    if (!field || !seed || !Number.isSafeInteger(this.seedAmount) || this.seedAmount < 1) return null;
    return { name: 'menu_confirm', selection: {
      action_type: 'plant_crop', field_option_id: field.id, seed_lot_option_id: seed.id,
      seed_quantity: { amount: this.seedAmount, unit: seed.quantity.unit }
    } };
  }

  harvestCommand(): ProbeCommand | null {
    const crop = this.enabled(this.crops, this.cropId);
    return crop ? { name: 'menu_confirm', selection: { action_type: 'harvest_crop', crop_option_id: crop.id } } : null;
  }

  status(): ProbeFarmingView {
    return structuredClone({
      fieldOptions: this.fields, seedOptions: this.seeds, harvestableOptions: this.crops,
      materialOptions: this.materials, selectedFieldId: this.fieldId, selectedSeedId: this.seedId,
      selectedCropId: this.cropId, seedAmount: this.seedAmount,
      canPlant: this.plantCommand() !== null, canHarvest: this.harvestCommand() !== null
    });
  }

  private enabled<T extends { readonly id: string; readonly enabled: boolean }>(options: readonly T[], id: string | null): T | undefined {
    return options.find((option) => option.id === id && option.enabled);
  }

  private next(options: readonly { readonly id: string; readonly enabled: boolean }[], id: string | null): string | null {
    const available = options.filter((option) => option.enabled);
    if (available.length === 0) return null;
    const index = available.findIndex((option) => option.id === id);
    return available[(index + 1) % available.length].id;
  }
}
