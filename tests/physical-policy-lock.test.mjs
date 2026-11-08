import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { parse } from 'yaml';
import { policyHash, validatePhysicalPolicies, PROTECTED_POLICY_HASHES } from '../tools/quality/physical-policy-lock.mjs';
import { rebuildDesignSnapshot } from '../tools/rebuild-design-snapshot.mjs';

const design = resolve('design_snapshot');
const readYaml = path => parse(readFileSync(resolve(design, path), 'utf8'));
const configPath = 'configs/storage/physical_capacity_policies.yaml';
const config = readYaml(configPath);
const lock = JSON.parse(readFileSync('tools/quality/rules/physical-policy-lock.json', 'utf8'));
const loadOrder = readYaml('configs/active_stage_1A/load_order.yaml').load_order;
const loadedPaths = loadOrder.map(entry => relative(design, resolve(design, 'configs/active_stage_1A', entry)).split(sep).join('/'));
const definitions = loadedPaths.filter(path => path.startsWith('configs/materials/') || path.startsWith('configs/farming/seeds/')).map(readYaml);
const initial = readYaml('configs/initial_world/stage_1A_initial_world.yaml');
const containerIds = initial.storage_containers.map(item => item.container_id);
const clone = value => structuredClone(value);
const check = (c = config, l = lock) => validatePhysicalPolicies(c, l, definitions, containerIds);

function withNewPolicy(change) {
  const c = clone(config), l = clone(lock);
  const added = clone(c.policies.find(policy => policy.id === 'physical-stage1a-v1'));
  added.id = 'physical-stage1a-test-v2';
  change(added);
  c.policies.push(added);
  l.policies[added.id] = policyHash(added);
  c.default_policy_id = added.id;
  return { c, l, added };
}

test('active defaults, every loaded material form and initial container are validated', () => {
  assert.deepEqual(check(), { policyCount: config.policies.length, defaultPolicyId: config.default_policy_id });
  for (const id of ['cabbage', 'salt', 'cooking_oil', 'ginger', 'bacon', 'cabbage_seed'])
    assert.ok(definitions.some(definition => definition.id === id));
  assert.deepEqual(Object.keys(config.initial_container_limits).sort(), [...containerIds].sort());
  assert.equal(PROTECTED_POLICY_HASHES['physical-stage1a-v1'], 'b21e750f503127664e4ca0bc5f7e69de46dd95b21ca849b500722951603aea2b', 'v1 policy is immutable; add a new policy ID instead');
  assert.equal(lock.policies['physical-stage1a-v1'], PROTECTED_POLICY_HASHES['physical-stage1a-v1']);
});

test('same version cannot change coefficient, even if its lock entry is overwritten', () => {
  const changed = clone(config);
  const v1 = changed.policies.find(policy => policy.id === 'physical-stage1a-v1');
  v1.rules[0].volume_ul_per_unit.numerator += 1;
  assert.throws(() => check(changed), /ERR_PHYSICAL_POLICY_HASH_MISMATCH:physical-stage1a-v1/);
  const rewrittenLock = clone(lock);
  rewrittenLock.policies['physical-stage1a-v1'] = policyHash(v1);
  assert.throws(() => check(changed, rewrittenLock), /ERR_PHYSICAL_POLICY_LOCK_REWRITTEN:physical-stage1a-v1/);
  delete rewrittenLock.policies['physical-stage1a-v1'];
  assert.throws(() => check(changed, rewrittenLock), /ERR_PHYSICAL_POLICY_LOCK_REWRITTEN:physical-stage1a-v1/);
});

test('new version and appended lock can change values while retaining the original version', () => {
  const { c, l } = withNewPolicy(policy => { policy.rules[0].volume_ul_per_unit.numerator += 1; });
  assert.deepEqual(check(c, l), { policyCount: 2, defaultPolicyId: 'physical-stage1a-test-v2' });
  assert.ok(c.policies.some(policy => policy.id === 'physical-stage1a-v1'));
  assert.throws(() => check(c, lock), /ERR_PHYSICAL_POLICY_HASH_MISMATCH:physical-stage1a-test-v2/);
});

test('existing locked policy cannot be removed, and policy rule order is not semantic', () => {
  const c = clone(config);
  const v1 = c.policies.find(policy => policy.id === 'physical-stage1a-v1');
  v1.rules.reverse();
  assert.equal(policyHash(v1), policyHash(config.policies.find(policy => policy.id === 'physical-stage1a-v1')));
  assert.doesNotThrow(() => check(c));
  c.policies = [];
  assert.throws(() => check(c), /ERR_PHYSICAL_POLICY_REMOVED:physical-stage1a-v1/);
});

test('a separately locked new default still requires every active material, form and unit', () => {
  const { c, l } = withNewPolicy(policy => { policy.rules = policy.rules.filter(rule => !(rule.definition_id === 'cabbage' && rule.form === 'fresh')); });
  assert.throws(() => check(c, l), /ERR_PHYSICAL_RULE_MISSING:cabbage:fresh/);
  const missingDish = withNewPolicy(policy => { policy.rules = policy.rules.filter(rule => !(rule.kind === 'DishLot' && rule.form === 'dish')); });
  assert.throws(() => check(missingDish.c, missingDish.l), /ERR_PHYSICAL_DISH_RULE_MISSING:dish/);
});

test('policy cannot default to missing or duplicate policy IDs or contain invalid rates', () => {
  const c = clone(config); c.default_policy_id = 'not-registered';
  assert.throws(() => check(c), /ERR_PHYSICAL_DEFAULT_POLICY_MISSING/);
  const duplicate = clone(config); duplicate.policies.push(clone(duplicate.policies[0]));
  assert.throws(() => check(duplicate), /ERR_PHYSICAL_POLICY_DUPLICATE_OR_INVALID/);
  const bad = withNewPolicy(policy => { policy.rules[0].mass_mg_per_unit.denominator = 0; });
  assert.throws(() => check(bad.c, bad.l), /ERR_PHYSICAL_RATE_INVALID/);
});

test('initial container limits are complete, finite, positive and physically representable', () => {
  for (const value of [0, -1, Infinity, NaN, 0.0001, Number.MAX_SAFE_INTEGER]) {
    const c = clone(config); c.initial_container_limits[containerIds[0]].mass_g = value;
    assert.throws(() => check(c), /ERR_PHYSICAL_INITIAL_LIMITS_INVALID/);
  }
  const valid = clone(config); valid.initial_container_limits[containerIds[0]].mass_g = 1.001;
  assert.doesNotThrow(() => check(valid));
  delete valid.initial_container_limits[containerIds[0]];
  assert.throws(() => check(valid), /ERR_PHYSICAL_INITIAL_LIMITS_INVALID/);
  const extra = clone(config); extra.initial_container_limits.unregistered = { mass_g: 1, volume_ml: 1 };
  assert.throws(() => check(extra), /ERR_PHYSICAL_UNKNOWN_INITIAL_CONTAINER/);
});

test('active load order and generated snapshot include the exact physical policy source', () => {
  assert.ok(loadedPaths.includes(configPath));
  const snapshot = JSON.parse(readFileSync(resolve(design, 'generated/stage_1A_runtime_snapshot.json'), 'utf8'));
  assert.deepEqual(snapshot.loaded_documents[configPath], config);
  assert.doesNotThrow(() => rebuildDesignSnapshot(design, { check: true }));
});
