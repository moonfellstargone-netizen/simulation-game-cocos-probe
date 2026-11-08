import { createHash } from 'node:crypto';

// Existing protected versions are append-only. Never edit a hash for an existing ID:
// add a new policy ID and new pin for any balance change.
export const PROTECTED_POLICY_HASHES = Object.freeze({
  'physical-stage1a-v1': 'b21e750f503127664e4ca0bc5f7e69de46dd95b21ca849b500722951603aea2b'
});

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const identity = rule => JSON.stringify([rule.kind, rule.definition_id, rule.form, rule.quantity_unit]);

export function policyHash(policy) {
  if (!policy || typeof policy !== 'object' || !Array.isArray(policy.rules)) throw new Error('ERR_PHYSICAL_POLICY_INVALID');
  const copy = { ...policy, rules: [...policy.rules].sort((a, b) => identity(a) < identity(b) ? -1 : identity(a) > identity(b) ? 1 : 0) };
  return createHash('sha256').update(JSON.stringify(canonical(copy))).digest('hex');
}

const cleanId = value => typeof value === 'string' && value.length > 0 && value.trim() === value;
const positiveFinite = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
function hasSafeThousandth(value) {
  if (!positiveFinite(value)) return false;
  const [mantissa, exponentText] = value.toString().toLowerCase().split('e');
  const [whole, decimal = ''] = mantissa.split('.');
  const exponent = Number(exponentText ?? '0') - decimal.length + 3;
  const digits = BigInt(`${whole}${decimal}`);
  const denominator = exponent < 0 ? 10n ** BigInt(-exponent) : 1n;
  const numerator = exponent >= 0 ? digits * 10n ** BigInt(exponent) : digits;
  return numerator % denominator === 0n && numerator / denominator <= BigInt(Number.MAX_SAFE_INTEGER);
}

/** Build-time check. The caller must pass parsed source configuration, never a rewritten snapshot. */
export function validatePhysicalPolicies(config, lock, definitions, containerIds) {
  if (!config || !cleanId(config.default_policy_id) || !Array.isArray(config.policies)
      || !config.initial_container_limits || typeof config.initial_container_limits !== 'object' || Array.isArray(config.initial_container_limits))
    throw new Error('ERR_PHYSICAL_CONFIG_INVALID');
  if (!lock || lock.format !== 'physical-policy-lock/v1' || !lock.policies || typeof lock.policies !== 'object' || Array.isArray(lock.policies))
    throw new Error('ERR_PHYSICAL_POLICY_LOCK_INVALID');
  for (const [id, expected] of Object.entries(PROTECTED_POLICY_HASHES)) {
    if (lock.policies[id] !== expected) throw new Error(`ERR_PHYSICAL_POLICY_LOCK_REWRITTEN:${id}`);
  }
  const policies = new Map();
  for (const policy of config.policies) {
    if (!cleanId(policy?.id) || !Array.isArray(policy.rules) || policies.has(policy.id)) throw new Error('ERR_PHYSICAL_POLICY_DUPLICATE_OR_INVALID');
    const keys = new Set();
    for (const rule of policy.rules) {
      if (!rule || !['MaterialLot', 'DishLot'].includes(rule.kind) || !cleanId(rule.definition_id) || !cleanId(rule.form)
          || !['g', 'ml', 'count', 'serving'].includes(rule.quantity_unit)) throw new Error('ERR_PHYSICAL_RULE_INVALID');
      const key = identity(rule);
      if (keys.has(key)) throw new Error('ERR_PHYSICAL_RULE_DUPLICATE');
      keys.add(key);
      for (const rate of [rule.mass_mg_per_unit, rule.volume_ul_per_unit]) {
        if (!rate || !Number.isSafeInteger(rate.numerator) || rate.numerator <= 0
            || !Number.isSafeInteger(rate.denominator) || rate.denominator <= 0) throw new Error('ERR_PHYSICAL_RATE_INVALID');
      }
    }
    const hash = policyHash(policy);
    if (lock.policies[policy.id] !== hash) throw new Error(`ERR_PHYSICAL_POLICY_HASH_MISMATCH:${policy.id}`);
    policies.set(policy.id, keys);
  }
  for (const id of Object.keys(lock.policies)) if (!policies.has(id)) throw new Error(`ERR_PHYSICAL_POLICY_REMOVED:${id}`);
  const active = policies.get(config.default_policy_id);
  if (!active) throw new Error('ERR_PHYSICAL_DEFAULT_POLICY_MISSING');
  for (const def of definitions) {
    if (!def || !cleanId(def.id) || !cleanId(def.base_unit) || !def.forms || typeof def.forms !== 'object')
      throw new Error('ERR_PHYSICAL_DEFINITION_INVALID');
    for (const form of Object.keys(def.forms)) {
      if (!active.has(identity({ kind: 'MaterialLot', definition_id: def.id, form, quantity_unit: def.base_unit })))
        throw new Error(`ERR_PHYSICAL_RULE_MISSING:${def.id}:${form}`);
    }
  }
  for (const form of ['cooked_dish', 'dish']) {
    if (!active.has(identity({ kind: 'DishLot', definition_id: 'bacon_cabbage', form, quantity_unit: 'g' })))
      throw new Error(`ERR_PHYSICAL_DISH_RULE_MISSING:${form}`);
  }
  if (!Array.isArray(containerIds) || !containerIds.length || new Set(containerIds).size !== containerIds.length)
    throw new Error('ERR_PHYSICAL_INITIAL_CONTAINERS_INVALID');
  for (const id of containerIds) {
    if (!cleanId(id)) throw new Error('ERR_PHYSICAL_INITIAL_CONTAINERS_INVALID');
    const limits = config.initial_container_limits[id];
    if (!limits || !hasSafeThousandth(limits.mass_g) || !hasSafeThousandth(limits.volume_ml))
      throw new Error(`ERR_PHYSICAL_INITIAL_LIMITS_INVALID:${id}`);
  }
  for (const id of Object.keys(config.initial_container_limits)) {
    if (!containerIds.includes(id)) throw new Error(`ERR_PHYSICAL_UNKNOWN_INITIAL_CONTAINER:${id}`);
  }
  return { policyCount: policies.size, defaultPolicyId: config.default_policy_id };
}
