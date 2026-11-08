import test from 'node:test';
import assert from 'node:assert/strict';
import { derivePhysicalCapacityDisplay, type CapacityDisplayInput } from '../src/cocos-app/view-models/PhysicalCapacityDisplay';
import type { PhysicalPolicy, PhysicalContainer, PhysicalOccupant } from '../src/game-core/storage/PhysicalCapacity';

// Test-only assumptions, not real measurements or final game balance.
const policy: PhysicalPolicy = { id: 'display-test-v1', rules: [
  { kind: 'MaterialLot', definition_id: 'cabbage', form: 'fresh', quantity_unit: 'g', mass_mg_per_unit: { numerator: 1000, denominator: 1 }, volume_ul_per_unit: { numerator: 1600, denominator: 1 } },
  { kind: 'MaterialLot', definition_id: 'oil', form: 'liquid', quantity_unit: 'ml', mass_mg_per_unit: { numerator: 920, denominator: 1 }, volume_ul_per_unit: { numerator: 1000, denominator: 1 } }
] };
const source: PhysicalContainer = { id: 'source', location_id: 'home', storage_type: 'room', supported_forms: ['fresh'], limits: { mass_g: 10000, volume_ml: 20000 } };
const target: PhysicalContainer = { id: 'target', location_id: 'home', storage_type: 'cellar', supported_forms: ['fresh', 'liquid'], limits: { mass_g: 2000, volume_ml: 2000 } };
const cabbage: PhysicalOccupant = { kind: 'MaterialLot', id: 'c', definition_id: 'cabbage', form: 'fresh', quantity: { amount: 2000, unit: 'g' }, storage_ref: { container_id: 'source', location_id: 'home', storage_type: 'room' } };
const oil: PhysicalOccupant = { kind: 'MaterialLot', id: 'o', definition_id: 'oil', form: 'liquid', quantity: { amount: 100, unit: 'ml' }, storage_ref: { container_id: 'target', location_id: 'home', storage_type: 'cellar' } };
const base = { model: 'physical' as const, policy_id: policy.id, policy, containers: [source, target], occupants: [cabbage, oil], target_id: 'target', grid_count: 10 };
const pieces = [{ id: 'a', weight_g: 1000 }, { id: 'b', weight_g: 1000 }];

test('legacy model reports original points and does not invent litres or kilograms', () => {
  const output = derivePhysicalCapacityDisplay({ model: 'legacy_slot', used: 12, maximum: 20 });
  assert.deepEqual(output, { model: 'legacy_slot', used: 12, maximum: 20 });
  assert.equal('used_volume_ml' in output, false);
});

