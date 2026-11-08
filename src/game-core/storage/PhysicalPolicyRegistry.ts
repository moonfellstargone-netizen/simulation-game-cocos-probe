import { calculatePhysicalCapacity, type PhysicalPolicy } from './PhysicalCapacity';

/** Version identities are persisted in saves; historical policies must never be replaced. */
export class PhysicalPolicyRegistry {
  private readonly policies = new Map<string, PhysicalPolicy>();

  constructor(policies: readonly PhysicalPolicy[]) {
    for (const input of policies) {
      calculatePhysicalCapacity({ policy_id: input.id, policy: input, containers: [], occupants: [] });
      if (this.policies.has(input.id)) throw new Error(`ERR_PHYSICAL_POLICY_DUPLICATE:${input.id}`);
      const copy: PhysicalPolicy = {
        id: input.id,
        rules: input.rules.map(rule => Object.freeze({ ...rule,
          mass_mg_per_unit: Object.freeze({ ...rule.mass_mg_per_unit }),
          volume_ul_per_unit: Object.freeze({ ...rule.volume_ul_per_unit }) }))
      };
      Object.freeze(copy.rules);
      this.policies.set(copy.id, Object.freeze(copy));
    }
  }

  resolve(id: string): PhysicalPolicy {
    const policy = this.policies.get(id);
    if (!policy) throw new Error(`ERR_PHYSICAL_POLICY_MISSING:${id}`);
    return policy;
  }
}
