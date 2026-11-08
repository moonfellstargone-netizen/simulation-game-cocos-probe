import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePhysicalCapacity, type PhysicalContainer, type PhysicalOccupant, type PhysicalPolicy } from '../src/game-core/storage/PhysicalCapacity';

// All values here are test assumptions, not approved game balance or measured agricultural data.
const rate = (numerator: number, denominator = 1) => ({ numerator, denominator });
const policy: PhysicalPolicy = { id: 'test-policy-v1', rules: [
  { kind: 'MaterialLot', definition_id: 'cabbage', form: 'fresh', quantity_unit: 'g', mass_mg_per_unit: rate(1000), volume_ul_per_unit: rate(1600) },
  { kind: 'MaterialLot', definition_id: 'oil', form: 'liquid', quantity_unit: 'ml', mass_mg_per_unit: rate(920), volume_ul_per_unit: rate(1000) },
  { kind: 'MaterialLot', definition_id: 'seed', form: 'dry_seed', quantity_unit: 'count', mass_mg_per_unit: rate(3), volume_ul_per_unit: rate(100) },
  { kind: 'DishLot', definition_id: 'dish', form: 'cooked_dish', quantity_unit: 'g', mass_mg_per_unit: rate(1000), volume_ul_per_unit: rate(1200) }
] };
const container: PhysicalContainer = { id: 'room', location_id: 'home', storage_type: 'room', supported_forms: ['fresh', 'liquid', 'dry_seed', 'cooked_dish'], limits: { mass_g: 50000, volume_ml: 100000 } };
const ref = { container_id: 'room', location_id: 'home', storage_type: 'room' };
const cabbage: PhysicalOccupant = { kind: 'MaterialLot', id: 'c', definition_id: 'cabbage', form: 'fresh', quantity: { amount: 1200, unit: 'g' }, storage_ref: ref };
const oil: PhysicalOccupant = { kind: 'MaterialLot', id: 'o', definition_id: 'oil', form: 'liquid', quantity: { amount: 100, unit: 'ml' }, storage_ref: ref };
const seeds: PhysicalOccupant = { kind: 'MaterialLot', id: 's', definition_id: 'seed', form: 'dry_seed', quantity: { amount: 10, unit: 'count' }, storage_ref: ref };
const dish: PhysicalOccupant = { kind: 'DishLot', id: 'd', definition_id: 'dish', form: 'cooked_dish', quantity: { amount: 420, unit: 'g' }, storage_ref: ref };
const run = (occupants: readonly PhysicalOccupant[], containers: readonly PhysicalContainer[] = [container], p: PhysicalPolicy = policy) =>
  calculatePhysicalCapacity({ policy_id: 'test-policy-v1', policy: p, containers, occupants });

test('mixed materials and dish are summed once, with no input mutation', () => {
  const items = [cabbage, oil, seeds, dish];
  const before = structuredClone(items);
  const result = run(items).containers.get('room')!;
  assert.equal(result.mass_g, 1712.03);
  assert.equal(result.volume_ml, 2525);
  assert.deepEqual(result.overflow, []);
  assert.equal(result.refs.length, 4);
  assert.deepEqual(items, before);
});

test('both dimensions independently allow equality and report overflow', () => {
  const exact = { ...container, limits: { mass_g: 1200, volume_ml: 1920 } };
  assert.deepEqual(run([cabbage], [exact]).containers.get('room')!.overflow, []);
  assert.deepEqual(run([cabbage], [{ ...exact, limits: { mass_g: 1199.999, volume_ml: 1920 } }]).containers.get('room')!.overflow, ['mass']);
  assert.deepEqual(run([cabbage], [{ ...exact, limits: { mass_g: 1200, volume_ml: 1919.999 } }]).containers.get('room')!.overflow, ['volume']);
  assert.deepEqual(run([cabbage], [{ ...exact, limits: { mass_g: 1199, volume_ml: 1919 } }]).containers.get('room')!.overflow, ['mass', 'volume']);
});

test('explicit piece volumes preserve differing sizes and are never inferred', () => {
  const mixed = { ...cabbage, quantity: { amount: 2200, unit: 'g' as const }, pieces: [{ mass_g: 1000, volume_ml: 1400 }, { mass_g: 1200, volume_ml: 2100 }] };
  const output = run([mixed]).containers.get('room')!;
  assert.equal(output.mass_g, 2200);
  assert.equal(output.volume_ml, 3500);
  assert.throws(() => run([{ ...mixed, quantity: { amount: 2201, unit: 'g' } }]), /ERR_PHYSICAL_PIECES_MASS_MISMATCH/);
});