test('mixed contents use global weight and volume; display cells are never item slots', () => {
  const input = { ...base, selection: { lot_id: 'c', pieces } };
  const before = structuredClone(input);
  const result = derivePhysicalCapacityDisplay(input);
  assert.equal(result.model, 'physical');
  assert.equal(result.status, 'ready');
  if (result.model !== 'physical' || result.status !== 'ready') return;
  assert.equal(result.used_mass_g, 92);
  assert.equal(result.used_volume_ml, 100);
  assert.equal(result.remaining_mass_g, 1908);
  assert.equal(result.remaining_volume_ml, 1900);
  assert.deepEqual(result.volume_grid, [0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  // A single 1600ml cabbage spans eight 200ml visual cells and still fits.
  assert.deepEqual(result.selection, { status: 'ready', fit_prefix: 1, selected_total: 2, blocked_by: ['mass', 'volume'], fit_by_visual_grid: [0, 0, 0, 0, 0, 0, 0, 0, 1, 0] });
  assert.deepEqual(input, before);
});

test('a different grid count never changes the exact allowed prefix', () => {
  const a = derivePhysicalCapacityDisplay({ ...base, grid_count: 1, selection: { lot_id: 'c', pieces } });
  const b = derivePhysicalCapacityDisplay({ ...base, grid_count: 20, selection: { lot_id: 'c', pieces } });
  assert.ok(a.model === 'physical' && a.status === 'ready');
  assert.ok(b.model === 'physical' && b.status === 'ready');
  if (a.model === 'physical' && a.status === 'ready' && b.model === 'physical' && b.status === 'ready') {
    assert.equal(a.selection.status, 'ready'); assert.equal(b.selection.status, 'ready');
    if (a.selection.status === 'ready' && b.selection.status === 'ready') {
      assert.equal(a.selection.fit_prefix, b.selection.fit_prefix);
      assert.deepEqual(a.selection.blocked_by, b.selection.blocked_by);
      assert.equal(a.selection.fit_by_visual_grid.reduce((sum, count) => sum + count, 0), a.selection.fit_prefix);
      assert.equal(b.selection.fit_by_visual_grid.reduce((sum, count) => sum + count, 0), b.selection.fit_prefix);
    }
  }
});

test('visual counts distribute exact boundary endings without creating independent storage cells', () => {
  const wide = { ...target, limits: { mass_g: 5000, volume_ml: 3200 } };
  const roomy = { ...base, containers: [source, wide], occupants: [cabbage], grid_count: 4, selection: { lot_id: 'c', pieces } };
  const result = derivePhysicalCapacityDisplay(roomy);
  assert.ok(result.model === 'physical' && result.status === 'ready' && result.selection.status === 'ready');
  if (result.model === 'physical' && result.status === 'ready' && result.selection.status === 'ready') {
    assert.equal(result.selection.fit_prefix, 2);
    assert.deepEqual(result.selection.fit_by_visual_grid, [0, 1, 0, 1], 'each 1600ml cabbage crosses two 800ml visual cells but counts once');
  }
  const heavy = derivePhysicalCapacityDisplay({ ...roomy, containers: [source, { ...wide, limits: { mass_g: 1500, volume_ml: 3200 } }] });
  assert.ok(heavy.model === 'physical' && heavy.status === 'ready' && heavy.selection.status === 'ready');
  if (heavy.model === 'physical' && heavy.status === 'ready' && heavy.selection.status === 'ready') {
    assert.equal(heavy.selection.fit_prefix, 1);
    assert.deepEqual(heavy.selection.blocked_by, ['mass']);
    assert.deepEqual(heavy.selection.fit_by_visual_grid, [0, 1, 0, 0], 'remaining visual cells do not create extra shared carrying capacity');
  }
});

test('prefix is explicitly order-dependent, not an unconstrained maximum', () => {
  const limit = { ...target, limits: { mass_g: 1092, volume_ml: 10000 } };
  const ordered = [{ id: 'large', weight_g: 1500 }, { id: 'small', weight_g: 500 }];
  const result = derivePhysicalCapacityDisplay({ ...base, containers: [source, limit], selection: { lot_id: 'c', pieces: ordered } });
  assert.ok(result.model === 'physical' && result.status === 'ready');
  if (result.model === 'physical' && result.status === 'ready') assert.deepEqual(result.selection, { status: 'ready', fit_prefix: 0, selected_total: 2, blocked_by: ['mass'], fit_by_visual_grid: Array(10).fill(0) });
  const reversed = derivePhysicalCapacityDisplay({ ...base, containers: [source, limit], selection: { lot_id: 'c', pieces: [...ordered].reverse() } });
  assert.ok(reversed.model === 'physical' && reversed.status === 'ready');
  if (reversed.model === 'physical' && reversed.status === 'ready') assert.deepEqual(reversed.selection, { status: 'ready', fit_prefix: 1, selected_total: 2, blocked_by: ['mass'], fit_by_visual_grid: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0] });
});

test('selection missing or piece count unknown is never estimated from total grams', () => {
  for (const selection of [undefined, { lot_id: 'c' }] as const) {
    const input = selection ? { ...base, selection } : base;
    const output = derivePhysicalCapacityDisplay(input);
    assert.ok(output.model === 'physical' && output.status === 'ready');
    if (output.model === 'physical' && output.status === 'ready') assert.equal(output.selection.status, 'unknown');
  }
});

test('piece weights and IDs must be complete and agree exactly with the batch', () => {
  for (const invalid of [[{ id: 'a', weight_g: 1200 }], [{ id: 'a', weight_g: 1000 }, { id: 'a', weight_g: 1000 }], [{ id: 'a', weight_g: Infinity }]]) {
    const output = derivePhysicalCapacityDisplay({ ...base, selection: { lot_id: 'c', pieces: invalid } });
    assert.ok(output.model === 'physical' && output.status === 'ready');
    if (output.model === 'physical' && output.status === 'ready') assert.deepEqual(output.selection, { status: 'unknown', reason: 'piece_data_invalid' });
  }
});

test('explicit per-piece volumes must be consistent with the existing source occupancy', () => {
  const realPieces = [{ id: 'a', weight_g: 1000, volume_ml: 1300 }, { id: 'b', weight_g: 1000, volume_ml: 1900 }];
  const mismatch = derivePhysicalCapacityDisplay({ ...base, selection: { lot_id: 'c', pieces: realPieces } });
  // The two explicit volumes happen to total the policy estimate, so allocation can be previewed.
  assert.ok(mismatch.model === 'physical' && mismatch.status === 'ready' && mismatch.selection.status === 'ready');
  const inconsistent = derivePhysicalCapacityDisplay({ ...base, selection: { lot_id: 'c', pieces: [{ ...realPieces[0]!, volume_ml: 1200 }, realPieces[1]!] } });
  assert.ok(inconsistent.model === 'physical' && inconsistent.status === 'ready');
  if (inconsistent.model === 'physical' && inconsistent.status === 'ready') assert.deepEqual(inconsistent.selection, { status: 'unknown', reason: 'piece_volume_inconsistent' });
});

test('unknown policy, unsupported form, missing target and existing overflow do not fake a result', () => {
  const missingPolicy = derivePhysicalCapacityDisplay({ ...base, policy_id: 'unknown' });
  assert.deepEqual(missingPolicy, { model: 'physical', status: 'unavailable', reason: 'ERR_PHYSICAL_POLICY_MISMATCH' });
  const absentTarget = derivePhysicalCapacityDisplay({ ...base, target_id: 'missing' });
  assert.deepEqual(absentTarget, { model: 'physical', status: 'unavailable', reason: 'ERR_PHYSICAL_DISPLAY_TARGET_MISSING' });
  const tooSmall = derivePhysicalCapacityDisplay({ ...base, containers: [source, { ...target, limits: { mass_g: 50, volume_ml: 2000 } }] });
  assert.deepEqual(tooSmall, { model: 'physical', status: 'unavailable', reason: 'ERR_PHYSICAL_DISPLAY_EXISTING_OVERFLOW' });
  const unsuitable = derivePhysicalCapacityDisplay({ ...base, containers: [source, { ...target, supported_forms: ['liquid'] }], selection: { lot_id: 'c', pieces } });
  assert.ok(unsuitable.model === 'physical' && unsuitable.status === 'ready');
  if (unsuitable.model === 'physical' && unsuitable.status === 'ready') assert.deepEqual(unsuitable.selection, { status: 'unknown', reason: 'ERR_PHYSICAL_FORM_NOT_SUPPORTED' });
});

test('moving to the same storage is identified rather than counted twice', () => {
  const input: CapacityDisplayInput = { ...base, target_id: 'source', selection: { lot_id: 'c', pieces } };
  const output = derivePhysicalCapacityDisplay(input);
  assert.ok(output.model === 'physical' && output.status === 'ready');
  if (output.model === 'physical' && output.status === 'ready') assert.deepEqual(output.selection, { status: 'already_in_target' });
});

test('standard cabbage estimate uses versioned policy and shared mixed occupancy without creating inventory', () => {
  const input = { ...base, standard_cabbage_g: 1000 };
  const before = structuredClone(input); const result = derivePhysicalCapacityDisplay(input);
  assert.ok(result.model === 'physical' && result.status === 'ready');
  if (result.model === 'physical' && result.status === 'ready') {
    assert.equal(result.standard_cabbage_estimate, 1, '100ml oil and 92g mass count towards both limits');
    assert.equal(result.selection.status, 'unknown');
  }
  assert.deepEqual(input, before);
  const noOil = derivePhysicalCapacityDisplay({ ...input, occupants: [cabbage] });
  assert.ok(noOil.model === 'physical' && noOil.status === 'ready');
  if (noOil.model === 'physical' && noOil.status === 'ready') assert.equal(noOil.standard_cabbage_estimate, 1);
  const ample = derivePhysicalCapacityDisplay({ ...input, containers: [source, { ...target, limits: { mass_g:12000, volume_ml:20000 } }], occupants: [cabbage], standard_cabbage_g:1200 });
  assert.ok(ample.model === 'physical' && ample.status === 'ready');
  if (ample.model === 'physical' && ample.status === 'ready') assert.equal(ample.standard_cabbage_estimate,10);
  const mixed = derivePhysicalCapacityDisplay({ ...input, containers: [source, { ...target, limits: { mass_g:12000, volume_ml:20000 } }], standard_cabbage_g:1200 });
  assert.ok(mixed.model === 'physical' && mixed.status === 'ready');
  if (mixed.model === 'physical' && mixed.status === 'ready') assert.equal(mixed.standard_cabbage_estimate,9);
});

test('standard estimate stays unknown for missing standard, missing policy, unsupported form or legacy save', () => {
  const variants = [ { ...base, standard_cabbage_g: 0 }, { ...base, standard_cabbage_g: NaN },
    { ...base, standard_cabbage_g: 1000, policy: { ...policy, rules: policy.rules.filter(rule => rule.definition_id !== 'cabbage') }, occupants: [oil] },
    { ...base, standard_cabbage_g: 1000, containers: [source, { ...target, supported_forms:['liquid'] }] },
    { ...base, standard_cabbage_g: 3000, policy: { ...policy, rules: policy.rules.filter(rule => rule.definition_id !== 'cabbage') }, occupants:[oil] } ];
  for (const input of variants) {
    const result=derivePhysicalCapacityDisplay(input);
    assert.ok(result.model === 'physical' && result.status === 'ready');
    if (result.model === 'physical' && result.status === 'ready') assert.equal(result.standard_cabbage_estimate,undefined);
  }
  assert.equal('standard_cabbage_estimate' in derivePhysicalCapacityDisplay({model:'legacy_slot', used:1, maximum:20}),false);
});

test('standard estimates follow policy mass and volume coefficients at boundaries, including mixed contents', () => {
  const fractional: PhysicalPolicy = { id:'fractional-test-v1', rules: policy.rules.map(rule => rule.definition_id === 'cabbage'
    ? { ...rule, mass_mg_per_unit:{numerator:500,denominator:1}, volume_ul_per_unit:{numerator:1000,denominator:1} } : rule) };
  const estimate = (mass:number, volume:number, occupants:PhysicalOccupant[] = []) => {
    const result=derivePhysicalCapacityDisplay({ ...base, policy_id:fractional.id, policy:fractional, containers:[source,{...target,limits:{mass_g:mass,volume_ml:volume}}], occupants, standard_cabbage_g:1000 });
    assert.ok(result.model==='physical' && result.status==='ready');
    return result.model==='physical' && result.status==='ready' ? result.standard_cabbage_estimate : undefined;
  };
  assert.equal(estimate(2000,10000),4, '0.5g mass per quantity g allows four, including exact mass boundary');
  assert.equal(estimate(1999,10000),3, 'one less than boundary mass excludes the fourth');
  assert.equal(estimate(10000,4000),4, 'exact volume boundary is accepted');
  assert.equal(estimate(10000,3999),3, 'one less than volume boundary excludes the fourth');
  assert.equal(estimate(2000,10000,[oil]),3, 'mixed oil also consumes the target mass budget');
  assert.equal(estimate(10000,4000,[oil]),3, 'mixed oil also consumes the target volume budget');
  assert.equal(estimate(1500000,10000000),3000, 'estimate is based on policy, not a fixed jar count');
});

test('standard estimate does not use a one-million-item cutoff', () => {
  const small: PhysicalPolicy = { id:'small-unit-test-v1', rules: policy.rules.map(rule => rule.definition_id === 'cabbage'
    ? { ...rule, mass_mg_per_unit:{numerator:1,denominator:1}, volume_ul_per_unit:{numerator:1,denominator:1} } : rule) };
  const result=derivePhysicalCapacityDisplay({ ...base, policy_id:small.id, policy:small, containers:[source,{...target,limits:{mass_g:1001,volume_ml:1001}}], occupants:[], standard_cabbage_g:1 });
  assert.ok(result.model==='physical' && result.status==='ready');
  if(result.model==='physical' && result.status==='ready') assert.equal(result.standard_cabbage_estimate,1001000);
});