test('fractional values sum before rounding so splitting does not inflate occupancy', () => {
  const tinyPolicy: PhysicalPolicy = { id: policy.id, rules: [{ kind: 'MaterialLot', definition_id: 'tiny', form: 'fresh', quantity_unit: 'g', mass_mg_per_unit: rate(1, 3), volume_ul_per_unit: rate(1, 3) }] };
  const item = { ...cabbage, definition_id: 'tiny', quantity: { amount: 3, unit: 'g' as const } };
  const whole = run([item], [container], tinyPolicy).containers.get('room')!;
  const split = run([1, 2, 3].map(i => ({ ...item, id: String(i), quantity: { amount: 1, unit: 'g' } })), [container], tinyPolicy).containers.get('room')!;
  assert.equal(whole.mass_g, 0.001);
  assert.equal(whole.volume_ml, 0.001);
  assert.equal(split.mass_g, whole.mass_g);
  assert.equal(split.volume_ml, whole.volume_ml);
});

test('decimal 0.1 plus 0.2 exactly meets 0.3 instead of exceeding it', () => {
  const items = [0.1, 0.2].map((amount, i) => ({ ...cabbage, id: String(i), quantity: { amount, unit: 'g' as const } }));
  const exact = { ...container, limits: { mass_g: 0.3, volume_ml: 0.48 } };
  const result = run(items, [exact]).containers.get('room')!;
  assert.equal(result.mass_g, 0.3);
  assert.equal(result.volume_ml, 0.48);
  assert.deepEqual(result.overflow, []);
});

test('unknown definitions, forms and units cannot become zero occupancy', () => {
  assert.throws(() => run([{ ...cabbage, definition_id: 'unknown' }]), /ERR_PHYSICAL_RULE_NOT_FOUND/);
  assert.throws(() => run([{ ...cabbage, quantity: { amount: 1, unit: 'ml' } }]), /ERR_PHYSICAL_RULE_NOT_FOUND/);
  assert.throws(() => run([{ ...cabbage, form: 'unavailable' }]), /ERR_PHYSICAL_FORM_NOT_SUPPORTED/);
  assert.throws(() => run([{ ...cabbage, quantity: { amount: 1, unit: 'bogus' as never } }]), /ERR_PHYSICAL_UNIT_INVALID/);
});

test('duplicate policy, containers and typed objects are rejected', () => {
  assert.throws(() => run([], [container, container]), /ERR_PHYSICAL_CONTAINER_DUPLICATE/);
  assert.throws(() => run([cabbage, cabbage]), /ERR_PHYSICAL_OBJECT_DUPLICATE/);
  assert.throws(() => run([], [container], { ...policy, rules: [...policy.rules, policy.rules[0]!] }), /ERR_PHYSICAL_RULE_DUPLICATE/);
  assert.throws(() => calculatePhysicalCapacity({ policy_id: 'other', policy, containers: [container], occupants: [] }), /ERR_PHYSICAL_POLICY_MISMATCH/);
});

test('invalid numbers, rates, discrete quantities and storage refs are rejected', () => {
  for (const amount of [0, -1, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => run([{ ...cabbage, quantity: { amount, unit: 'g' } }]), /ERR_PHYSICAL_NUMBER_INVALID/);
  assert.throws(() => run([{ ...seeds, quantity: { amount: 0.5, unit: 'count' } }]), /ERR_PHYSICAL_DISCRETE_QUANTITY_INVALID/);
  assert.throws(() => run([{ ...cabbage, storage_ref: { ...ref, location_id: 'elsewhere' } }]), /ERR_PHYSICAL_STORAGE_REF_INVALID/);
  assert.throws(() => run([], [{ ...container, limits: { mass_g: 0.0001, volume_ml: 1 } }]), /ERR_PHYSICAL_LIMIT_PRECISION/);
  assert.throws(() => run([], [container], { ...policy, rules: [{ ...policy.rules[0]!, mass_mg_per_unit: rate(1, 0) }] }), /ERR_PHYSICAL_RATE_INVALID/);
});

test('a moved item is counted only in its current destination', () => {
  const cellar = { ...container, id: 'cellar', storage_type: 'cellar' };
  const moved = { ...cabbage, storage_ref: { ...ref, container_id: 'cellar', storage_type: 'cellar' } };
  const result = run([moved], [container, cellar]);
  assert.equal(result.containers.get('room')!.mass_g, 0);
  assert.equal(result.containers.get('cellar')!.mass_g, 1200);
});
