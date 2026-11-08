import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildRuntime, buildRuntimeWithoutState, cloneForCompare } from './support/runtimeHarness';
import { ConfigRepository, GameRuntime, InMemorySaveStoragePort, NewGameBuilder, SaveManager, StorageAudit } from '../src/game-core/index';
import { DeterministicIdService } from '../src/game-core/id/IdService';
import type { GameState } from '../src/game-core/index';
import { assertCabbagePieces, planWholeCabbageTake } from '../src/game-core/inventory/CabbagePiecePlanner';
import { ActionPipeline } from '../src/game-core/action/ActionPipeline';
import { ActionHandlerRegistry } from '../src/game-core/action/ActionHandlerRegistry';
import { ActionResultFactory } from '../src/game-core/action/ActionResultFactory';
import { loadPhysicalPolicyRegistry } from '../src/game-core/config/PhysicalPolicyLoader';

const picklingFacilityRef = { location_id: 'home', storage_type: 'pickling_jar', container_id: 'pickling_jar_basic_01', definition_id: 'pickling_jar_basic', facility_id: 'pickling_jar_basic_01' };
// Every audit of a physical save uses the actual registered policy; never skip physical checking.
const auditPolicies = loadPhysicalPolicyRegistry(new ConfigRepository(JSON.parse(readFileSync('design_snapshot/generated/stage_1A_runtime_snapshot.json', 'utf8'))));
function useLegacyCapacity(state: GameState): void {
  delete state.save_file.physical_capacity_policy_id;
  for (const container of state.save_file.storage_containers) {
    delete container.capacity_limits;
    delete container.used_capacity_limits;
  }
}

test('whole cabbage take plans preserve individual weights and do not infer legacy piece counts', () => {
  const { state } = buildRuntime();
  const origin = state.save_file.inventory[0]!.source_ref;
  const source = { ...state.save_file.inventory[0]!, base_id: 'cabbage', quantity: { amount: 3300, unit: 'g' },
    cabbage_pieces: { kind: 'whole' as const, pieces: [
      { id: 'c1', weight_g: 1200, source_ref: origin }, { id: 'c2', weight_g: 2100, source_ref: origin }
    ] } };
  const before = structuredClone(source);
  const byCount = planWholeCabbageTake(source, { amount: 1, unit: 'count' });
  assert.equal(byCount.taken[0]!.quantity.amount, 1200);
  assert.equal(byCount.remaining[0]!.quantity.amount, 2100);
  const byWeight = planWholeCabbageTake(source, { amount: 1500, unit: 'g' });
  assert.deepEqual(byWeight.taken.map(portion => [portion.pieces.kind, portion.quantity.amount]), [['whole', 1200], ['cut', 300]]);
  assert.deepEqual(byWeight.remaining.map(portion => [portion.pieces.kind, portion.quantity.amount]), [['cut', 1800]]);
  assert.deepEqual(source, before);
  assert.throws(() => planWholeCabbageTake({ ...source, cabbage_pieces: undefined } as never, { amount: 1, unit: 'count' }), /ERR_CABBAGE_PIECE_COUNT_UNKNOWN/);
  assert.throws(() => assertCabbagePieces({ ...source, quantity: { amount: 3301, unit: 'g' } }), /ERR_CABBAGE_PIECES_WEIGHT_MISMATCH/);
  const fractional = { ...source, quantity: { amount: 0.3, unit: 'g' }, cabbage_pieces: { kind: 'whole' as const, pieces: [
    { id: 'small_1', weight_g: 0.1, source_ref: origin }, { id: 'small_2', weight_g: 0.2, source_ref: origin }
  ] } };
  assert.doesNotThrow(() => assertCabbagePieces(fractional));
  const fractionalTake = planWholeCabbageTake(fractional, { amount: 0.1, unit: 'g' });
  assert.equal(fractionalTake.taken[0]!.quantity.amount, 0.1);
  assert.equal(fractionalTake.remaining[0]!.quantity.amount, 0.2);
});

test('formal cabbage merge, count split and partial processing preserve pieces, weight and save schema', () => {
  const { runtime, state, contracts } = buildRuntime();
  const plant = dispatch(runtime, state, 'plant_crop', { field_plot_id: 'field_plot_01', seed_lot_id: 'seed_cabbage_initial_001', seed_quantity: { amount: 2, unit: 'count' } }, 'pieces_plant');
  assert.equal(plant.success, true);
  assert.equal(dispatch(runtime, state, 'advance_time', { minutes: 5400 }, 'pieces_time').success, true);
  const harvested = plant.created_objects.map((object, index) => {
    const result = dispatch(runtime, state, 'harvest_crop', { crop_id: object.object_id }, `pieces_harvest_${index}`);
    assert.equal(result.success, true);
    return result.created_objects[0]!.object_id;
  });
  const beforeInvalid = cloneForCompare(state);
  const invalid = dispatch(runtime, state, 'merge_lot', { source_lot_id: harvested[0], target_lot_id: harvested[0] }, 'pieces_invalid_merge');
  assert.equal(invalid.success, false);
  assert.deepEqual(state, beforeInvalid);
  runtime.inventory.assertCanMerge(state.save_file, harvested[1]!, harvested[0]!);
  assert.deepEqual(state, beforeInvalid);
  const merge = dispatch(runtime, state, 'merge_lot', { source_lot_id: harvested[1], target_lot_id: harvested[0] }, 'pieces_merge');
  assert.equal(merge.success, true, merge.status_code);
  const merged = runtime.inventory.findMaterialLot(state.save_file, harvested[0]!);
  assert.equal(merged.quantity.amount, 2400);
  assert.equal(merged.cabbage_pieces?.kind, 'whole');
  if (merged.cabbage_pieces?.kind !== 'whole') throw new Error('expected whole pieces');
  assert.equal(merged.cabbage_pieces.pieces.length, 2);
  const mergedGroups = merged.lineage_summary!.ordinary_source_groups as Array<{ origin_lot_id: string }>;
  assert.deepEqual(mergedGroups.map(group => group.origin_lot_id).sort(), [...harvested].sort());
  contracts.assertSaveFile(state.save_file);
  const split = dispatch(runtime, state, 'split_lot', { source_lot_id: harvested[0], quantity: { amount: 1, unit: 'count' } }, 'pieces_split_count');
  assert.equal(split.success, true, split.status_code);
  assert.equal(split.created_objects[0]!.summary!.quantity!.amount, 1200);
  assert.equal(runtime.inventory.findMaterialLot(state.save_file, harvested[0]!).quantity.amount, 1200);
  const processing = dispatch(runtime, state, 'start_processing', { method_id: 'pickling_cabbage_basic', input_lots: [
    { lot_id: harvested[0], quantity: { amount: 300, unit: 'g' } },
    { lot_id: 'salt_initial_001', quantity: { amount: 15, unit: 'g' } }
  ], facility_ref: picklingFacilityRef }, 'pieces_process');
  assert.equal(processing.success, true, processing.status_code);
  const rest = runtime.inventory.findMaterialLot(state.save_file, harvested[0]!);
  assert.equal(rest.quantity.amount, 900);
  assert.equal(rest.cabbage_pieces?.kind, 'cut');
  assert.equal(rest.current_form, 'cut');
  contracts.assertSaveFile(state.save_file);
  new StorageAudit(auditPolicies).assertReconciled(state.save_file);
});

test('gram split reports selected and residual lots by explicit role and preserves total weight', () => {
  const { runtime, state, contracts } = buildRuntime();
  const plant = dispatch(runtime, state, 'plant_crop', { field_plot_id: 'field_plot_01', seed_lot_id: 'seed_cabbage_initial_001', seed_quantity: { amount: 2, unit: 'count' } }, 'roles_plant');
  assert.equal(plant.success, true);
  assert.equal(dispatch(runtime, state, 'advance_time', { minutes: 5400 }, 'roles_time').success, true);
  const lots = plant.created_objects.map((object, index) => {
    const harvest = dispatch(runtime, state, 'harvest_crop', { crop_id: object.object_id }, `roles_harvest_${index}`);
    assert.equal(harvest.success, true);
    return harvest.created_objects[0]!.object_id;
  });
  assert.equal(dispatch(runtime, state, 'merge_lot', { source_lot_id: lots[1], target_lot_id: lots[0] }, 'roles_merge').success, true);
  const split = dispatch(runtime, state, 'split_lot', { source_lot_id: lots[0], quantity: { amount: 300, unit: 'g' } }, 'roles_split');
  assert.equal(split.success, true, split.status_code);
  contracts.assertActionResult(split);
  const taken = split.created_objects.filter(item => item.summary?.split_role === 'taken');
  const remaining = split.created_objects.filter(item => item.summary?.split_role === 'remaining');
  assert.equal(taken.length, 1);
  assert.equal(taken[0]!.summary!.quantity!.amount, 300);
  assert.equal(taken[0]!.summary!.piece_count, 0);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0]!.summary!.quantity!.amount, 900);
  assert.equal(remaining[0]!.summary!.piece_count, 0);
  const original = split.updated_objects.find(item => item.object_id === lots[0])!;
  assert.equal(original.summary!.split_role, 'remaining');
  assert.equal(original.summary!.piece_count, 1);
  assert.equal(original.summary!.quantity!.amount, 1200);
  assert.equal(state.save_file.inventory.filter(lot => lot.base_id === 'cabbage').reduce((total, lot) => total + lot.quantity.amount, 0), 2400);
  contracts.assertSaveFile(state.save_file);
  const takenId = taken[0]!.object_id;
  const raw = new SaveManager().serialize(state);
  const restored = new SaveManager().deserializeSaveFile(raw);
  const processed = dispatch(runtime, restored, 'start_processing', { method_id: 'pickling_cabbage_basic', input_lots: [
    { lot_id: takenId, quantity: { amount: 300, unit: 'g' } },
    { lot_id: 'salt_initial_001', quantity: { amount: 15, unit: 'g' } }
  ], facility_ref: picklingFacilityRef }, 'roles_process_cut');
  assert.equal(processed.success, true, processed.status_code);
  const task = restored.save_file.processing_tasks.find(item => item.task_id === processed.created_objects[0]!.object_id)!;
  assert.equal(task.input_lot_refs[0]!.source_snapshot!.piece_portions![0]!.piece_id, plant.created_objects[0]!.object_id);
  assert.equal(task.input_lot_refs[0]!.source_snapshot!.piece_portions![0]!.taken_weight_g, 300);
  contracts.assertSaveFile(restored.save_file);
});

test('partial processing of a multi-piece batch reports the separately created cut remainder', () => {
  const { runtime, state, contracts } = buildRuntime();
  const plant = dispatch(runtime, state, 'plant_crop', { field_plot_id: 'field_plot_01', seed_lot_id: 'seed_cabbage_initial_001', seed_quantity: { amount: 2, unit: 'count' } }, 'process_pieces_plant');
  assert.equal(plant.success, true);
  assert.equal(dispatch(runtime, state, 'advance_time', { minutes: 5400 }, 'process_pieces_time').success, true);
  const lots = plant.created_objects.map((object, index) => {
    const result = dispatch(runtime, state, 'harvest_crop', { crop_id: object.object_id }, `process_pieces_harvest_${index}`);
    assert.equal(result.success, true);
    return result.created_objects[0]!.object_id;
  });
  assert.equal(dispatch(runtime, state, 'merge_lot', { source_lot_id: lots[1], target_lot_id: lots[0] }, 'process_pieces_merge').success, true);
  const result = dispatch(runtime, state, 'start_processing', { method_id: 'pickling_cabbage_basic', input_lots: [
    { lot_id: lots[0], quantity: { amount: 300, unit: 'g' } },
    { lot_id: 'salt_initial_001', quantity: { amount: 15, unit: 'g' } }
  ], facility_ref: picklingFacilityRef }, 'process_pieces_start');
  assert.equal(result.success, true, result.status_code);
  const leftoverRef = result.created_objects.find(item => item.object_type === 'MaterialLot' && item.summary?.status === 'consumption_remainder');
  assert.ok(leftoverRef);
  const leftover = runtime.inventory.findMaterialLot(state.save_file, leftoverRef.object_id);
  assert.equal(leftover.quantity.amount, 900);
  assert.equal(leftover.cabbage_pieces?.kind, 'cut');
  const original = runtime.inventory.findMaterialLot(state.save_file, lots[0]!);
  assert.equal(original.quantity.amount, 1200);
  assert.equal(original.cabbage_pieces?.kind, 'whole');
  assert.equal(result.domain_events.some(event => event.event_type === 'inventory.lot_created'), true);
  contracts.assertActionResult(result);
  contracts.assertSaveFile(state.save_file);
  new StorageAudit(auditPolicies).assertReconciled(state.save_file);
});

test('repeated processing inputs consume in order for both legacy and known multi-piece lots', () => {
  for (const legacy of [true, false]) {
    const { runtime, state } = buildRuntime();
    const plant = dispatch(runtime, state, 'plant_crop', { field_plot_id: 'field_plot_01', seed_lot_id: 'seed_cabbage_initial_001', seed_quantity: { amount: 2, unit: 'count' } }, `repeat_${legacy}_plant`);
    assert.equal(plant.success, true);
    assert.equal(dispatch(runtime, state, 'advance_time', { minutes: 5400 }, `repeat_${legacy}_time`).success, true);
    const ids = plant.created_objects.map((object, index) => {
      const result = dispatch(runtime, state, 'harvest_crop', { crop_id: object.object_id }, `repeat_${legacy}_harvest_${index}`);
      assert.equal(result.success, true);
      return result.created_objects[0]!.object_id;
    });
    assert.equal(dispatch(runtime, state, 'merge_lot', { source_lot_id: ids[1], target_lot_id: ids[0] }, `repeat_${legacy}_merge`).success, true);
    if (legacy) delete runtime.inventory.findMaterialLot(state.save_file, ids[0]!).cabbage_pieces;
    const inputs = [{ lot_id: ids[0]!, quantity: { amount: 300, unit: 'g' } },
      { lot_id: ids[0]!, quantity: { amount: 1500, unit: 'g' } },
      { lot_id: 'salt_initial_001', quantity: { amount: 15, unit: 'g' } }];
    const result = dispatch(runtime, state, 'start_processing', { method_id: 'pickling_cabbage_basic', input_lots: inputs,
      facility_ref: picklingFacilityRef }, `repeat_${legacy}_start`);
    assert.equal(result.success, true, `${legacy ? 'legacy' : 'known'}: ${result.status_code}`);
    assert.deepEqual(result.consumed_resources.map(item => [item.resource_id, item.quantity.amount]),
      inputs.map(input => [input.lot_id, input.quantity.amount]));
    assert.equal(state.save_file.inventory.filter(lot => lot.base_id === 'cabbage').reduce((sum, lot) => sum + lot.quantity.amount, 0), 600);
    const task = state.save_file.processing_tasks.find(item => item.task_id === result.created_objects[0]!.object_id)!;
    if (legacy) assert.equal(task.input_lot_refs[0]!.source_snapshot?.piece_portions, undefined);
    else {
      const first = task.input_lot_refs[0]!.source_snapshot!.piece_portions!;
      const second = task.input_lot_refs[1]!.source_snapshot!.piece_portions!;
      assert.deepEqual(first.map(piece => [piece.piece_id, piece.taken_weight_g]), [[plant.created_objects[0]!.object_id, 300]]);
      assert.deepEqual(second.map(piece => [piece.piece_id, piece.taken_weight_g]),
        [[plant.created_objects[0]!.object_id, 900], [plant.created_objects[1]!.object_id, 600]]);
    }
  }
});

test('decimal repeated processing inputs can consume the exact remaining mass without overdraw', () => {
  const observed: string[] = [];
  for (const legacy of [true, false]) {
    const { runtime, state } = buildRuntime();
    const id = prepareHarvestedCabbage(runtime, state);
    if (legacy) delete runtime.inventory.findMaterialLot(state.save_file, id).cabbage_pieces;
    const before = cloneForCompare(state);
    const invalid = dispatch(runtime, state, 'start_processing', { method_id: 'pickling_cabbage_basic', input_lots: [
      { lot_id: id, quantity: { amount: 1199.7, unit: 'g' } },
      { lot_id: id, quantity: { amount: 0.4, unit: 'g' } },
      { lot_id: 'salt_initial_001', quantity: { amount: 15, unit: 'g' } }
    ], facility_ref: picklingFacilityRef }, `decimal_${legacy}_overdraw`);
    assert.equal(invalid.success, false);
    assert.deepEqual(state, before);
    const valid = dispatch(runtime, state, 'start_processing', { method_id: 'pickling_cabbage_basic', input_lots: [
      { lot_id: id, quantity: { amount: 1199.7, unit: 'g' } },
      { lot_id: id, quantity: { amount: 0.3, unit: 'g' } },
      { lot_id: 'salt_initial_001', quantity: { amount: 15, unit: 'g' } }
    ], facility_ref: picklingFacilityRef }, `decimal_${legacy}_exact`);
    observed.push(`${legacy ? 'legacy' : 'known'}:${valid.status_code}`);
    if (valid.success) {
      assert.equal(state.save_file.inventory.some(lot => lot.lot_id === id), false);
      assert.deepEqual(valid.consumed_resources.slice(0, 2).map(item => item.quantity.amount), [1199.7, 0.3]);
    }
  }
  assert.deepEqual(observed, ['legacy:OK', 'known:OK']);
});

test('zero primary quantity retains the same start-action behavior for legacy and known cabbage', () => {
  const results: Array<{ success: boolean; status: string; remaining: number }> = [];
  for (const legacy of [true, false]) {
    const { runtime, state } = buildRuntime();
    const id = prepareHarvestedCabbage(runtime, state);
    if (legacy) delete runtime.inventory.findMaterialLot(state.save_file, id).cabbage_pieces;
    const result = dispatch(runtime, state, 'start_processing', { method_id: 'pickling_cabbage_basic', input_lots: [
      { lot_id: id, quantity: { amount: 0, unit: 'g' } },
      { lot_id: 'salt_initial_001', quantity: { amount: 15, unit: 'g' } }
    ], facility_ref: picklingFacilityRef }, `zero_${legacy}_start`);
    results.push({ success: result.success, status: result.status_code, remaining: runtime.inventory.findMaterialLot(state.save_file, id).quantity.amount });
  }
  assert.deepEqual(results, [{ success: true, status: 'OK', remaining: 1200 }, { success: true, status: 'OK', remaining: 1200 }]);
});

test('fully consumed merged cabbage retains per-piece sources through save, load and collection', () => {
  const { runtime, state, contracts } = buildRuntime();
  const plant = dispatch(runtime, state, 'plant_crop', { field_plot_id: 'field_plot_01', seed_lot_id: 'seed_cabbage_initial_001', seed_quantity: { amount: 2, unit: 'count' } }, 'source_plant');
  assert.equal(plant.success, true);
  assert.equal(dispatch(runtime, state, 'advance_time', { minutes: 5400 }, 'source_time').success, true);
  const ids = plant.created_objects.map((object, index) => {
    const harvest = dispatch(runtime, state, 'harvest_crop', { crop_id: object.object_id }, `source_harvest_${index}`);
    assert.equal(harvest.success, true);
    return harvest.created_objects[0]!.object_id;
  });
  assert.equal(dispatch(runtime, state, 'merge_lot', { source_lot_id: ids[1], target_lot_id: ids[0] }, 'source_merge').success, true);
  const result = dispatch(runtime, state, 'start_processing', { method_id: 'pickling_cabbage_basic', input_lots: [
    { lot_id: ids[0], quantity: { amount: 1200, unit: 'g' } },
    { lot_id: ids[0], quantity: { amount: 1200, unit: 'g' } },
    { lot_id: 'salt_initial_001', quantity: { amount: 15, unit: 'g' } }
  ], facility_ref: picklingFacilityRef }, 'source_start');
  assert.equal(result.success, true, result.status_code);
  assert.equal(state.save_file.inventory.some(lot => lot.lot_id === ids[0]), false);
  const taskId = result.created_objects[0]!.object_id;
  const expectedPieces = plant.created_objects.map(object => object.object_id);
  const saved = new SaveManager().serialize(state);
  const restored = new SaveManager().deserializeSaveFile(saved);
  contracts.assertSaveFile(restored.save_file);
  const task = restored.save_file.processing_tasks.find(item => item.task_id === taskId)!;
  assert.deepEqual(task.input_lot_refs.slice(0, 2).map(input => input.source_snapshot!.piece_portions![0]!.piece_id), expectedPieces);
  const corrupt = structuredClone(restored.save_file);
  corrupt.processing_tasks.find(item => item.task_id === taskId)!.input_lot_refs[0]!.source_snapshot!.piece_portions![0]!.taken_weight_g = 1201;
  assert.throws(() => contracts.assertSaveFile(corrupt), /ERR_INPUT_PIECE_SOURCE_INVALID|ERR_INPUT_PIECE_SOURCE_WEIGHT_MISMATCH/);
  assert.equal(dispatch(runtime, restored, 'advance_time', { minutes: 2880 }, 'source_finish_time').success, true);
  const collected = dispatch(runtime, restored, 'collect_processing_result', { task_id: taskId }, 'source_collect');
  assert.equal(collected.success, true, collected.status_code);
  const output = runtime.inventory.findMaterialLot(restored.save_file, collected.created_objects[0]!.object_id);
  const origins = output.lineage_summary?.key_origins as Array<{ origin_id: string }>;
  for (const cropId of expectedPieces) assert.equal(origins.some(origin => origin.origin_id === cropId), true);
  contracts.assertSaveFile(restored.save_file);
});

test('cooking partial merged cabbage retains exact piece sources in the dish and save', () => {
  const { runtime, state, contracts } = buildRuntime();
  const plant = dispatch(runtime, state, 'plant_crop', { field_plot_id: 'field_plot_01', seed_lot_id: 'seed_cabbage_initial_001', seed_quantity: { amount: 2, unit: 'count' } }, 'dish_sources_plant');
  assert.equal(plant.success, true);
  assert.equal(dispatch(runtime, state, 'advance_time', { minutes: 5400 }, 'dish_sources_time').success, true);
  const lots = plant.created_objects.map((object, index) => {
    const harvest = dispatch(runtime, state, 'harvest_crop', { crop_id: object.object_id }, `dish_sources_harvest_${index}`);
    assert.equal(harvest.success, true);
    return harvest.created_objects[0]!.object_id;
  });
  assert.equal(dispatch(runtime, state, 'merge_lot', { source_lot_id: lots[1], target_lot_id: lots[0] }, 'dish_sources_merge').success, true);
  const cooked = dispatch(runtime, state, 'cook_dish', { recipe_variant_id: 'bacon_cabbage_basic', ingredients: {
    main: { lot_id: lots[0], quantity: { amount: 1500, unit: 'g' } },
    side: { lot_id: 'bacon_initial_001', quantity: { amount: 50, unit: 'g' } },
    oil: { lot_id: 'oil_initial_001', quantity: { amount: 10, unit: 'ml' } }
  }, technique: 'stir_fry', operation_profile: { heat_level: 'high', active_minutes: 8 } }, 'dish_sources_cook');
  assert.equal(cooked.success, true, cooked.status_code);
  const dish = state.save_file.dish_lots.find(item => item.dish_lot_id === cooked.created_objects[0]!.object_id)!;
  const main = dish.components.find(component => component.role === 'main')!;
  assert.deepEqual(main.source_snapshot!.piece_portions!.map(piece => [piece.piece_id, piece.taken_weight_g]),
    [[plant.created_objects[0]!.object_id, 1200], [plant.created_objects[1]!.object_id, 300]]);
  const restored = new SaveManager().deserializeSaveFile(new SaveManager().serialize(state));
  contracts.assertSaveFile(restored.save_file);
});

test('merge refuses protected, different-quality and reserved lots without changing state', () => {
  const { runtime, state } = buildRuntime();
  const plant = dispatch(runtime, state, 'plant_crop', { field_plot_id: 'field_plot_01', seed_lot_id: 'seed_cabbage_initial_001', seed_quantity: { amount: 2, unit: 'count' } }, 'merge_guard_plant');
  assert.equal(plant.success, true);
  assert.equal(dispatch(runtime, state, 'advance_time', { minutes: 5400 }, 'merge_guard_time').success, true);
  const lots = plant.created_objects.map((object, index) => {
    const result = dispatch(runtime, state, 'harvest_crop', { crop_id: object.object_id }, `merge_guard_harvest_${index}`);
    assert.equal(result.success, true);
    return result.created_objects[0]!.object_id;
  });
  const source = () => runtime.inventory.findMaterialLot(state.save_file, lots[1]!);
  const check = (code: string, suffix: string) => {
    const before = cloneForCompare(state);
    const result = dispatch(runtime, state, 'merge_lot', { source_lot_id: lots[1], target_lot_id: lots[0] }, suffix);
    assert.equal(result.status_code, code);
    assert.deepEqual(state, before);
  };
  source().flags.push('quest_locked');
  check('ERR_MERGE_LOT_PROTECTED', 'merge_guard_quest');
  source().flags = [];
  source().property_profile.freshness = 99;
  check('ERR_MERGE_LOTS_INCOMPATIBLE', 'merge_guard_quality');
  source().property_profile.freshness = 100;
  state.save_file.reservations.push({ reservation_id: 'merge_guard_reservation', actor_id: 'player',
    target_ref: { object_type: 'MaterialLot', object_id: source().lot_id }, quantity: { amount: 1, unit: 'g' },
    reason: 'merge_guard', created_time: state.save_file.world_time.absolute_minute, expire_time: null,
    status: 'active', source_action_id: null, flags: [] });
  check('ERR_ALREADY_RESERVED', 'merge_guard_reserved');
});

test('conflicting source-group identities reject without changing material, metadata or ID sequence', () => {
  const { runtime, state, contracts } = buildRuntime();
  const targetId = 'seed_cabbage_initial_001';
  const split = dispatch(runtime, state, 'split_lot', { source_lot_id: targetId, quantity: { amount: 1, unit: 'count' } }, 'group_conflict_split');
  assert.equal(split.success, true, split.status_code);
  const sourceId = split.created_objects[0]!.object_id;
  const source = runtime.inventory.findMaterialLot(state.save_file, sourceId);
  const group = (source.lineage_summary!.ordinary_source_groups as Array<{ source_ref: { source_id: string } }>)[0]!;
  group.source_ref.source_id = 'different_source';
  assert.throws(() => contracts.assertSaveFile(state.save_file), /ERR_SOURCE_GROUP_ID_CONFLICT/);
  const before = cloneForCompare(state);
  const result = dispatch(runtime, state, 'merge_lot', { source_lot_id: sourceId, target_lot_id: targetId }, 'group_conflict_merge');
  assert.equal(result.status_code, 'ERR_SOURCE_GROUP_ID_CONFLICT');
  assert.deepEqual(state, before);
});

test('completely consumed seeds retain their true source through save, harvest, cut and processing', () => {
  const { runtime, state, contracts } = buildRuntime();
  const originalSeed = cloneForCompare(runtime.inventory.findMaterialLot(state.save_file, 'seed_cabbage_initial_001'));
  const plant = dispatch(runtime, state, 'plant_crop', { field_plot_id: 'field_plot_01', seed_lot_id: originalSeed.lot_id,
    seed_quantity: { amount: 10, unit: 'count' }, seeds_per_tile: 2 }, 'seed_source_plant');
  assert.equal(plant.success, true, plant.status_code);
  assert.equal(state.save_file.inventory.some(lot => lot.lot_id === originalSeed.lot_id), false);
  const saved = new SaveManager().serialize(state);
  const restored = new SaveManager().deserializeSaveFile(saved);
  const cropId = plant.created_objects[0]!.object_id;
  assert.deepEqual(restored.save_file.crop_instances.find(crop => crop.crop_id === cropId)!.seed_lot_snapshot, originalSeed);
  contracts.assertSaveFile(restored.save_file);
  assert.equal(dispatch(runtime, restored, 'advance_time', { minutes: 5400 }, 'seed_source_time').success, true);
  const harvest = dispatch(runtime, restored, 'harvest_crop', { crop_id: cropId }, 'seed_source_harvest');
  assert.equal(harvest.success, true, harvest.status_code);
  const cabbageId = harvest.created_objects[0]!.object_id;
  const split = dispatch(runtime, restored, 'split_lot', { source_lot_id: cabbageId, quantity: { amount: 300, unit: 'g' } }, 'seed_source_cut');
  assert.equal(split.success, true, split.status_code);
  const cutId = split.created_objects[0]!.object_id;
  const processed = dispatch(runtime, restored, 'start_processing', { method_id: 'pickling_cabbage_basic', input_lots: [
    { lot_id: cutId, quantity: { amount: 300, unit: 'g' } },
    { lot_id: 'salt_initial_001', quantity: { amount: 15, unit: 'g' } }
  ], facility_ref: picklingFacilityRef }, 'seed_source_process');
  assert.equal(processed.success, true, processed.status_code);
  const task = restored.save_file.processing_tasks.find(item => item.task_id === processed.created_objects[0]!.object_id)!;
  assert.deepEqual(task.input_lot_refs[0]!.source_snapshot!.piece_portions![0]!.seed_lot_snapshot, originalSeed);
  const secondCropId = plant.created_objects[1]!.object_id;
  const secondHarvest = dispatch(runtime, restored, 'harvest_crop', { crop_id: secondCropId }, 'seed_source_harvest_dish');
  assert.equal(secondHarvest.success, true, secondHarvest.status_code);
  const cooked = dispatch(runtime, restored, 'cook_dish', { recipe_variant_id: 'bacon_cabbage_basic', ingredients: {
    main: { lot_id: secondHarvest.created_objects[0]!.object_id, quantity: { amount: 300, unit: 'g' } },
    side: { lot_id: 'bacon_initial_001', quantity: { amount: 50, unit: 'g' } },
    oil: { lot_id: 'oil_initial_001', quantity: { amount: 10, unit: 'ml' } }
  }, technique: 'stir_fry', operation_profile: { heat_level: 'high', active_minutes: 8 } }, 'seed_source_cook');
  assert.equal(cooked.success, true, cooked.status_code);
  const dish = restored.save_file.dish_lots.find(item => item.dish_lot_id === cooked.created_objects[0]!.object_id)!;
  assert.deepEqual(dish.components.find(component => component.role === 'main')!.source_snapshot!.piece_portions![0]!.seed_lot_snapshot, originalSeed);
  const roundTrip = new SaveManager().deserializeSaveFile(new SaveManager().serialize(restored));
  assert.deepEqual(roundTrip.save_file.dish_lots.find(item => item.dish_lot_id === dish.dish_lot_id)!.components.find(component => component.role === 'main')!.source_snapshot!.piece_portions![0]!.seed_lot_snapshot, originalSeed);
  contracts.assertSaveFile(roundTrip.save_file);
  contracts.assertSaveFile(restored.save_file);
});

test('one cabbage piece rejects conflicting known seed snapshots across inventory, crop, task and dish', () => {
  const { runtime, state, contracts } = buildRuntime();
  const planted = dispatch(runtime, state, 'plant_crop', { field_plot_id: 'field_plot_01', seed_lot_id: 'seed_cabbage_initial_001', seed_quantity: { amount: 1, unit: 'count' } }, 'seed_conflict_plant');
  assert.equal(planted.success, true, planted.status_code);
  assert.equal(dispatch(runtime, state, 'advance_time', { minutes: 5400 }, 'seed_conflict_time').success, true);
  const cropId = planted.created_objects[0]!.object_id;
  const harvested = dispatch(runtime, state, 'harvest_crop', { crop_id: cropId }, 'seed_conflict_harvest');
  assert.equal(harvested.success, true, harvested.status_code);
  const cabbageId = harvested.created_objects[0]!.object_id;
  const split = dispatch(runtime, state, 'split_lot', { source_lot_id: cabbageId, quantity: { amount: 300, unit: 'g' } }, 'seed_conflict_split');
  assert.equal(split.success, true, split.status_code);
  const taskResult = dispatch(runtime, state, 'start_processing', { method_id: 'pickling_cabbage_basic', input_lots: [
    { lot_id: split.created_objects[0]!.object_id, quantity: { amount: 300, unit: 'g' } },
    { lot_id: 'salt_initial_001', quantity: { amount: 15, unit: 'g' } }
  ], facility_ref: picklingFacilityRef }, 'seed_conflict_processing');
  assert.equal(taskResult.success, true, taskResult.status_code);
  const cookResult = dispatch(runtime, state, 'cook_dish', { recipe_variant_id: 'bacon_cabbage_basic', ingredients: {
    main: { lot_id: cabbageId, quantity: { amount: 300, unit: 'g' } },
    side: { lot_id: 'bacon_initial_001', quantity: { amount: 50, unit: 'g' } },
    oil: { lot_id: 'oil_initial_001', quantity: { amount: 10, unit: 'ml' } }
  }, technique: 'stir_fry', operation_profile: { heat_level: 'high', active_minutes: 8 } }, 'seed_conflict_cook');
  assert.equal(cookResult.success, true, cookResult.status_code);
  contracts.assertSaveFile(state.save_file);
  const makeConflict = (seed: { source_ref: { source_id: string } }) => { seed.source_ref.source_id = 'different_seed_source'; };
  for (const area of ['inventory', 'crop', 'task', 'dish'] as const) {
    const invalid = structuredClone(state.save_file);
    if (area === 'inventory') {
      const pieces = invalid.inventory.find(lot => lot.lot_id === cabbageId)!.cabbage_pieces!;
      if (pieces.kind !== 'cut') throw new Error('expected cut remainder');
      makeConflict(pieces.source_piece!.seed_lot_snapshot!);
    } else if (area === 'crop') makeConflict(invalid.crop_instances.find(crop => crop.crop_id === cropId)!.seed_lot_snapshot!);
    else if (area === 'task') makeConflict(invalid.processing_tasks.find(task => task.task_id === taskResult.created_objects[0]!.object_id)!.input_lot_refs[0]!.source_snapshot!.piece_portions![0]!.seed_lot_snapshot!);
    else makeConflict(invalid.dish_lots.find(dish => dish.dish_lot_id === cookResult.created_objects[0]!.object_id)!.components.find(component => component.role === 'main')!.source_snapshot!.piece_portions![0]!.seed_lot_snapshot!);
    assert.throws(() => contracts.assertSaveFile(invalid), /ERR_CABBAGE_SEED_SOURCE_CONFLICT/, area);
    if (area === 'dish') {
      const invalidState = { save_file: invalid, domain_events: structuredClone(state.domain_events) };
      const beforeAction = structuredClone(invalidState);
      const result = dispatch(runtime, invalidState, 'store_item', { object_ref: { object_type: 'DishLot', object_id: cookResult.created_objects[0]!.object_id },
        storage_ref: { location_id: 'home', storage_type: 'room_temp', container_id: 'home_room_temp_01' } }, 'seed_conflict_action');
      assert.equal(result.status_code, 'ERR_CABBAGE_SEED_SOURCE_CONFLICT');
      assert.deepEqual(invalidState, beforeAction);
    }
  }
  const invalidTask = structuredClone(state.save_file.processing_tasks.find(task => task.task_id === taskResult.created_objects[0]!.object_id)!);
  const duplicateInput = structuredClone(invalidTask.input_lot_refs[0]!);
  makeConflict(duplicateInput.source_snapshot!.piece_portions![0]!.seed_lot_snapshot!);
  invalidTask.input_lot_refs.push(duplicateInput);
  assert.throws(() => contracts.assertProcessingTask(invalidTask), /ERR_CABBAGE_SEED_SOURCE_CONFLICT/);
  const invalidDish = structuredClone(state.save_file.dish_lots.find(dish => dish.dish_lot_id === cookResult.created_objects[0]!.object_id)!);
  const duplicateComponent = structuredClone(invalidDish.components.find(component => component.role === 'main')!);
  makeConflict(duplicateComponent.source_snapshot!.piece_portions![0]!.seed_lot_snapshot!);
  invalidDish.components.push(duplicateComponent);
  assert.throws(() => contracts.assertDishLot(invalidDish), /ERR_CABBAGE_SEED_SOURCE_CONFLICT/);
  const unknown = structuredClone(state.save_file);
  delete unknown.crop_instances.find(crop => crop.crop_id === cropId)!.seed_lot_snapshot;
  const taskPiece = unknown.processing_tasks.find(task => task.task_id === taskResult.created_objects[0]!.object_id)!.input_lot_refs[0]!.source_snapshot!.piece_portions![0]!;
  delete taskPiece.seed_lot_snapshot;
  const before = structuredClone(unknown);
  assert.doesNotThrow(() => contracts.assertSaveFile(unknown));
  assert.deepEqual(unknown, before, 'unknown source remains unknown');
});

test('ordinary starter seed can be split and merged while preserving flags and total quantity', () => {
  const { runtime, state, contracts } = buildRuntime();
  const original = cloneForCompare(runtime.inventory.findMaterialLot(state.save_file, 'seed_cabbage_initial_001'));
  assert.equal(dispatch(runtime, state, 'advance_time', { minutes: 60 }, 'starter_merge_time').success, true);
  const split = dispatch(runtime, state, 'split_lot', { source_lot_id: original.lot_id, quantity: { amount: 1, unit: 'count' } }, 'starter_merge_split');
  assert.equal(split.success, true, split.status_code);
  const result = dispatch(runtime, state, 'merge_lot', { source_lot_id: split.created_objects[0]!.object_id, target_lot_id: original.lot_id }, 'starter_merge');
  assert.equal(result.success, true, result.status_code);
  const restored = runtime.inventory.findMaterialLot(state.save_file, original.lot_id);
  assert.deepEqual(restored.quantity, original.quantity);
  assert.deepEqual(restored.flags, original.flags);
  assert.equal(restored.created_time, original.created_time);
  const groups = restored.lineage_summary!.ordinary_source_groups as Array<{ origin_lot_id: string; created_time: number; source_ref: unknown }>;
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.origin_lot_id, original.lot_id);
  assert.equal(groups[0]!.created_time, original.created_time);
  assert.deepEqual(groups[0]!.source_ref, original.source_ref);
  assert.equal(restored.last_operation?.request.action_type, 'merge_lot');
  assert.deepEqual(restored.last_operation?.request.parameters, { source_lot_id: split.created_objects[0]!.object_id, target_lot_id: original.lot_id });
  assert.equal('request_id' in restored.last_operation!.request, false);
  assert.equal('idempotency_key' in restored.last_operation!.request, false);
  contracts.assertSaveFile(state.save_file);
  new StorageAudit(auditPolicies).assertReconciled(state.save_file);
});

test('split siblings retain protected seed origin and cannot be merged as ordinary', () => {
  const { runtime, state, contracts } = buildRuntime();
  const origin = runtime.inventory.findMaterialLot(state.save_file, 'seed_cabbage_initial_001');
  origin.source_ref.source_type = 'story';
  origin.source_ref.source_id = 'quest_seed';
  contracts.assertSaveFile(state.save_file);
  const one = dispatch(runtime, state, 'split_lot', { source_lot_id: origin.lot_id, quantity: { amount: 1, unit: 'count' } }, 'protected_first');
  const two = dispatch(runtime, state, 'split_lot', { source_lot_id: origin.lot_id, quantity: { amount: 1, unit: 'count' } }, 'protected_second');
  assert.equal(one.success, true, one.status_code);
  assert.equal(two.success, true, two.status_code);
  const before = structuredClone(state);
  const merged = dispatch(runtime, state, 'merge_lot', { source_lot_id: two.created_objects[0]!.object_id, target_lot_id: one.created_objects[0]!.object_id }, 'protected_join');
  assert.equal(merged.status_code, 'ERR_MERGE_LOT_PROTECTED');
  assert.deepEqual(state, before);
});

test('legacy special and unknown origins remain protected after split', () => {
  for (const origin of [
    { origin_type: 'MaterialLot', origin_id: 'special', source_ref: { source_type: 'story', source_id: 'quest', source_time: 360 } },
    { origin_type: 'MaterialLot', origin_id: 'unknown' }
  ]) {
    const { runtime, state } = buildRuntime();
    const seed = runtime.inventory.findMaterialLot(state.save_file, 'seed_cabbage_initial_001');
    seed.lineage_summary = { key_origins: [origin] };
    const split = dispatch(runtime, state, 'split_lot', { source_lot_id: seed.lot_id, quantity: { amount: 1, unit: 'count' } }, 'protected_legacy_split');
    assert.equal(split.success, true, split.status_code);
    const before = structuredClone(state);
    const merged = dispatch(runtime, state, 'merge_lot', { source_lot_id: split.created_objects[0]!.object_id, target_lot_id: seed.lot_id }, 'protected_legacy_merge');
    assert.equal(merged.status_code, 'ERR_MERGE_LOT_PROTECTED');
    assert.deepEqual(state, before);
  }
});

test('cabbage harvested from a protected seed retains its protected origin', () => {
  const { runtime, state } = buildRuntime();
  const seed = runtime.inventory.findMaterialLot(state.save_file, 'seed_cabbage_initial_001');
  seed.source_ref.source_type = 'story';
  seed.source_ref.source_id = 'quest_seed';
  const plant = dispatch(runtime, state, 'plant_crop', { field_plot_id: 'field_plot_01', seed_lot_id: seed.lot_id, seed_quantity: { amount: 2, unit: 'count' } }, 'protected_seed_plant');
  assert.equal(plant.success, true, plant.status_code);
  assert.equal(dispatch(runtime, state, 'advance_time', { minutes: 5400 }, 'protected_seed_time').success, true);
  const lots = plant.created_objects.map((crop, index) => {
    const result = dispatch(runtime, state, 'harvest_crop', { crop_id: crop.object_id }, `protected_seed_harvest_${index}`);
    assert.equal(result.success, true, result.status_code);
    return result.created_objects[0]!.object_id;
  });
  const before = structuredClone(state);
  const merged = dispatch(runtime, state, 'merge_lot', { source_lot_id: lots[1], target_lot_id: lots[0] }, 'protected_harvest_merge');
  assert.equal(merged.status_code, 'ERR_MERGE_LOT_PROTECTED');
  assert.deepEqual(state, before);
  const task = dispatch(runtime, state, 'start_processing', { method_id: 'pickling_cabbage_basic', input_lots: [
    { lot_id: lots[0], quantity: { amount: 600, unit: 'g' } },
    { lot_id: 'salt_initial_001', quantity: { amount: 30, unit: 'g' } }
  ], facility_ref: picklingFacilityRef }, 'protected_seed_processing');
  assert.equal(task.success, true, task.status_code);
  assert.equal(dispatch(runtime, state, 'advance_time', { minutes: 2880 }, 'protected_processing_time').success, true);
  const collected = dispatch(runtime, state, 'collect_processing_result', { task_id: task.created_objects[0]!.object_id }, 'protected_processing_collect');
  assert.equal(collected.success, true, collected.status_code);
  const output = collected.created_objects[0]!.object_id;
  const split = dispatch(runtime, state, 'split_lot', { source_lot_id: output, quantity: { amount: 100, unit: 'g' } }, 'protected_processing_split');
  assert.equal(split.success, true, split.status_code);
  const beforeProcessedMerge = structuredClone(state);
  const remerged = dispatch(runtime, state, 'merge_lot', { source_lot_id: split.created_objects[0]!.object_id, target_lot_id: output }, 'protected_processing_merge');
  assert.equal(remerged.status_code, 'ERR_MERGE_LOT_PROTECTED');
  assert.deepEqual(state, beforeProcessedMerge);
});

test('repeated formal split and merge retains unmodified legacy origins and only the latest operation', () => {
  const { runtime, state, contracts } = buildRuntime();
  const targetId = 'seed_cabbage_initial_001';
  const starter = runtime.inventory.findMaterialLot(state.save_file, targetId);
  starter.lineage_summary = { key_origins: [
    { origin_type: 'MaterialLot', origin_id: 'same_origin', source_ref: { ...starter.source_ref, source_time: 1 }, created_time: 1, last_update_time: 3 },
    { origin_type: 'MaterialLot', origin_id: 'same_origin', source_ref: { ...starter.source_ref, source_time: 1 }, created_time: 1, last_update_time: 3 },
    { origin_type: 'MaterialLot', origin_id: 'same_origin', source_ref: { ...starter.source_ref, source_time: 2 }, created_time: 2, last_update_time: 3 }
  ], important_flags: [], lineage_depth: 1, compressed: false, summary_text_key: null, debug_trace_ref: null };
  const oldSummary = structuredClone(starter.lineage_summary);
  const originalSave = new SaveManager().serialize(state);
  let groupId: string | undefined;
  for (let round = 0; round < 7; round++) {
    const split = dispatch(runtime, state, 'split_lot', { source_lot_id: targetId, quantity: { amount: 1, unit: 'count' } }, `lineage_split_${round}`);
    assert.equal(split.success, true, split.status_code);
    const sourceId = split.created_objects[0]!.object_id;
    const merged = dispatch(runtime, state, 'merge_lot', { source_lot_id: sourceId, target_lot_id: targetId }, `lineage_merge_${round}`);
    assert.equal(merged.success, true, merged.status_code);
    const lot = runtime.inventory.findMaterialLot(state.save_file, targetId);
    const groups = lot.lineage_summary!.ordinary_source_groups as Array<{ group_id: string; legacy_lineage: { key_origins: unknown[] } }>;
    assert.equal(groups.length, 1);
    groupId ??= groups[0]!.group_id;
    assert.equal(groups[0]!.group_id, groupId);
    assert.deepEqual(groups[0]!.legacy_lineage, oldSummary);
    const duplicate = groups[0]!.legacy_lineage.key_origins.filter(origin => (origin as { origin_id?: string; created_time?: number }).origin_id === 'same_origin'
      && (origin as { created_time?: number }).created_time === 1);
    assert.equal(duplicate.length, 2, 'identical historical entries retain their original multiplicity');
    assert.equal(lot.last_operation?.request.action_type, 'merge_lot');
    assert.deepEqual(lot.last_operation?.request.parameters, { source_lot_id: split.created_objects[0]!.object_id, target_lot_id: targetId });
    contracts.assertSaveFile(state.save_file);
  }
  assert.deepEqual(new SaveManager().deserializeSaveFile(originalSave).save_file.inventory.find(lot => lot.lot_id === targetId)!.lineage_summary, oldSummary);
});

test('sibling split and merge reuses source group and stores only the latest operation', (t) => {
  const { runtime, state, contracts } = buildRuntime();
  const targetId = 'seed_cabbage_initial_001';
  const counts: number[] = [];
  for (let round = 0; round < 30; round++) {
    const split1 = dispatch(runtime, state, 'split_lot', { source_lot_id: targetId, quantity: { amount: 1, unit: 'count' } }, `siblings_a_${round}`);
    const split2 = dispatch(runtime, state, 'split_lot', { source_lot_id: targetId, quantity: { amount: 1, unit: 'count' } }, `siblings_b_${round}`);
    assert.equal(split1.success, true, split1.status_code);
    assert.equal(split2.success, true, split2.status_code);
    const first = split1.created_objects[0]!.object_id, second = split2.created_objects[0]!.object_id;
    const parentGroup = runtime.inventory.findMaterialLot(state.save_file, targetId).lineage_summary!.ordinary_source_groups as object[];
    const childGroup = runtime.inventory.findMaterialLot(state.save_file, first).lineage_summary!.ordinary_source_groups as object[];
    assert.notStrictEqual(parentGroup, childGroup);
    assert.notStrictEqual(parentGroup[0], childGroup[0]);
    assert.deepEqual(parentGroup, childGroup);
    const siblingMerge = dispatch(runtime, state, 'merge_lot', { source_lot_id: second, target_lot_id: first }, `siblings_join_${round}`);
    assert.equal(siblingMerge.success, true, siblingMerge.status_code);
    const parentMerge = dispatch(runtime, state, 'merge_lot', { source_lot_id: first, target_lot_id: targetId }, `siblings_return_${round}`);
    assert.equal(parentMerge.success, true, parentMerge.status_code);
    const target = runtime.inventory.findMaterialLot(state.save_file, targetId);
    assert.equal(target.quantity.amount, 10);
    const groups = target.lineage_summary!.ordinary_source_groups as Array<{ group_id: string; origin_lot_id: string }>;
    counts.push(groups.length);
    assert.equal(groups.length, 1);
    assert.equal(groups[0]!.origin_lot_id, targetId);
    assert.equal(target.last_operation?.request.action_type, 'merge_lot');
    assert.deepEqual(target.last_operation?.request.parameters, { source_lot_id: first, target_lot_id: targetId });
    contracts.assertSaveFile(state.save_file);
  }
  t.diagnostic(`source-group counts: ${counts.join(', ')}`);
});

test('a processed cabbage lot can be split and remerged without losing its origin history', () => {
  const { runtime, state, contracts } = buildRuntime();
  const outputId = preparePickledCabbage(runtime, state);
  const original = cloneForCompare(runtime.inventory.findMaterialLot(state.save_file, outputId));
  const split = dispatch(runtime, state, 'split_lot', { source_lot_id: outputId, quantity: { amount: 100, unit: 'g' } }, 'processed_merge_split');
  assert.equal(split.success, true, split.status_code);
  const merged = dispatch(runtime, state, 'merge_lot', { source_lot_id: split.created_objects[0]!.object_id, target_lot_id: outputId }, 'processed_merge');
  assert.equal(merged.success, true, merged.status_code);
  const restored = runtime.inventory.findMaterialLot(state.save_file, outputId);
  assert.deepEqual(restored.quantity, original.quantity);
  assert.deepEqual(restored.flags, original.flags);
  assert.deepEqual(restored.processing_history, original.processing_history);
  assert.equal(restored.lineage_summary?.summary_text_key, original.lineage_summary?.summary_text_key);
  contracts.assertSaveFile(state.save_file);
  new StorageAudit(auditPolicies).assertReconciled(state.save_file);
});

test('merge refuses two processed lots with different non-routine summaries', () => {
  const { runtime, state, contracts } = buildRuntime();
  const targetId = preparePickledCabbage(runtime, state);
  const split = dispatch(runtime, state, 'split_lot', { source_lot_id: targetId, quantity: { amount: 100, unit: 'g' } }, 'processed_summary_split');
  assert.equal(split.success, true);
  const sourceId = split.created_objects[0]!.object_id;
  const source = runtime.inventory.findMaterialLot(state.save_file, sourceId);
  source.source_ref.source_type = 'processing';
  source.lineage_summary!.summary_text_key = 'event.processing.different.completed';
  contracts.assertSaveFile(state.save_file);
  const before = cloneForCompare(state);
  const refused = dispatch(runtime, state, 'merge_lot', { source_lot_id: sourceId, target_lot_id: targetId }, 'processed_summary_merge');
  assert.equal(refused.status_code, 'ERR_MERGE_LOTS_INCOMPATIBLE');
  assert.deepEqual(state, before);
});

test('failed cooking after partial whole-cabbage consumption restores state and generated ID sequence', () => {
  const { runtime, state } = buildRuntime();
  const plant = dispatch(runtime, state, 'plant_crop', { field_plot_id: 'field_plot_01', seed_lot_id: 'seed_cabbage_initial_001', seed_quantity: { amount: 2, unit: 'count' } }, 'rollback_pieces_plant');
  assert.equal(plant.success, true);
  assert.equal(dispatch(runtime, state, 'advance_time', { minutes: 5400 }, 'rollback_pieces_time').success, true);
  const lots = plant.created_objects.map((object, index) => {
    const result = dispatch(runtime, state, 'harvest_crop', { crop_id: object.object_id }, `rollback_pieces_harvest_${index}`);
    assert.equal(result.success, true);
    return result.created_objects[0]!.object_id;
  });
  assert.equal(dispatch(runtime, state, 'merge_lot', { source_lot_id: lots[1], target_lot_id: lots[0] }, 'rollback_pieces_merge').success, true);
  const before = cloneForCompare(state);
  const failed = dispatch(runtime, state, 'cook_dish', {
    recipe_variant_id: 'bacon_cabbage_basic', ingredients: {
      main: { lot_id: lots[0], quantity: { amount: 300, unit: 'g' } },
      side: { lot_id: 'bacon_initial_001', quantity: { amount: 50, unit: 'g' } },
      oil: { lot_id: 'oil_initial_001', quantity: { amount: 10, unit: 'ml' } }
    }, technique: 'stir_fry', operation_profile: { heat_level: 'high', active_minutes: 8 },
    target_storage_ref: { location_id: 'home', storage_type: 'room_temp', container_id: 'missing_container' }
  }, 'rollback_pieces_cook');
  assert.equal(failed.success, false);
  assert.deepEqual(state, before);
  const split = dispatch(runtime, state, 'split_lot', { source_lot_id: lots[0], quantity: { amount: 1, unit: 'count' } }, 'rollback_pieces_split');
  assert.equal(split.success, true);
  assert.equal(split.created_objects[0]!.object_id, 'lot_split_000001');
});

test('result and event contract failures roll back action state and runtime IDs', () => {
  for (const failurePoint of ['event', 'result'] as const) {
    const { runtime, state, contracts } = buildRuntime();
    const plant = dispatch(runtime, state, 'plant_crop', { field_plot_id: 'field_plot_01', seed_lot_id: 'seed_cabbage_initial_001', seed_quantity: { amount: 1, unit: 'count' } }, `audit_${failurePoint}_plant`);
    assert.equal(plant.success, true);
    assert.equal(dispatch(runtime, state, 'advance_time', { minutes: 5400 }, `audit_${failurePoint}_time`).success, true);
    const before = cloneForCompare(state);
    const originalEvent = contracts.assertDomainEvent.bind(contracts);
    const originalResult = contracts.assertActionResult.bind(contracts);
    if (failurePoint === 'event') contracts.assertDomainEvent = () => { throw new Error('ERR_FAULT_EVENT'); };
    else contracts.assertActionResult = result => {
      if (result.success) throw new Error('ERR_FAULT_RESULT');
      return originalResult(result);
    };
    const failed = dispatch(runtime, state, 'harvest_crop', { crop_id: plant.created_objects[0]!.object_id }, `audit_${failurePoint}_failed`);
    assert.equal(failed.status_code, failurePoint === 'event' ? 'ERR_FAULT_EVENT' : 'ERR_FAULT_RESULT');
    assert.deepEqual(state, before);
    contracts.assertDomainEvent = originalEvent;
    contracts.assertActionResult = originalResult;
    const accepted = dispatch(runtime, state, 'harvest_crop', { crop_id: plant.created_objects[0]!.object_id }, `audit_${failurePoint}_retry`);
    assert.equal(accepted.success, true);
    assert.equal(accepted.created_objects[0]!.object_id, 'lot_harvest_000001');
  }
});

test('a handler returning failure rolls back state and IDs', () => {
  const { runtime, state, contracts } = buildRuntime();
  const handlers = new ActionHandlerRegistry();
  const results = new ActionResultFactory();
  handlers.register({ actionType: 'advance_time', execute: (current, request) => {
    current.save_file.world_time.absolute_minute += 1;
    runtime.ids.next('test_handler');
    return results.failure(request, 'ERR_HANDLER_REFUSED');
  } });
  const pipeline = new ActionPipeline(handlers, undefined, undefined, undefined, undefined, contracts, runtime.ids);
  const before = cloneForCompare(state);
  const result = pipeline.dispatch(state, { request_id: 'failure_handler', actor_id: 'player', action_type: 'advance_time',
    created_time: state.save_file.world_time.absolute_minute, idempotency_key: 'failure_handler', parameters: { minutes: 1 } });
  assert.equal(result.status_code, 'ERR_HANDLER_REFUSED');
  assert.deepEqual(state, before);
  assert.equal(runtime.ids.next('test_handler'), 'test_handler_000001');
});

function dispatch(runtime: GameRuntime, state: GameState, action_type: string, parameters: unknown, suffix: string) {
  return runtime.pipeline.dispatch(state, {
    request_id: `req_${suffix}`,
    actor_id: 'player',
    action_type,
    created_time: state.save_file.world_time.absolute_minute,
    idempotency_key: `idem_${suffix}`,
    parameters
  });
}

test('latest action summary preserves formal context and legacy full requests remain readable', () => {
  const { runtime, state, contracts } = buildRuntime();
  const request = { request_id: 'transient_request', idempotency_key: 'transient_idempotency', actor_id: 'player',
    action_type: 'split_lot', created_time: state.save_file.world_time.absolute_minute,
    parameters: { source_lot_id: 'seed_cabbage_initial_001', quantity: { amount: 1, unit: 'count' } },
    target_refs: [{ object_type: 'MaterialLot', object_id: 'seed_cabbage_initial_001' }],
    context_ref: { location_id: 'home' }, desired_outcome: { intent: 'split' }, preview_only: false };
  const result = runtime.pipeline.dispatch(state, request);
  assert.equal(result.success, true, result.status_code);
  const lot = runtime.inventory.findMaterialLot(state.save_file, result.created_objects[0]!.object_id);
  const { request_id: _id, idempotency_key: _key, ...expected } = request;
  assert.deepEqual(lot.last_operation, { request: expected, executed_at: state.save_file.world_time.absolute_minute });
  const legacy = structuredClone(state.save_file);
  legacy.inventory.find(item => item.lot_id === lot.lot_id)!.last_operation = { request, executed_at: state.save_file.world_time.absolute_minute };
  const before = structuredClone(legacy);
  contracts.assertSaveFile(legacy);
  assert.deepEqual(legacy, before, 'existing full request is not rewritten on read');
  const invalid = structuredClone(state.save_file);
  invalid.inventory.find(item => item.lot_id === lot.lot_id)!.last_operation!.request.parameters = { source_lot_id: 'x' };
  assert.throws(() => contracts.assertSaveFile(invalid), /ERR_SCHEMA_VALIDATION_FAILED/);
});

function prepareHarvestedCabbage(runtime: GameRuntime, state: GameState): string {
  const plant = dispatch(runtime, state, 'plant_crop', { field_plot_id: 'field_plot_01', seed_lot_id: 'seed_cabbage_initial_001', seed_quantity: { amount: 1, unit: 'count' } }, 'prepare_plant');
  assert.equal(plant.success, true);
  dispatch(runtime, state, 'advance_time', { minutes: 5400 }, 'prepare_time');
  const harvest = dispatch(runtime, state, 'harvest_crop', { crop_id: plant.created_objects[0]!.object_id }, 'prepare_harvest');
  assert.equal(harvest.success, true);
  return harvest.created_objects[0]!.object_id;
}

function prepareProcessingTask(runtime: GameRuntime, state: GameState): string {
  const cabbageLotId = prepareHarvestedCabbage(runtime, state);
  const split = dispatch(runtime, state, 'split_lot', { source_lot_id: cabbageLotId, quantity: { amount: 300, unit: 'g' } }, 'prepare_split');
  assert.equal(split.success, true);
  const start = dispatch(runtime, state, 'start_processing', {
    method_id: 'pickling_cabbage_basic',
    input_lots: [
      { lot_id: split.created_objects[0]!.object_id, quantity: { amount: 300, unit: 'g' } },
      { lot_id: 'salt_initial_001', quantity: { amount: 15, unit: 'g' } }
    ],
    facility_ref: picklingFacilityRef
  }, 'prepare_start_processing');
  assert.equal(start.success, true);
  return start.created_objects[0]!.object_id;
}



function preparePickledCabbage(runtime: GameRuntime, state: GameState): string {
  const taskId = prepareProcessingTask(runtime, state);
  const ready = dispatch(runtime, state, 'advance_time', { minutes: 2880 }, 'prepare_pickled_ready');
  assert.equal(ready.success, true);
  const collect = dispatch(runtime, state, 'collect_processing_result', { task_id: taskId }, 'prepare_pickled_collect');
  assert.equal(collect.success, true);
  return collect.created_objects[0]!.object_id;
}

function cookBaconCabbage(runtime: GameRuntime, state: GameState, pickledLotId: string, suffix = 'cook_bacon_cabbage') {
  return dispatch(runtime, state, 'cook_dish', {
    recipe_variant_id: 'bacon_cabbage_basic',
    ingredients: {
      main: { lot_id: pickledLotId, quantity: { amount: 250, unit: 'g' } },
      side: { lot_id: 'bacon_initial_001', quantity: { amount: 50, unit: 'g' } },
      oil: { lot_id: 'oil_initial_001', quantity: { amount: 10, unit: 'ml' } }
    },
    technique: 'stir_fry',
    operation_profile: { heat_level: 'high', active_minutes: 8 },
    target_storage_ref: { location_id: 'home', storage_type: 'room_temp', container_id: 'home_room_temp_01' }
  }, suffix);
}

test('cooked dish records latest action on creation and transfer and old dishes remain valid', () => {
  const { runtime, state, contracts } = buildRuntime();
  const original = state.save_file.storage_containers.find(container => container.container_id === 'home_room_temp_01')!;
  const extra = structuredClone(original);
  extra.container_id = 'home_room_temp_test_02';
  state.save_file.storage_containers.push(extra);
  runtime.storageReconciler.reconcile(state.save_file);
  const pickled = preparePickledCabbage(runtime, state);
  const cooked = cookBaconCabbage(runtime, state, pickled, 'dish_latest_create');
  assert.equal(cooked.success, true, cooked.status_code);
  const dishId = cooked.created_objects[0]!.object_id;
  const dish = state.save_file.dish_lots.find(item => item.dish_lot_id === dishId)!;
  assert.equal(dish.last_operation?.request.action_type, 'cook_dish');
  assert.equal('request_id' in dish.last_operation!.request, false);
  assert.equal('idempotency_key' in dish.last_operation!.request, false);
  const old = structuredClone(state.save_file);
  delete old.dish_lots.find(item => item.dish_lot_id === dishId)!.last_operation;
  assert.doesNotThrow(() => contracts.assertSaveFile(old));
  assert.equal(old.dish_lots.find(item => item.dish_lot_id === dishId)!.last_operation, undefined);
  const moved = dispatch(runtime, state, 'store_item', { object_ref: { object_type: 'DishLot', object_id: dishId },
    storage_ref: { location_id: 'home', storage_type: 'room_temp', container_id: extra.container_id } }, 'dish_latest_move');
  assert.equal(moved.success, true, moved.status_code);
  assert.equal(state.save_file.dish_lots.find(item => item.dish_lot_id === dishId)!.last_operation?.request.action_type, 'store_item');
  const restored = new SaveManager().deserializeSaveFile(new SaveManager().serialize(state));
  contracts.assertSaveFile(restored.save_file);
  assert.deepEqual(restored.save_file.dish_lots.find(item => item.dish_lot_id === dishId)!.last_operation, state.save_file.dish_lots.find(item => item.dish_lot_id === dishId)!.last_operation);
});

test('integer split requests preserve represented deductions for count, grams and millilitres at large finite quantities', () => {
  for (const id of ['seed_cabbage_initial_001', 'salt_initial_001', 'oil_initial_001']) {
    const { runtime, state, configs, contracts } = buildRuntime();
    useLegacyCapacity(state);
    const source = runtime.inventory.findMaterialLot(state.save_file, id);
    const definition = Object.values(configs.loadStage1A().documents).find((value) => {
      const candidate = value as { id?: string; storage_footprint_rule?: unknown };
      return candidate?.id === source.base_id && candidate.storage_footprint_rule;
    }) as { storage_footprint_rule: { base_quantity: { amount: number }; footprint: { amount: number } } };
    source.quantity.amount = 2 ** 53 + 2;
    source.storage_footprint.amount = Math.ceil(source.quantity.amount / definition.storage_footprint_rule.base_quantity.amount
      * definition.storage_footprint_rule.footprint.amount);
    state.save_file.storage_containers.find((container) => container.container_id === source.storage_ref.container_id)!.capacity.amount = Number.MAX_VALUE;
    runtime.storageReconciler.reconcile(state.save_file);
    contracts.assertSaveFile(state.save_file);
    new StorageAudit(auditPolicies).assertReconciled(state.save_file);
    const before = cloneForCompare(state);
    const failed = dispatch(runtime, state, 'split_lot', { source_lot_id: id, quantity: { amount: 1, unit: source.quantity.unit } }, 'integer_precision_split');
    assert.equal(failed.success, false, `${source.quantity.unit}: an integer request must not deduct two units for one`);
    assert.equal(failed.status_code, 'ERR_SPLIT_QUANTITY_NOT_REPRESENTABLE');
    assert.deepEqual(state, before);
    const full = dispatch(runtime, state, 'split_lot', { source_lot_id: id, quantity: { ...source.quantity } }, 'integer_precision_full_recovery');
    assert.equal(full.success, true);
    assert.equal(full.created_objects[0]?.object_id, 'lot_split_000001');
    assert.equal(runtime.inventory.findMaterialLot(state.save_file, full.created_objects[0]!.object_id).quantity.amount, source.quantity.amount);
    assert.equal(state.save_file.inventory.some((lot) => lot.lot_id === id), false);
    contracts.assertSaveFile(state.save_file);
    new StorageAudit(auditPolicies).assertReconciled(state.save_file);
  }
});

test('consecutive decimal splits preserve exact represented amounts in old and physical saves', () => {
  for (const legacy of [true, false]) {
   for (const [initialId, unit] of [['salt_initial_001', 'g'], ['oil_initial_001', 'ml']] as const) {
    const { runtime, state, contracts } = buildRuntime();
    if (legacy) useLegacyCapacity(state);
    const first = dispatch(runtime, state, 'split_lot', { source_lot_id: initialId, quantity: { amount: 0.3, unit } }, `decimal_first_${legacy}_${unit}`);
    assert.equal(first.success, true, first.status_code);
    const sourceId = first.created_objects[0]!.object_id;
    const reservationId = injectTestReservation(state, 'bacon_initial_001', 1, `decimal_${legacy}_${unit}`);
    const beforeTiny = structuredClone(state), idsBeforeTiny = runtime.ids.checkpoint();
    assert.throws(() => runtime.inventory.assertCanSplit(state.save_file, sourceId, { amount: 1e-17, unit }), /ERR_SPLIT_QUANTITY_NOT_REPRESENTABLE/);
    assert.deepEqual(state, beforeTiny);
    assert.deepEqual(runtime.ids.checkpoint(), idsBeforeTiny);
    assert.equal(state.save_file.reservations.find(item => item.reservation_id === reservationId)!.status, 'active');
    const tiny = dispatch(runtime, state, 'split_lot', { source_lot_id: sourceId, quantity: { amount: 1e-17, unit } }, `decimal_tiny_${legacy}_${unit}`);
    assert.equal(tiny.status_code, 'ERR_SPLIT_QUANTITY_NOT_REPRESENTABLE');
    assert.deepEqual(state, beforeTiny);
    assert.deepEqual(runtime.ids.checkpoint(), idsBeforeTiny);
    runtime.inventory.assertCanSplit(state.save_file, sourceId, { amount: 0.1, unit });
    assert.deepEqual(state, beforeTiny);
    const second = dispatch(runtime, state, 'split_lot', { source_lot_id: sourceId, quantity: { amount: 0.1, unit } }, `decimal_second_${legacy}_${unit}`);
    assert.equal(second.success, true, second.status_code);
    assert.equal(second.created_objects[0]!.summary!.quantity!.amount, 0.1);
    assert.equal(second.updated_objects.find(item => item.object_type === 'MaterialLot' && item.object_id === sourceId)!.summary!.quantity!.amount, 0.2);
    assert.equal(runtime.inventory.findMaterialLot(state.save_file, sourceId).quantity.amount, 0.2);
    assert.equal(runtime.inventory.findMaterialLot(state.save_file, second.created_objects[0]!.object_id).quantity.amount, 0.1);
    assert.equal(runtime.inventory.findMaterialLot(state.save_file, initialId).quantity.amount, unit === 'g' ? 199.7 : 99.7);
    const third = dispatch(runtime, state, 'split_lot', { source_lot_id: sourceId, quantity: { amount: 0.1, unit } }, `decimal_third_${legacy}_${unit}`);
    assert.equal(third.success, true, third.status_code);
    assert.equal(runtime.inventory.findMaterialLot(state.save_file, sourceId).quantity.amount, 0.1);
    assert.equal(runtime.inventory.findMaterialLot(state.save_file, third.created_objects[0]!.object_id).quantity.amount, 0.1);
    const restored = new SaveManager().deserializeSaveFile(new SaveManager().serialize(state));
    assert.equal(runtime.inventory.findMaterialLot(restored.save_file, sourceId).quantity.amount, 0.1);
    contracts.assertSaveFile(restored.save_file);
   }
  }
});

test('split quantities reject invalid or unrepresentable changes before allocating objects and preserve full state', () => {
  const { runtime, state } = buildRuntime();
  const before = cloneForCompare(state);
  for (const [source_lot_id, amount, unit] of [
    ['salt_initial_001', 0, 'g'], ['salt_initial_001', -1, 'g'],
    ['salt_initial_001', NaN, 'g'], ['salt_initial_001', Infinity, 'g'],
    ['salt_initial_001', '1', 'g'], ['salt_initial_001', true, 'g'],
    ['seed_cabbage_initial_001', 0.5, 'count'],
    ['salt_initial_001', Number.MIN_VALUE, 'g'],
    ['salt_initial_001', 201, 'g'], ['salt_initial_001', 1, 'ml']
  ] as const) {
    const result = dispatch(runtime, state, 'split_lot', { source_lot_id, quantity: { amount, unit } }, 'split_quantity_invalid');
    assert.equal(result.success, false, String(amount) + ' ' + unit);
    assert.deepEqual(result.domain_events, []);
    assert.deepEqual(result.event_log_entries, []);
    assert.deepEqual(state, before);
  }
  const healthy = dispatch(runtime, state, 'split_lot', { source_lot_id: 'salt_initial_001', quantity: { amount: 0.25, unit: 'g' } }, 'split_quantity_recovered');
  assert.equal(healthy.success, true);
  assert.equal(healthy.created_objects[0]?.object_id, 'lot_split_000001');
  assert.equal(healthy.domain_events[0]?.event_id, 'evt_000001');
});

test('independent split validation is read-only and shares formal quantity, unit, reservation and footprint rules', () => {
  const { runtime, state } = buildRuntime();
  const original = cloneForCompare(state);
  for (const [source, amount, unit, code] of [
    ['salt_initial_001', 201, 'g', 'ERR_NOT_ENOUGH_RESOURCE'],
    ['salt_initial_001', 1, 'ml', 'ERR_QUANTITY_UNIT_MISMATCH'],
    ['seed_cabbage_initial_001', 0.5, 'count', 'ERR_SPLIT_QUANTITY_INVALID'],
    ['salt_initial_001', Number.MIN_VALUE, 'g', 'ERR_SPLIT_QUANTITY_NOT_REPRESENTABLE']
  ] as const) {
    assert.throws(() => runtime.inventory.assertCanSplit(state.save_file, source, { amount, unit }), new RegExp(code));
    assert.deepEqual(state, original);
  }
  assert.doesNotThrow(() => runtime.inventory.assertCanSplit(state.save_file, 'salt_initial_001', { amount: 0.25, unit: 'g' }));
  assert.doesNotThrow(() => runtime.inventory.assertCanSplit(state.save_file, 'salt_initial_001', { amount: 200, unit: 'g' }));
  assert.deepEqual(state, original);
  const reservationId = injectTestReservation(state, 'salt_initial_001', 1, 'validation');
  const reserved = cloneForCompare(state);
  assert.throws(() => runtime.inventory.assertCanSplit(state.save_file, 'salt_initial_001', { amount: 1, unit: 'g' }), /ERR_ALREADY_RESERVED/);
  assert.deepEqual(state, reserved);
  releaseTestReservation(state, reservationId);
  const result = dispatch(runtime, state, 'split_lot', { source_lot_id: 'salt_initial_001', quantity: { amount: 0.25, unit: 'g' } }, 'independent_split_recovery');
  assert.equal(result.success, true);
  assert.equal(result.created_objects[0]?.object_id, 'lot_split_000001');
  assert.equal(result.domain_events[0]?.event_id, 'evt_000001');
});

test('independent capacity validation rejects a partial split without consuming IDs but allows a full split at capacity', () => {
  const { runtime, state } = buildRuntime();
  useLegacyCapacity(state);
  const source = runtime.inventory.findMaterialLot(state.save_file, 'salt_initial_001');
  const container = state.save_file.storage_containers.find(item => item.container_id === source.storage_ref.container_id)!;
  container.capacity.amount = container.used_capacity;
  const before = cloneForCompare(state);
  assert.throws(() => runtime.inventory.assertCanSplit(state.save_file, source.lot_id, { amount: 1, unit: 'g' }), /ERR_STORAGE_CAPACITY_OVERFLOW/);
  assert.deepEqual(state, before);
  const failed = dispatch(runtime, state, 'split_lot', { source_lot_id: source.lot_id, quantity: { amount: 1, unit: 'g' } }, 'full_room_failure');
  assert.equal(failed.status_code, 'ERR_STORAGE_CAPACITY_OVERFLOW');
  assert.deepEqual(state, before);
  assert.doesNotThrow(() => runtime.inventory.assertCanSplit(state.save_file, source.lot_id, { ...source.quantity }));
  assert.deepEqual(state, before);
  const full = dispatch(runtime, state, 'split_lot', { source_lot_id: source.lot_id, quantity: { ...source.quantity } }, 'full_room_full_split');
  assert.equal(full.success, true);
  assert.equal(full.created_objects[0]?.object_id, 'lot_split_000001');
  assert.equal(full.domain_events[0]?.event_id, 'evt_000001');
  new StorageAudit(auditPolicies).assertReconciled(state.save_file);
});

test('full splits remove the empty source while preserving inherited data, lineage and reconciled capacity', () => {
  for (const id of ['salt_initial_001', 'seed_cabbage_initial_001']) {
    const { runtime, state, contracts } = buildRuntime();
    const original = cloneForCompare(runtime.inventory.findMaterialLot(state.save_file, id));
    const beforeCapacity = state.save_file.storage_containers.find((container) => container.container_id === original.storage_ref.container_id)!.used_capacity;
    const result = dispatch(runtime, state, 'split_lot', { source_lot_id: id, quantity: original.quantity }, 'full_split');
    assert.equal(result.success, true);
    assert.equal(state.save_file.inventory.some((lot) => lot.lot_id === id), false);
    const created = runtime.inventory.findMaterialLot(state.save_file, result.created_objects[0]!.object_id);
    assert.deepEqual(created.quantity, original.quantity);
    assert.deepEqual(created.storage_footprint, original.storage_footprint);
    assert.deepEqual(created.property_profile, original.property_profile);
    assert.deepEqual(created.storage_ref, original.storage_ref);
    assert.equal(created.source_ref.source_type, 'inventory_split');
    assert.equal(created.source_ref.source_id, original.lot_id);
    const groups = created.lineage_summary?.ordinary_source_groups as Array<{ origin_lot_id: string; source_ref: unknown }>;
    assert.equal(groups.length, 1);
    assert.equal(groups[0]!.origin_lot_id, original.lot_id);
    assert.deepEqual(groups[0]!.source_ref, original.source_ref);
    assert.equal(created.last_operation?.request.action_type, 'split_lot');
    assert.deepEqual(result.updated_objects.find((object) => object.object_id === id)?.summary, { status: 'consumed' });
    assert.equal(result.domain_events.some((event) => event.event_type === 'inventory.lot_updated'), false);
    assert.equal(state.save_file.inventory.every((lot) => lot.quantity.amount > 0), true);
    assert.equal(state.save_file.storage_containers.some((container) => container.active_object_refs.some((ref) => ref.object_id === id)), false);
    assert.equal(state.save_file.storage_containers.find((container) => container.container_id === original.storage_ref.container_id)!.used_capacity, beforeCapacity);
    contracts.assertSaveFile(state.save_file);
    new StorageAudit(auditPolicies).assertReconciled(state.save_file);
  }
});

test('repeated splits derive both footprints from definitions instead of rounding a previous footprint', () => {
  const { runtime, state, contracts } = buildRuntime();
  const source = prepareHarvestedCabbage(runtime, state);
  for (const amount of [300, 50, 50]) {
    const result = dispatch(runtime, state, 'split_lot', { source_lot_id: source, quantity: { amount, unit: 'g' } }, 'repeated_split_footprint');
    assert.equal(result.success, true);
    const remaining = runtime.inventory.findMaterialLot(state.save_file, source);
    const created = runtime.inventory.findMaterialLot(state.save_file, result.created_objects[0]!.object_id);
    assert.equal(remaining.storage_footprint.amount, Math.ceil(remaining.quantity.amount / 100));
    assert.equal(created.storage_footprint.amount, Math.ceil(amount / 100));
    new StorageAudit(auditPolicies).assertReconciled(state.save_file);
  }
  assert.equal(runtime.inventory.findMaterialLot(state.save_file, source).quantity.amount, 800);
  assert.equal(runtime.inventory.findMaterialLot(state.save_file, source).storage_footprint.amount, 8);
  contracts.assertSaveFile(state.save_file);
});

test('valid gram and millilitre fractions and integer counts keep exact selected quantities and positive footprints', () => {
  for (const [id, amount, unit] of [['salt_initial_001', 0.25, 'g'], ['oil_initial_001', 0.1, 'ml'], ['seed_cabbage_initial_001', 1, 'count']] as const) {
    const { runtime, state, contracts } = buildRuntime();
    const original = cloneForCompare(runtime.inventory.findMaterialLot(state.save_file, id));
    const result = dispatch(runtime, state, 'split_lot', { source_lot_id: id, quantity: { amount, unit } }, 'fraction_split');
    assert.equal(result.success, true);
    const created = runtime.inventory.findMaterialLot(state.save_file, result.created_objects[0]!.object_id);
    const remaining = runtime.inventory.findMaterialLot(state.save_file, id);
    assert.deepEqual(created.quantity, { amount, unit });
    assert.equal(remaining.quantity.amount, original.quantity.amount - amount);
    assert.equal(created.quantity.amount + remaining.quantity.amount, original.quantity.amount);
    assert.equal(created.storage_footprint.amount, 1);
    contracts.assertSaveFile(state.save_file);
    new StorageAudit(auditPolicies).assertReconciled(state.save_file);
  }
});

test('split validates loaded definitions without hardcoded identities and rejects unsafe count subtraction', () => {
  const initial = buildRuntime();
  const snapshot = cloneForCompare(initial.snapshot);
  const originalDefinition = snapshot.loaded_documents['configs/materials/seasonings/salt.yaml'] as Record<string, unknown>;
  const definition = { ...cloneForCompare(originalDefinition), id: 'probe_mineral', storage_footprint_rule: { base_quantity: { amount: 50, unit: 'g' }, footprint: { amount: 2, unit: 'slot_weight' } } };
  snapshot.loaded_documents['configs/materials/custom/probe_mineral.yaml'] = definition;
  const policyConfig = snapshot.loaded_documents['configs/storage/physical_capacity_policies.yaml'] as { policies: Array<{ rules: Array<{ definition_id: string }> }> };
  const saltRule = policyConfig.policies[0]!.rules.find(rule => rule.definition_id === 'salt')!;
  policyConfig.policies[0]!.rules.push({ ...cloneForCompare(saltRule), definition_id: 'probe_mineral' });
  const world = snapshot.loaded_documents['configs/initial_world/stage_1A_initial_world.yaml'] as { initial_inventory: typeof initial.state.save_file.inventory };
  const configured = world.initial_inventory.find((lot) => lot.lot_id === 'salt_initial_001')!;
  configured.base_id = 'probe_mineral';
  configured.definition_ref = { type: 'material', id: 'probe_mineral', canonical_id: 'base:probe_mineral' };
  configured.storage_footprint = { amount: 8, unit: 'slot_weight' };
  const configs = new ConfigRepository(snapshot);
  const state = new NewGameBuilder(configs).buildStage1A({ buildId: 'quantity_config_test', nowIso8601: '2026-05-18T00:00:00.000Z' });
  const runtime = new GameRuntime(configs, initial.contracts);
  const split = dispatch(runtime, state, 'split_lot', { source_lot_id: configured.lot_id, quantity: { amount: 25, unit: 'g' } }, 'configured_split');
  assert.equal(split.success, true);
  assert.equal(runtime.inventory.findMaterialLot(state.save_file, configured.lot_id).storage_footprint.amount, 7);
  assert.equal(runtime.inventory.findMaterialLot(state.save_file, split.created_objects[0]!.object_id).storage_footprint.amount, 1);
  for (const bad of [0, NaN, Infinity, '50', true]) {
    const before = cloneForCompare(state);
    (definition.storage_footprint_rule.base_quantity as { amount: unknown }).amount = bad;
    const failed = dispatch(runtime, state, 'split_lot', { source_lot_id: configured.lot_id, quantity: { amount: 1, unit: 'g' } }, 'invalid_definition_split');
    assert.equal(failed.success, false);
    assert.deepEqual(state, before);
  }
  const big = buildRuntime();
  useLegacyCapacity(big.state);
  const seed = big.runtime.inventory.findMaterialLot(big.state.save_file, 'seed_cabbage_initial_001');
  seed.quantity.amount = 2 ** 53 + 2;
  seed.storage_footprint.amount = Math.ceil(seed.quantity.amount / 10);
  big.state.save_file.storage_containers.find((container) => container.container_id === seed.storage_ref.container_id)!.capacity.amount = 2 ** 54;
  big.runtime.storageReconciler.reconcile(big.state.save_file);
  const before = cloneForCompare(big.state);
  const failed = dispatch(big.runtime, big.state, 'split_lot', { source_lot_id: seed.lot_id, quantity: { amount: 1, unit: 'count' } }, 'unrepresentable_count');
  assert.equal(failed.success, false, 'count subtraction must not remove two units for a one-unit request');
  assert.deepEqual(big.state, before);
});

test('deterministic IDs recover nested historical strings and record keys without lowering prefix high-water marks', () => {
  const ids = new DeterministicIdService();
  assert.equal(ids.next('lot_split'), 'lot_split_000001');
  const historical: Record<string, unknown> = {
    lineage_summary: { key_origins: [{ origin_id: 'lot_split_000040', source_ref: { source_id: 'custom.prefix-with_under_score_000009' } }] },
    processing_history: [{ history_id: 'hist_processing_999999' }],
    references: { record_ref_000008: null },
    ignored: ['ignored_12', 'ignored_000005x', '000999', '_000999']
  };
  historical.self = historical;
  ids.observeExisting(historical);
  assert.equal(ids.next('lot_split'), 'lot_split_000041');
  assert.equal(ids.next('custom.prefix-with_under_score'), 'custom.prefix-with_under_score_000010');
  assert.equal(ids.next('hist_processing'), 'hist_processing_1000000');
  assert.equal(ids.next('record_ref'), 'record_ref_000009');
  assert.equal(ids.next('ignored'), 'ignored_000001');
  ids.observeExisting({ older: 'lot_split_000002' });
  assert.equal(ids.next('lot_split'), 'lot_split_000042');
  assert.equal(new DeterministicIdService().next('lot_split'), 'lot_split_000001');
});

test('deterministic IDs advance decimal suffixes beyond Number precision and avoid recursive traversal limits', () => {
  const ids = new DeterministicIdService();
  const huge = '9'.repeat(80);
  let nested: unknown = { source_ref: { source_id: `extreme_prefix_${huge}` }, padded: 'padded_000000000000000000009' };
  for (let depth = 0; depth < 12000; depth += 1) nested = { nested };
  ids.observeExisting(nested);
  assert.equal(ids.next('extreme_prefix'), `extreme_prefix_1${'0'.repeat(80)}`);
  assert.equal(ids.next('extreme_prefix'), `extreme_prefix_1${'0'.repeat(79)}1`);
  assert.equal(ids.next('padded'), 'padded_000010');
});

test('a fresh GameRuntime restores every generated domain prefix through direct pipeline dispatch after save/load', () => {
  const first = buildRuntime();
  const firstPickled = preparePickledCabbage(first.runtime, first.state);
  assert.equal(cookBaconCabbage(first.runtime, first.state, firstPickled).success, true);
  assert.equal(first.state.save_file.inventory.some((lot) => lot.lot_id === 'lot_split_000001'), false, 'consumed split remains only in historical references');
  const saves = new SaveManager();
  const serialized = saves.serialize(first.state);
  const lastEvent = String(first.state.save_file.event_log_summary.last_event_id);
  const restored = saves.deserializeSaveFile(serialized);
  const second = buildRuntimeWithoutState();
  assert.deepEqual(restored.domain_events, []);
  const beforeFailure = cloneForCompare(restored);
  const failed = dispatch(second.runtime, restored, 'split_lot', { source_lot_id: 'salt_initial_001', quantity: { amount: 999999, unit: 'g' } }, 'restored_rejected_split');
  assert.equal(failed.success, false);
  assert.equal(failed.status_code, 'ERR_NOT_ENOUGH_RESOURCE');
  assert.deepEqual(restored, beforeFailure);
  const split = dispatch(second.runtime, restored, 'split_lot', { source_lot_id: 'salt_initial_001', quantity: { amount: 10, unit: 'g' } }, 'restored_split');
  assert.equal(split.success, true);
  assert.equal(split.created_objects[0]?.object_id, 'lot_split_000002', 'historical references protect the removed split ID');
  assert.equal(split.domain_events[0]?.event_id, `evt_${String(Number(lastEvent.slice(4)) + 1).padStart(6, '0')}`, 'persisted event summary restores events without the old stream');
  const secondPickled = preparePickledCabbage(second.runtime, restored);
  assert.equal(secondPickled, 'lot_processed_000002');
  const cooked = cookBaconCabbage(second.runtime, restored, secondPickled, 'restored_cook');
  assert.equal(cooked.success, true);
  assert.equal(cooked.created_objects[0]?.object_id, 'dish_000002');
  assert.deepEqual(restored.save_file.crop_instances.map((crop) => crop.crop_id), ['crop_000001', 'crop_000002']);
  assert.deepEqual(restored.save_file.processing_tasks.map((task) => task.task_id), ['task_processing_000001', 'task_processing_000002']);
  assert.deepEqual(restored.save_file.processing_tasks[1]!.reserved_quantities.map((reservation) => reservation.reservation_id), ['res_consumed_000003', 'res_consumed_000004']);
  assert.equal(restored.save_file.inventory.find((lot) => lot.lot_id === 'lot_harvest_000002')?.source_ref.source_id, 'crop_000002');
  assert.equal(restored.save_file.inventory.find((lot) => lot.lot_id === secondPickled)?.processing_history?.[0]?.history_id, 'hist_processing_000002');
  assert.deepEqual(restored.save_file.dish_lots[1]!.components.map((component) => component.component_id), ['dish_component_000004', 'dish_component_000005', 'dish_component_000006']);
  const inventoryIds = restored.save_file.inventory.map((lot) => lot.lot_id);
  assert.equal(new Set(inventoryIds).size, inventoryIds.length);
  second.contracts.assertSaveFile(restored.save_file);
  new StorageAudit(auditPolicies).assertReconciled(restored.save_file);
  assert.doesNotThrow(() => saves.serialize(restored));
});

test('NewGameBuilder output validates against save_file.schema.json', () => {
  const { contracts, state } = buildRuntime();
  assert.doesNotThrow(() => contracts.assertSaveFile(state.save_file));
  new StorageAudit(auditPolicies).assertReconciled(state.save_file);
});

test('plant_crop creates schema-valid DomainEvent and ActionResult mutation summary', () => {
  const { contracts, runtime, state } = buildRuntime();
  const request = {
    request_id: 'req_contract_plant_001',
    actor_id: 'player',
    action_type: 'plant_crop',
    created_time: state.save_file.world_time.absolute_minute,
    idempotency_key: 'idem_contract_plant_001',
    parameters: {
      field_plot_id: 'field_plot_01',
      seed_lot_id: 'seed_cabbage_initial_001',
      seed_quantity: { amount: 1, unit: 'count' }
    }
  };
  assert.doesNotThrow(() => contracts.assertActionRequest(request));
  const result = runtime.pipeline.dispatch(state, request);
  assert.equal(result.success, true);
  assert.equal(result.consumed_resources[0]?.resource_id, 'seed_cabbage_initial_001');
  assert.equal(result.created_objects[0]?.object_type, 'CropInstance');
  assert.equal(result.updated_objects.some((item) => item.object_type === 'FieldPlotState'), true);
  assert.equal(result.domain_events[0]?.event_type, 'farming.crop_planted');
  assert.equal(result.domain_events[0]?.source_action_id, request.request_id);
  assert.doesNotThrow(() => contracts.assertDomainEvent(result.domain_events[0]!));
  assert.doesNotThrow(() => contracts.assertActionResult(result));
  new StorageAudit(auditPolicies).assertReconciled(state.save_file);
});

test('independent seeds combine within one tile and reveal failure at sprout without rerolling or refunding', () => {
  for (const example of [
    { seed: 'stage1_fixed_seed', seeds: 1, outcome: 'failed' },
    { seed: 'stage1_fixed_seed', seeds: 2, outcome: 'succeeded' },
    { seed: 'farming-test-28', seeds: 3, outcome: 'failed' },
    { seed: 'farming-test-23', seeds: 3, outcome: 'succeeded' }
  ]) {
    const { runtime, state, contracts } = buildRuntime(example.seed);
    const planted = dispatch(runtime, state, 'plant_crop', { field_plot_id: 'field_plot_01', seed_lot_id: 'seed_cabbage_initial_001',
      seed_quantity: { amount: example.seeds, unit: 'count' }, seeds_per_tile: example.seeds }, 'germination_plant');
    assert.equal(planted.success, true, planted.status_code);
    assert.equal(planted.created_objects.length, 1, 'one tile retains at most one plant, regardless of seed count');
    assert.equal(state.save_file.fields[0]!.occupied_tiles, 1);
    assert.equal(state.save_file.inventory.find(lot => lot.lot_id === 'seed_cabbage_initial_001')!.quantity.amount, 10 - example.seeds);
    let crop = state.save_file.crop_instances[0]!;
    assert.equal(crop.germination!.outcome, example.outcome);
    assert.equal(crop.germination!.revealed, false);
    assert.equal(crop.germination!.per_seed_success_rate, 0.8);
    const stream = cloneForCompare(state.save_file.random_state);
    assert.equal((stream.streams as Record<string, { position: number }>).farming_germination_v1!.position, example.seeds);
    const revealMinute = Math.ceil((crop.expected_harvest_minute - crop.planted_time) * 0.2);
    assert.equal(dispatch(runtime, state, 'advance_time', { minutes: revealMinute - 1 }, 'before_reveal').success, true);
    assert.equal(state.save_file.crop_instances[0]!.germination!.revealed, false);
    assert.equal(dispatch(runtime, state, 'advance_time', { minutes: 1 }, 'at_reveal').success, true);
    crop = state.save_file.crop_instances[0]!;
    assert.equal(crop.germination!.revealed, true);
    assert.equal(crop.lifecycle_status, example.outcome === 'failed' ? 'failed' : 'active');
    assert.equal(state.save_file.fields[0]!.occupied_tiles, example.outcome === 'failed' ? 0 : 1);
    assert.equal(dispatch(runtime, state, 'advance_time', { minutes: 5400 }, 'after_reveal').success, true);
    assert.deepEqual(state.save_file.random_state, stream, 'time advancement never redraws germination');
    const beforeHarvest = cloneForCompare(state);
    const harvest = dispatch(runtime, state, 'harvest_crop', { crop_id: crop.crop_id }, 'germination_harvest');
    assert.equal(harvest.success, example.outcome === 'succeeded');
    if (example.outcome === 'failed') assert.deepEqual(state, beforeHarvest);
    else assert.deepEqual(state.save_file.inventory.find(lot => lot.lot_id === harvest.created_objects[0]!.object_id)!.quantity, { amount: 1200, unit: 'g' });
    contracts.assertSaveFile(state.save_file);
  }
});

test('multi-seed tiles preserve independent random position and reject non-divisible requests atomically', () => {
  const subject = buildRuntime('farming-test-23');
  const control = buildRuntime('farming-test-23');
  const params = (amount: number, seeds_per_tile: number) => ({ field_plot_id: 'field_plot_01', seed_lot_id: 'seed_cabbage_initial_001', seed_quantity: { amount, unit: 'count' }, seeds_per_tile });
  for (const [amount, seeds] of [[3, 2], [1, 0], [1, 4], [1, 1.5], [12, 3]]) {
    const before = cloneForCompare(subject.state);
    const rejected = dispatch(subject.runtime, subject.state, 'plant_crop', params(amount!, seeds!), 'reject_multiseed');
    assert.equal(rejected.success, false);
    assert.deepEqual(subject.state, before, 'rejection consumes neither seeds nor random draws');
  }
  const actual = dispatch(subject.runtime, subject.state, 'plant_crop', params(6, 3), 'healthy_multiseed');
  const expected = dispatch(control.runtime, control.state, 'plant_crop', params(6, 3), 'healthy_multiseed');
  assert.equal(actual.success, true, actual.status_code);
  assert.deepEqual(actual, expected);
  assert.deepEqual(subject.state, control.state);
  assert.equal(actual.created_objects.length, 2);
  assert.equal(subject.state.save_file.fields[0]!.occupied_tiles, 2);
  assert.equal((subject.state.save_file.random_state.streams as Record<string, { position: number }>).farming_germination_v1!.position, 6);
  const split = buildRuntime('farming-test-23');
  dispatch(split.runtime, split.state, 'plant_crop', params(3, 3), 'split_multiseed_a');
  dispatch(split.runtime, split.state, 'plant_crop', params(3, 3), 'split_multiseed_b');
  assert.deepEqual(split.state.save_file.random_state, subject.state.save_file.random_state);
  assert.deepEqual(split.state.save_file.crop_instances.map(crop => crop.germination), subject.state.save_file.crop_instances.map(crop => crop.germination));
});

test('legacy crops without germination preserve their growth and old saves while probability fields are closed', () => {
  const { runtime, state, contracts } = buildRuntime('farming-test-28');
  const plant = dispatch(runtime, state, 'plant_crop', { field_plot_id: 'field_plot_01', seed_lot_id: 'seed_cabbage_initial_001', seed_quantity: { amount: 1, unit: 'count' } }, 'legacy_crop');
  assert.equal(plant.success, true);
  delete state.save_file.crop_instances[0]!.germination;
  state.save_file.random_state.streams = {};
  contracts.assertSaveFile(state.save_file);
  assert.equal(dispatch(runtime, state, 'advance_time', { minutes: 5400 }, 'legacy_mature').success, true);
  assert.equal(state.save_file.crop_instances[0]!.lifecycle_status, 'ready_to_harvest');
  assert.deepEqual(state.save_file.random_state.streams, {});
  assert.equal(dispatch(runtime, state, 'harvest_crop', { crop_id: plant.created_objects[0]!.object_id }, 'legacy_harvest').success, true);
  const current = buildRuntime();
  dispatch(current.runtime, current.state, 'plant_crop', { field_plot_id: 'field_plot_01', seed_lot_id: 'seed_cabbage_initial_001', seed_quantity: { amount: 1, unit: 'count' } }, 'schema_crop');
  const malformed = cloneForCompare(current.state.save_file);
  Object.assign(malformed.crop_instances[0]!.germination!, { seeds_per_tile: 4, unexpected: true });
  assert.throws(() => contracts.assertSaveFile(malformed), /ERR_SCHEMA_VALIDATION_FAILED/);
});

test('batch planting creates one independent crop per single-seed tile and supports partially occupied fields', () => {
  const { runtime, state, contracts } = buildRuntime();
  const plant = (amount: number, suffix: string) => dispatch(runtime, state, 'plant_crop', {
    field_plot_id: 'field_plot_01', seed_lot_id: 'seed_cabbage_initial_001', seed_quantity: { amount, unit: 'count' }
  }, suffix);
  const first = plant(3, 'batch_first');
  assert.equal(first.success, true, first.status_code);
  assert.equal(first.created_objects.length, 3);
  assert.equal(first.domain_events.length, 3);
  assert.deepEqual(first.consumed_resources[0]!.quantity, { amount: 3, unit: 'count' });
  const second = plant(3, 'batch_fill');
  assert.equal(second.success, true, second.status_code);
  const ids = [...first.created_objects, ...second.created_objects].map(item => item.object_id);
  assert.equal(new Set(ids).size, 6);
  assert.deepEqual(state.save_file.fields[0]!.active_crop_ids, ids);
  assert.equal(state.save_file.fields[0]!.occupied_tiles, 6);
  assert.equal(state.save_file.inventory.find(lot => lot.lot_id === 'seed_cabbage_initial_001')!.quantity.amount, 4);
  const full = cloneForCompare(state);
  const rejected = plant(1, 'batch_full_refused');
  assert.equal(rejected.status_code, 'ERR_FIELD_CAPACITY_EXCEEDED');
  assert.deepEqual(state, full);
  assert.equal(dispatch(runtime, state, 'advance_time', { minutes: 5400 }, 'batch_grow').success, true);
  assert.equal(state.save_file.crop_instances.filter(crop => crop.lifecycle_status === 'ready_to_harvest').length, 6);
  const harvest = dispatch(runtime, state, 'harvest_crop', { crop_id: ids[0] }, 'batch_harvest_one');
  assert.equal(harvest.success, true, harvest.status_code);
  assert.equal(state.save_file.fields[0]!.occupied_tiles, 5);
  assert.deepEqual(state.save_file.fields[0]!.active_crop_ids, ids.slice(1));
  assert.deepEqual(state.save_file.inventory.find(lot => lot.lot_id === harvest.created_objects[0]!.object_id)!.quantity, { amount: 1200, unit: 'g' });
  const afterHarvest = cloneForCompare(state);
  assert.equal(dispatch(runtime, state, 'harvest_crop', { crop_id: ids[0] }, 'batch_duplicate_harvest').success, false);
  assert.deepEqual(state, afterHarvest);
  assert.equal(plant(1, 'batch_replant').success, true);
  assert.equal(state.save_file.fields[0]!.occupied_tiles, 6);
  contracts.assertSaveFile(state.save_file);
  new StorageAudit(auditPolicies).assertReconciled(state.save_file);
});

test('batch harvest preserves the crop and field when storage fills and can recover after moving a prior harvest', () => {
  const { runtime, state, contracts } = buildRuntime();
  useLegacyCapacity(state);
  const planted = dispatch(runtime, state, 'plant_crop', {
    field_plot_id: 'field_plot_01', seed_lot_id: 'seed_cabbage_initial_001', seed_quantity: { amount: 6, unit: 'count' }
  }, 'six_for_storage');
  assert.equal(planted.success, true, planted.status_code);
  assert.equal(dispatch(runtime, state, 'advance_time', { minutes: 5400 }, 'six_mature').success, true);
  const crops = planted.created_objects.map(item => item.object_id);
  const lots: string[] = [];
  for (const crop_id of crops.slice(0, 3)) {
    const harvested = dispatch(runtime, state, 'harvest_crop', { crop_id }, crop_id);
    assert.equal(harvested.success, true, harvested.status_code);
    lots.push(harvested.created_objects[0]!.object_id);
  }
  const before = cloneForCompare(state);
  const rejected = dispatch(runtime, state, 'harvest_crop', { crop_id: crops[3] }, 'fourth_full_storage');
  assert.equal(rejected.success, false);
  assert.equal(rejected.status_code, 'ERR_STORAGE_CAPACITY_OVERFLOW');
  assert.deepEqual(state, before);
  const moved = dispatch(runtime, state, 'store_item', {
    object_ref: { object_type: 'MaterialLot', object_id: lots[0] },
    storage_ref: { location_id: 'home', storage_type: 'cellar', container_id: 'home_cellar_01' }
  }, 'make_harvest_space');
  assert.equal(moved.success, true, moved.status_code);
  const recovered = dispatch(runtime, state, 'harvest_crop', { crop_id: crops[3] }, 'fourth_retry');
  assert.equal(recovered.success, true, recovered.status_code);
  assert.equal(state.save_file.fields[0]!.occupied_tiles, 2);
  assert.equal(state.save_file.crop_instances.filter(crop => crop.lifecycle_status === 'ready_to_harvest').length, 2);
  assert.equal(state.save_file.inventory.filter(lot => lot.base_id === 'cabbage').reduce((total, lot) => total + lot.quantity.amount, 0), 4800);
  contracts.assertSaveFile(state.save_file);
});

test('physical storage enforces weight and volume independently and accepts an exact fit', () => {
  const { runtime, state, contracts } = buildRuntime();
  const lotId = prepareHarvestedCabbage(runtime, state);
  const targetRef = { location_id: 'home', storage_type: 'cellar', container_id: 'home_cellar_01' };
  const target = () => state.save_file.storage_containers.find(container => container.container_id === targetRef.container_id)!;
  const request = { object_ref: { object_type: 'MaterialLot', object_id: lotId }, storage_ref: targetRef };
  target().capacity_limits = { mass_g: 1199, volume_ml: 1920 };
  let before = cloneForCompare(state);
  let result = dispatch(runtime, state, 'store_item', request, 'physical_weight_overflow');
  assert.equal(result.status_code, 'ERR_STORAGE_CAPACITY_OVERFLOW');
  assert.deepEqual(state, before);
  target().capacity_limits = { mass_g: 1200, volume_ml: 1919 };
  before = cloneForCompare(state);
  result = dispatch(runtime, state, 'store_item', request, 'physical_volume_overflow');
  assert.equal(result.status_code, 'ERR_STORAGE_CAPACITY_OVERFLOW');
  assert.deepEqual(state, before);
  target().capacity_limits = { mass_g: 1200, volume_ml: 1920 };
  result = dispatch(runtime, state, 'store_item', request, 'physical_exact_fit');
  assert.equal(result.success, true, result.status_code);
  assert.deepEqual(target().used_capacity_limits, { mass_g: 1200, volume_ml: 1920 });
  assert.equal(runtime.inventory.findMaterialLot(state.save_file, lotId).storage_ref.container_id, targetRef.container_id);
  contracts.assertSaveFile(state.save_file);
  new StorageAudit(auditPolicies).assertReconciled(state.save_file);
});

test('batch planting rejects invalid quantities, capacity and reserved seeds before consumption or ID allocation', () => {
  const cases = [
    { amount: 0, unit: 'count', code: 'ERR_PLANT_QUANTITY_INVALID' },
    { amount: -1, unit: 'count', code: 'ERR_SCHEMA_VALIDATION_FAILED' },
    { amount: 0.5, unit: 'count', code: 'ERR_PLANT_QUANTITY_INVALID' },
    { amount: Number.MAX_SAFE_INTEGER + 1, unit: 'count', code: 'ERR_PLANT_QUANTITY_INVALID' },
    { amount: 1, unit: 'g', code: 'ERR_PLANT_QUANTITY_INVALID' },
    { amount: 10, unit: 'count', code: 'ERR_FIELD_CAPACITY_EXCEEDED' },
    { amount: 11, unit: 'count', code: 'ERR_NOT_ENOUGH_RESOURCE' },
    { amount: 1, unit: 'count', code: 'ERR_ALREADY_RESERVED', reserved: true }
  ];
  for (const example of cases) {
    const { runtime, state } = buildRuntime();
    const reserved = example.reserved ? injectTestReservation(state, 'seed_cabbage_initial_001', 1, 'batch_seed') : null;
    const before = cloneForCompare(state);
    const result = dispatch(runtime, state, 'plant_crop', {
      field_plot_id: 'field_plot_01', seed_lot_id: 'seed_cabbage_initial_001', seed_quantity: { amount: example.amount, unit: example.unit }
    }, 'invalid_batch');
    assert.equal(result.success, false);
    assert.equal(result.status_code, example.code, `${example.amount} ${example.unit}`);
    assert.deepEqual(result.created_objects, []);
    assert.deepEqual(result.domain_events, []);
    assert.deepEqual(state, before);
    if (reserved) releaseTestReservation(state, reserved);
    const healthy = dispatch(runtime, state, 'plant_crop', {
      field_plot_id: 'field_plot_01', seed_lot_id: 'seed_cabbage_initial_001', seed_quantity: { amount: 2, unit: 'count' }
    }, 'healthy_after_invalid_batch');
    assert.equal(healthy.success, true, healthy.status_code);
    assert.deepEqual(healthy.created_objects.map(item => item.object_id), ['crop_000001', 'crop_000002']);
  }
});

test('plant capacity comes from the configured field definition and inconsistent occupancy is rejected', () => {
  const { runtime, state, configs } = buildRuntime();
  const fieldConfig = configs.requiredDoc<{ field_plot_definitions: Record<string, { capacity_tiles: number }> }>('configs/farming/field_plots.yaml');
  fieldConfig.field_plot_definitions.field_plot_basic!.capacity_tiles = 2;
  const params = { field_plot_id: 'field_plot_01', seed_lot_id: 'seed_cabbage_initial_001', seed_quantity: { amount: 3, unit: 'count' } };
  const before = cloneForCompare(state);
  assert.equal(dispatch(runtime, state, 'plant_crop', params, 'configured_capacity').status_code, 'ERR_FIELD_CAPACITY_EXCEEDED');
  assert.deepEqual(state, before);
  state.save_file.fields[0]!.occupied_tiles = 1;
  const inconsistent = cloneForCompare(state);
  assert.equal(dispatch(runtime, state, 'plant_crop', { ...params, seed_quantity: { amount: 1, unit: 'count' } }, 'inconsistent_field').status_code, 'ERR_FIELD_STATE_INVALID');
  assert.deepEqual(state, inconsistent);
});

test('crop growth uses configured 50 percent stage and invalid growth configuration preserves formal state', () => {
  const { runtime, state, configs } = buildRuntime();
  const profile = configs.requiredDoc<{ base_growth_duration_minutes: number; stage_sequence: Array<{ min_progress: number; growth_stage: string }> }>('configs/farming/growth_profiles/cabbage_growth_basic.yaml');
  const parameters = { field_plot_id: 'field_plot_01', seed_lot_id: 'seed_cabbage_initial_001', seed_quantity: { amount: 1, unit: 'count' } };
  const duration = profile.base_growth_duration_minutes;
  for (const invalid of [0, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    profile.base_growth_duration_minutes = invalid;
    const before = cloneForCompare(state);
    assert.equal(dispatch(runtime, state, 'plant_crop', parameters, 'invalid_growth_duration').status_code, 'ERR_CROP_GROWTH_DURATION_INVALID');
    assert.deepEqual(state, before);
  }
  profile.base_growth_duration_minutes = duration;
  const originalStages = structuredClone(profile.stage_sequence);
  profile.stage_sequence = [];
  const beforeInvalidStages = cloneForCompare(state);
  assert.equal(dispatch(runtime, state, 'plant_crop', parameters, 'invalid_growth_stages').status_code, 'ERR_CROP_GROWTH_STAGE_INVALID');
  assert.deepEqual(state, beforeInvalidStages);
  profile.stage_sequence = originalStages;
  const planted = dispatch(runtime, state, 'plant_crop', parameters, 'stages_plant');
  assert.equal(planted.success, true, planted.status_code);
  assert.equal(planted.created_objects[0]!.object_id, 'crop_000001');
  const crop = state.save_file.crop_instances[0]!;
  const untilHalf = Math.ceil((crop.expected_harvest_minute - crop.planted_time) / 2);
  assert.equal(dispatch(runtime, state, 'advance_time', { minutes: untilHalf - 1 }, 'before_half').success, true);
  assert.equal(state.save_file.crop_instances[0]!.growth_stage, 'sprout');
  assert.equal(dispatch(runtime, state, 'advance_time', { minutes: 1 }, 'at_half').success, true);
  assert.equal(state.save_file.crop_instances[0]!.growth_progress, 50);
  assert.equal(state.save_file.crop_instances[0]!.growth_stage, 'growing');
  profile.stage_sequence = [];
  const beforeAdvance = cloneForCompare(state);
  assert.equal(dispatch(runtime, state, 'advance_time', { minutes: 1 }, 'invalid_stage_advance').status_code, 'ERR_CROP_GROWTH_STAGE_INVALID');
  assert.deepEqual(state, beforeAdvance);
});

test('split_lot creates a new lot and leaves storage used_capacity reconciled', () => {
  const { contracts, runtime, state } = buildRuntime();
  const lotId = prepareHarvestedCabbage(runtime, state);
  const result = dispatch(runtime, state, 'split_lot', { source_lot_id: lotId, quantity: { amount: 300, unit: 'g' } }, 'split_lot');

  assert.equal(result.success, true);
  assert.equal(result.created_objects[0]?.object_type, 'MaterialLot');
  assert.equal(result.updated_objects.some((item) => item.object_id === lotId), true);
  assert.equal(result.domain_events.some((event) => event.event_type === 'inventory.lot_created'), true);
  assert.equal(result.domain_events.some((event) => event.event_type === 'inventory.lot_updated'), true);
  assert.doesNotThrow(() => contracts.assertActionResult(result));
  for (const event of result.domain_events) assert.doesNotThrow(() => contracts.assertDomainEvent(event));
  new StorageAudit(auditPolicies).assertReconciled(state.save_file);
});

test('start_processing consumes configured input lots, creates schema-valid ProcessingTask, and reports event summary', () => {
  const { contracts, runtime, state } = buildRuntime();
  const cabbageLotId = prepareHarvestedCabbage(runtime, state);
  const split = dispatch(runtime, state, 'split_lot', { source_lot_id: cabbageLotId, quantity: { amount: 300, unit: 'g' } }, 'proc_split');
  const splitLotId = split.created_objects[0]!.object_id;
  const result = dispatch(runtime, state, 'start_processing', {
    method_id: 'pickling_cabbage_basic',
    input_lots: [
      { lot_id: splitLotId, quantity: { amount: 300, unit: 'g' } },
      { lot_id: 'salt_initial_001', quantity: { amount: 15, unit: 'g' } }
    ],
    facility_ref: picklingFacilityRef
  }, 'proc_start');

  assert.equal(result.success, true);
  assert.equal(result.created_objects[0]?.object_type, 'ProcessingTask');
  assert.equal(result.consumed_resources.length, 2);
  assert.equal(result.domain_events[0]?.event_type, 'processing.task_started');
  const task = state.save_file.processing_tasks.find((item) => item.task_id === result.created_objects[0]?.object_id);
  assert.ok(task);
  assert.equal(task.status, 'active');
  assert.equal(task.current_stage, 'fermenting');
  assert.doesNotThrow(() => contracts.assertProcessingTask(task!));
  assert.doesNotThrow(() => contracts.assertActionResult(result));
  for (const event of result.domain_events) assert.doesNotThrow(() => contracts.assertDomainEvent(event));
  new StorageAudit(auditPolicies).assertReconciled(state.save_file);
});

test('processing independent start validation is read-only and preserves repeated input order and IDs', () => {
  const subject = buildRuntime(); const control = buildRuntime();
  const cabbage = prepareHarvestedCabbage(subject.runtime, subject.state);
  assert.equal(cabbage, prepareHarvestedCabbage(control.runtime, control.state));
  const inputs = [
    { lot_id: cabbage, quantity: { amount: 100, unit: 'g' } },
    { lot_id: 'salt_initial_001', quantity: { amount: 15, unit: 'g' } },
    { lot_id: cabbage, quantity: { amount: 200, unit: 'g' } }
  ];
  const before = cloneForCompare(subject.state);
  subject.runtime.processing.assertCanStartProcessing(subject.state.save_file, 'pickling_cabbage_basic', inputs, picklingFacilityRef);
  assert.deepEqual(subject.state, before);
  const invalid = [...inputs, { lot_id: cabbage, quantity: { amount: 999999, unit: 'g' } }];
  assert.throws(() => subject.runtime.processing.assertCanStartProcessing(subject.state.save_file, 'pickling_cabbage_basic', invalid, picklingFacilityRef), /ERR_NOT_ENOUGH_RESOURCE/);
  assert.deepEqual(subject.state, before);
  const rejected = dispatch(subject.runtime, subject.state, 'start_processing', { method_id: 'pickling_cabbage_basic', input_lots: invalid, facility_ref: picklingFacilityRef }, 'sequential_refusal');
  assert.equal(rejected.status_code, 'ERR_NOT_ENOUGH_RESOURCE');
  assert.deepEqual(subject.state, before);
  const params = { method_id: 'pickling_cabbage_basic', input_lots: inputs, facility_ref: picklingFacilityRef };
  const actual = dispatch(subject.runtime, subject.state, 'start_processing', params, 'sequential_healthy');
  const expected = dispatch(control.runtime, control.state, 'start_processing', params, 'sequential_healthy');
  assert.equal(actual.success, true);
  assert.deepEqual(actual, expected);
  assert.deepEqual(subject.state, control.state);
});

test('processing collection uses warehouse even when cellar is full', () => {
  const { runtime, state } = buildRuntime();
  useLegacyCapacity(state);
  const warehouse = state.save_file.storage_containers.find(item => item.container_id === 'home_room_temp_01')!;
  assert.equal(warehouse.supported_forms.includes('pickled'), true, 'new game warehouse accepts processed cabbage');
  const taskId = prepareProcessingTask(runtime, state);
  assert.equal(dispatch(runtime, state, 'advance_time', { minutes: 2880 }, 'collect_warehouse_ready').success, true);
  const cellar = state.save_file.storage_containers.find(item => item.container_id === 'home_cellar_01')!;
  cellar.capacity.amount = cellar.used_capacity;
  const collected = dispatch(runtime, state, 'collect_processing_result', { task_id: taskId }, 'collect_warehouse');
  assert.equal(collected.success, true, collected.status_code);
  assert.equal(runtime.inventory.findMaterialLot(state.save_file, collected.created_objects[0]!.object_id).storage_ref.container_id, 'home_room_temp_01');
});

test('processing collection independently rejects full warehouse before allocating output IDs and recovers', () => {
  const subject = buildRuntime(); const control = buildRuntime();
  useLegacyCapacity(subject.state); useLegacyCapacity(control.state);
  const taskId = prepareProcessingTask(subject.runtime, subject.state);
  assert.equal(taskId, prepareProcessingTask(control.runtime, control.state));
  assert.equal(dispatch(subject.runtime, subject.state, 'advance_time', { minutes: 2880 }, 'independent_ready').success, true);
  assert.equal(dispatch(control.runtime, control.state, 'advance_time', { minutes: 2880 }, 'independent_ready').success, true);
  const warehouse = subject.state.save_file.storage_containers.find(item => item.container_id === 'home_room_temp_01')!;
  const controlWarehouse = control.state.save_file.storage_containers.find(item => item.container_id === 'home_room_temp_01')!;
  assert.equal(warehouse.supported_forms.includes('pickled'), true, 'new game warehouse accepts processed cabbage');
  assert.equal(controlWarehouse.supported_forms.includes('pickled'), true);
  const originalCapacity = warehouse.capacity.amount;
  warehouse.capacity.amount = warehouse.used_capacity;
  const before = cloneForCompare(subject.state);
  assert.throws(() => subject.runtime.processing.assertCanCollect(subject.state.save_file, taskId), /ERR_STORAGE_CAPACITY_OVERFLOW/);
  assert.deepEqual(subject.state, before);
  const rejected = dispatch(subject.runtime, subject.state, 'collect_processing_result', { task_id: taskId }, 'independent_full');
  assert.equal(rejected.status_code, 'ERR_STORAGE_CAPACITY_OVERFLOW');
  assert.deepEqual(subject.state, before);
  subject.state.save_file.storage_containers.find(item => item.container_id === 'home_room_temp_01')!.capacity.amount = originalCapacity;
  subject.runtime.processing.assertCanCollect(subject.state.save_file, taskId);
  const actual = dispatch(subject.runtime, subject.state, 'collect_processing_result', { task_id: taskId }, 'independent_collect');
  const expected = dispatch(control.runtime, control.state, 'collect_processing_result', { task_id: taskId }, 'independent_collect');
  assert.equal(actual.success, true);
  assert.deepEqual(actual, expected);
  assert.deepEqual(subject.state, control.state);
});

test('new warehouse collection rejects each physical capacity limit atomically and can retry', () => {
  for (const dimension of ['mass_g', 'volume_ml'] as const) {
    const { runtime, state } = buildRuntime();
    const taskId = prepareProcessingTask(runtime, state);
    assert.equal(dispatch(runtime, state, 'advance_time', { minutes: 2880 }, `warehouse_${dimension}_ready`).success, true);
    const warehouse = state.save_file.storage_containers.find(container => container.container_id === 'home_room_temp_01')!;
    assert.equal(warehouse.supported_forms.includes('pickled'), true);
    const oldLimit = warehouse.capacity_limits![dimension];
    warehouse.capacity_limits![dimension] = warehouse.used_capacity_limits![dimension];
    const before = structuredClone(state), idsBefore = runtime.ids.checkpoint();
    const failed = dispatch(runtime, state, 'collect_processing_result', { task_id: taskId }, `warehouse_${dimension}_full`);
    assert.equal(failed.status_code, 'ERR_STORAGE_CAPACITY_OVERFLOW');
    assert.deepEqual(state, before);
    assert.deepEqual(runtime.ids.checkpoint(), idsBefore);
    assert.equal(state.save_file.processing_tasks.find(task => task.task_id === taskId)!.status, 'ready_to_collect');
    state.save_file.storage_containers.find(container => container.container_id === 'home_room_temp_01')!.capacity_limits![dimension] = oldLimit;
    const success = dispatch(runtime, state, 'collect_processing_result', { task_id: taskId }, `warehouse_${dimension}_retry`);
    assert.equal(success.success, true, success.status_code);
    assert.equal(runtime.inventory.findMaterialLot(state.save_file, success.created_objects[0]!.object_id).storage_ref.container_id, 'home_room_temp_01');
  }
});

test('legacy warehouse is extended only by successful collection and saved original remains unchanged', async () => {
  for (const legacySlots of [true, false]) {
    const { runtime, state, contracts } = buildRuntime();
    state.save_file.storage_containers = state.save_file.storage_containers.filter(container => !['home_cellar_jar_02', 'home_cellar_jar_03'].includes(container.container_id));
    const cellar = state.save_file.storage_containers.find(container => container.container_id === 'home_cellar_01')!;
    cellar.container_type = 'cellar_container';
    const warehouse = state.save_file.storage_containers.find(container => container.container_id === 'home_room_temp_01')!;
    warehouse.supported_forms = ['fresh', 'cut', 'dry', 'cured', 'liquid', 'cooked_dish', 'dish', 'dry_seed'];
    if (legacySlots) useLegacyCapacity(state);
    runtime.storageReconciler.reconcile(state.save_file);
    const taskId = prepareProcessingTask(runtime, state);
    assert.equal(dispatch(runtime, state, 'advance_time', { minutes: 2880 }, 'legacy_collect_ready').success, true);
    const initial = new SaveManager().serialize(state);
    const storage = new InMemorySaveStoragePort();
    await storage.write('legacy_original', initial);
    const oldCapacity = structuredClone(warehouse.capacity);
    const oldPhysical = structuredClone(warehouse.capacity_limits);
    if (legacySlots) warehouse.capacity.amount = warehouse.used_capacity;
    else {
      warehouse.capacity_limits!.mass_g = warehouse.used_capacity_limits!.mass_g;
      warehouse.capacity_limits!.volume_ml = warehouse.used_capacity_limits!.volume_ml;
    }
    const beforeFailure = structuredClone(state);
    const idsBeforeFailure = runtime.ids.checkpoint();
    assert.throws(() => runtime.processing.assertCanCollect(state.save_file, taskId), /ERR_STORAGE_CAPACITY_OVERFLOW/);
    const failed = dispatch(runtime, state, 'collect_processing_result', { task_id: taskId }, 'legacy_full');
    assert.equal(failed.status_code, 'ERR_STORAGE_CAPACITY_OVERFLOW');
    assert.deepEqual(state, beforeFailure);
    assert.deepEqual(runtime.ids.checkpoint(), idsBeforeFailure);
    assert.equal(state.save_file.processing_tasks.find(task => task.task_id === taskId)!.status, 'ready_to_collect');
    assert.equal(warehouse.supported_forms.includes('pickled'), false);
    assert.equal(await storage.read('legacy_original'), initial);
    const current = state.save_file.storage_containers.find(container => container.container_id === warehouse.container_id)!;
    current.capacity = oldCapacity;
    if (oldPhysical) current.capacity_limits = oldPhysical;
    const beforePreview = structuredClone(state);
    runtime.processing.assertCanCollect(state.save_file, taskId);
    assert.deepEqual(state, beforePreview);
    const result = dispatch(runtime, state, 'collect_processing_result', { task_id: taskId }, 'legacy_collect_success');
    assert.equal(result.success, true, result.status_code);
    assert.equal(runtime.inventory.findMaterialLot(state.save_file, result.created_objects[0]!.object_id).storage_ref.container_id, warehouse.container_id);
    assert.equal(state.save_file.storage_containers.find(container => container.container_id === warehouse.container_id)!.supported_forms.includes('pickled'), true);
    contracts.assertSaveFile(state.save_file);
    assert.equal(await storage.read('legacy_original'), initial);
  }
});

test('nonstandard legacy warehouse is not silently broadened during collection', () => {
  for (const kind of ['missing_form', 'missing_flags'] as const) {
    const { runtime, state, contracts } = buildRuntime();
    useLegacyCapacity(state);
    state.save_file.storage_containers = state.save_file.storage_containers.filter(container => !['home_cellar_jar_02', 'home_cellar_jar_03'].includes(container.container_id));
    state.save_file.storage_containers.find(container => container.container_id === 'home_cellar_01')!.container_type = 'cellar_container';
    const warehouse = state.save_file.storage_containers.find(container => container.container_id === 'home_room_temp_01')!;
    warehouse.supported_forms = ['fresh', 'cut', 'dry', 'cured', 'liquid', 'cooked_dish', 'dish', 'dry_seed'];
    const taskId = prepareProcessingTask(runtime, state);
    assert.equal(dispatch(runtime, state, 'advance_time', { minutes: 2880 }, `nonstandard_${kind}_ready`).success, true);
    if (kind === 'missing_form') warehouse.supported_forms = warehouse.supported_forms.filter(form => form !== 'cooked_dish');
    else delete (warehouse as { flags?: string[] }).flags;
    contracts.assertSaveFile(state.save_file);
    const before = structuredClone(state), idsBefore = runtime.ids.checkpoint();
    const result = dispatch(runtime, state, 'collect_processing_result', { task_id: taskId }, `nonstandard_${kind}_collect`);
    assert.equal(result.status_code, 'ERR_STORAGE_FORM_NOT_SUPPORTED', kind);
    assert.deepEqual(state, before);
    assert.deepEqual(runtime.ids.checkpoint(), idsBefore);
  }
});

test('processing required inputs reject missing material and subminimum salt before state or object IDs change', async (t) => {
  for (const missing of ['salt', 'cabbage', 'salt_below_minimum'] as const) {
    await t.test(missing, () => {
      const subject = buildRuntime();
      const control = buildRuntime();
      const cabbage = prepareHarvestedCabbage(subject.runtime, subject.state);
      const controlCabbage = prepareHarvestedCabbage(control.runtime, control.state);
      assert.equal(cabbage, controlCabbage);
      const method = subject.configs.requiredDoc<{ input_view_requirements: Array<{ base_id?: string; min_quantity_g?: number }> }>('configs/processing/methods/pickling_cabbage_basic.yaml');
      const minimumSalt = method.input_view_requirements.find((item) => item.base_id === 'salt')!.min_quantity_g!;
      const inputs = [
        { lot_id: cabbage, quantity: { amount: 300, unit: 'g' } },
        { lot_id: 'salt_initial_001', quantity: { amount: missing === 'salt_below_minimum' ? minimumSalt - 0.001 : minimumSalt, unit: 'g' } }
      ].filter((input) => missing === 'salt' ? input.lot_id !== 'salt_initial_001' : missing === 'cabbage' ? input.lot_id === 'salt_initial_001' : true);
      const before = cloneForCompare(subject.state);
      assert.throws(() => subject.runtime.processing.assertCanStartProcessing(subject.state.save_file, 'pickling_cabbage_basic', inputs, picklingFacilityRef), /ERR_PROCESSING_INPUT_MISSING/);
      assert.deepEqual(subject.state, before);
      const failed = dispatch(subject.runtime, subject.state, 'start_processing', {
        method_id: 'pickling_cabbage_basic', input_lots: inputs, facility_ref: picklingFacilityRef
      }, `required_${missing}`);
      assert.equal(failed.success, false);
      assert.equal(failed.status_code, 'ERR_PROCESSING_INPUT_MISSING');
      for (const effects of [failed.created_objects, failed.updated_objects, failed.consumed_resources, failed.released_reservations, failed.domain_events, failed.event_log_entries]) assert.deepEqual(effects, []);
      subject.contracts.assertActionResult(failed);
      assert.deepEqual(subject.state, before, 'complete SaveFile, storage caches, tasks and domain event stream stay intact');
      new StorageAudit(auditPolicies).assertReconciled(subject.state.save_file);

      const healthy = { method_id: 'pickling_cabbage_basic', input_lots: [
        { lot_id: cabbage, quantity: { amount: 300, unit: 'g' } },
        { lot_id: 'salt_initial_001', quantity: { amount: minimumSalt, unit: 'g' } }
      ], facility_ref: picklingFacilityRef };
      const recovered = dispatch(subject.runtime, subject.state, 'start_processing', healthy, 'required_recovered');
      const untouched = dispatch(control.runtime, control.state, 'start_processing', healthy, 'required_recovered');
      assert.equal(recovered.success, true);
      assert.equal(recovered.created_objects[0]?.object_id, 'task_processing_000001');
      assert.deepEqual(recovered, untouched, 'task and domain event IDs match a runtime with no failed request');
      assert.deepEqual(subject.state, control.state, 'consumed reservation IDs and all state match the healthy control');
    });
  }
});

test('processing required inputs accept the configured salt boundary and different legal quantities through collection', () => {
  for (const [cabbageAmount, saltAboveMinimum] of [[100, 0], [300, 0.001], [500, 7]]) {
    const { configs, contracts, runtime, state } = buildRuntime();
    const cabbage = prepareHarvestedCabbage(runtime, state);
    const method = configs.requiredDoc<{ input_view_requirements: Array<{ base_id?: string; min_quantity_g?: number }>; process_duration_minutes: number; output_form_rules: { success_form: string } }>('configs/processing/methods/pickling_cabbage_basic.yaml');
    const saltAmount = method.input_view_requirements.find((item) => item.base_id === 'salt')!.min_quantity_g! + saltAboveMinimum!;
    const beforeCabbage = state.save_file.inventory.find((lot) => lot.lot_id === cabbage)!.quantity.amount;
    const beforeSalt = state.save_file.inventory.find((lot) => lot.lot_id === 'salt_initial_001')!.quantity.amount;
    const started = dispatch(runtime, state, 'start_processing', { method_id: 'pickling_cabbage_basic', input_lots: [
      { lot_id: cabbage, quantity: { amount: cabbageAmount, unit: 'g' } },
      { lot_id: 'salt_initial_001', quantity: { amount: saltAmount, unit: 'g' } }
    ], facility_ref: picklingFacilityRef }, 'required_boundary_start');
    assert.equal(started.success, true, started.status_code);
    assert.equal(state.save_file.inventory.find((lot) => lot.lot_id === cabbage)?.quantity.amount, beforeCabbage - cabbageAmount!);
    assert.equal(state.save_file.inventory.find((lot) => lot.lot_id === 'salt_initial_001')?.quantity.amount, beforeSalt - saltAmount);
    const taskId = started.created_objects[0]!.object_id;
    assert.equal(dispatch(runtime, state, 'advance_time', { minutes: method.process_duration_minutes }, 'required_boundary_time').success, true);
    const collected = dispatch(runtime, state, 'collect_processing_result', { task_id: taskId }, 'required_boundary_collect');
    assert.equal(collected.success, true);
    const output = state.save_file.inventory.find((lot) => lot.lot_id === collected.created_objects[0]!.object_id)!;
    assert.equal(output.base_id, 'cabbage');
    assert.equal(output.current_form, method.output_form_rules.success_form);
    assert.deepEqual(output.quantity, { amount: cabbageAmount, unit: 'g' });
    assert.equal(state.save_file.processing_tasks.find((task) => task.task_id === taskId)?.status, 'completed');
    contracts.assertSaveFile(state.save_file);
    new StorageAudit(auditPolicies).assertReconciled(state.save_file);
  }
});

test('processing task state machine closes active -> ready_to_collect -> completed and collect creates schema-valid MaterialLot', () => {
  const { contracts, runtime, state } = buildRuntime();
  const taskId = prepareProcessingTask(runtime, state);
  const task = state.save_file.processing_tasks.find((item) => item.task_id === taskId)!;
  assert.equal(task.status, 'active');

  const readyResult = dispatch(runtime, state, 'advance_time', { minutes: 2880 }, 'proc_ready');
  assert.equal(readyResult.success, true);
  assert.equal(task.status, 'ready_to_collect');
  assert.equal(task.current_stage, 'ready');
  assert.doesNotThrow(() => contracts.assertProcessingTask(task));

  const collect = dispatch(runtime, state, 'collect_processing_result', { task_id: taskId }, 'proc_collect');
  assert.equal(collect.success, true);
  assert.equal(task.status, 'completed');
  assert.equal(collect.created_objects[0]?.object_type, 'MaterialLot');
  assert.equal(collect.updated_objects.some((item) => item.object_type === 'ProcessingTask' && item.object_id === taskId), true);
  assert.equal(collect.domain_events[0]?.event_type, 'processing.task_completed');
  const outputLot = state.save_file.inventory.find((item) => item.lot_id === collect.created_objects[0]!.object_id)!;
  assert.equal(outputLot.base_id, 'cabbage');
  assert.equal(outputLot.current_form, 'pickled');
  assert.equal(outputLot.source_ref.source_id, taskId);
  assert.doesNotThrow(() => contracts.assertProcessingTask(task));
  assert.doesNotThrow(() => contracts.assertMaterialLot(outputLot));
  assert.doesNotThrow(() => contracts.assertActionResult(collect));
  for (const event of collect.domain_events) assert.doesNotThrow(() => contracts.assertDomainEvent(event));
  new StorageAudit(auditPolicies).assertReconciled(state.save_file);
});

test('failed basic actions roll back SaveFile, DomainEvent stream, and storage reconciliation cache', () => {
  const { runtime, state } = buildRuntime();
  const audit = new StorageAudit(auditPolicies);

  const beforePlant = cloneForCompare(state);
  const invalidPlant = dispatch(runtime, state, 'plant_crop', { field_plot_id: 'field_plot_01', seed_lot_id: 'missing_seed_lot', seed_quantity: { amount: 1, unit: 'count' } }, 'bad_plant');
  assert.equal(invalidPlant.success, false);
  assert.deepEqual(state, beforePlant);
  audit.assertReconciled(state.save_file);

  const cabbageLotId = prepareHarvestedCabbage(runtime, state);

  const beforeSplit = cloneForCompare(state);
  const invalidSplit = dispatch(runtime, state, 'split_lot', { source_lot_id: cabbageLotId, quantity: { amount: 999999, unit: 'g' } }, 'bad_split');
  assert.equal(invalidSplit.success, false);
  assert.deepEqual(state, beforeSplit);
  audit.assertReconciled(state.save_file);

  const beforeStore = cloneForCompare(state);
  const invalidStore = dispatch(runtime, state, 'store_item', { object_ref: { object_type: 'MaterialLot', object_id: cabbageLotId }, storage_ref: { location_id: 'home', storage_type: 'missing', container_id: 'missing_container' } }, 'bad_store');
  assert.equal(invalidStore.success, false);
  assert.deepEqual(state, beforeStore);
  audit.assertReconciled(state.save_file);
});

test('processing failures roll back task creation, input consumption, output creation, and DomainEvent stream', () => {
  const { runtime, state } = buildRuntime();
  const audit = new StorageAudit(auditPolicies);

  const missingTaskBefore = cloneForCompare(state);
  const missingTask = dispatch(runtime, state, 'collect_processing_result', { task_id: 'missing_task' }, 'bad_collect_missing');
  assert.equal(missingTask.success, false);
  assert.equal(missingTask.status_code, 'ERR_PROCESSING_TASK_NOT_FOUND');
  assert.deepEqual(state, missingTaskBefore);
  audit.assertReconciled(state.save_file);

  const taskId = prepareProcessingTask(runtime, state);
  const beforeNotReady = cloneForCompare(state);
  assert.throws(() => runtime.processing.assertCanCollect(state.save_file, taskId), /ERR_PROCESSING_TASK_NOT_READY/);
  assert.deepEqual(state, beforeNotReady);
  const notReady = dispatch(runtime, state, 'collect_processing_result', { task_id: taskId }, 'bad_collect_not_ready');
  assert.equal(notReady.success, false);
  assert.equal(notReady.status_code, 'ERR_PROCESSING_TASK_NOT_READY');
  assert.deepEqual(state, beforeNotReady);
  audit.assertReconciled(state.save_file);

  dispatch(runtime, state, 'advance_time', { minutes: 2880 }, 'collect_ready_for_repeat');
  const collect = dispatch(runtime, state, 'collect_processing_result', { task_id: taskId }, 'collect_once');
  assert.equal(collect.success, true);
  const beforeRepeat = cloneForCompare(state);
  assert.throws(() => runtime.processing.assertCanCollect(state.save_file, taskId), /ERR_PROCESSING_TASK_ALREADY_COMPLETED/);
  assert.deepEqual(state, beforeRepeat);
  const repeat = dispatch(runtime, state, 'collect_processing_result', { task_id: taskId }, 'bad_collect_repeat');
  assert.equal(repeat.success, false);
  assert.equal(repeat.status_code, 'ERR_PROCESSING_TASK_ALREADY_COMPLETED');
  assert.deepEqual(state, beforeRepeat);
  audit.assertReconciled(state.save_file);

  const fresh = buildRuntime();
  const freshState = fresh.state;
  const freshRuntime = fresh.runtime;
  const lotId = prepareHarvestedCabbage(freshRuntime, freshState);
  const beforeInputShortage = cloneForCompare(freshState);
  const inputShortage = dispatch(freshRuntime, freshState, 'start_processing', {
    method_id: 'pickling_cabbage_basic',
    input_lots: [
      { lot_id: lotId, quantity: { amount: 999999, unit: 'g' } },
      { lot_id: 'salt_initial_001', quantity: { amount: 15, unit: 'g' } }
    ],
    facility_ref: picklingFacilityRef
  }, 'bad_start_input_shortage');
  assert.equal(inputShortage.success, false);
  assert.deepEqual(freshState, beforeInputShortage);
  audit.assertReconciled(freshState.save_file);
});

test('storage audit rejects ghost references left by invalid external state', () => {
  const { state } = buildRuntime();
  state.save_file.storage_containers[0]!.active_object_refs.push({ object_type: 'MaterialLot', object_id: 'ghost_lot' });
  const report = new StorageAudit(auditPolicies).audit(state.save_file);
  assert.equal(report.ok, false);
  assert.equal(report.issues.some((issue) => issue.code === 'ERR_STORAGE_GHOST_REF'), true);
});


test('cook_dish consumes configured lots, creates schema-valid DishLot, and keeps storage reconciled', () => {
  const { contracts, runtime, state } = buildRuntime();
  const pickledLotId = preparePickledCabbage(runtime, state);
  const result = cookBaconCabbage(runtime, state, pickledLotId, 'cook_success_contract');

  assert.equal(result.success, true);
  assert.equal(result.created_objects[0]?.object_type, 'DishLot');
  assert.equal(result.consumed_resources.some((item) => item.resource_id === pickledLotId), true);
  assert.equal(result.consumed_resources.some((item) => item.resource_id === 'bacon_initial_001'), true);
  assert.equal(result.consumed_resources.some((item) => item.resource_id === 'oil_initial_001'), true);
  assert.equal(result.updated_objects.some((item) => item.object_type === 'StorageContainer'), true);
  assert.equal(result.domain_events[0]?.event_type, 'cooking.dish_created');
  assert.equal(state.save_file.inventory.find((item) => item.lot_id === pickledLotId)?.quantity.amount, 50);

  const dish = state.save_file.dish_lots.find((item) => item.dish_lot_id === result.created_objects[0]?.object_id);
  assert.ok(dish);
  assert.equal(dish?.recognized_dish_id, 'bacon_cabbage');
  assert.equal(dish?.serving_count, 2);
  assert.equal(dish?.components.some((item) => item.source_lot_id === pickledLotId && item.role === 'main'), true);
  assert.equal(dish?.suitability_tags.includes('home_style'), true);
  assert.equal(typeof dish?.dish_profile.saltiness, 'number');
  assert.equal(typeof dish?.dish_profile.oiliness, 'number');
  assert.equal(typeof dish?.dish_profile.wateriness, 'number');
  assert.equal(typeof dish?.dish_profile.safety_risk, 'number');
  contracts.assertDishLot(dish!);
  contracts.assertActionResult(result);
  for (const event of result.domain_events) contracts.assertDomainEvent(event);
  new StorageAudit(auditPolicies).assertReconciled(state.save_file);
});

function prepareOrderState(status: string, deadlineOffset: number) {
  const prepared = buildRuntime();
  const { runtime, state, contracts } = prepared;
  const pickledLotId = preparePickledCabbage(runtime, state);
  const cook = cookBaconCabbage(runtime, state, pickledLotId, 'order_state_cook');
  assert.equal(cook.success, true);
  const dishId = cook.created_objects[0]!.object_id;
  const order = state.save_file.orders.find((item) => item.order_id === 'tavern_home_dish_001')!;
  order.status = status;
  order.deadline_absolute_minute = state.save_file.world_time.absolute_minute + deadlineOffset;
  contracts.assertSaveFile(state.save_file);
  new StorageAudit(auditPolicies).assertReconciled(state.save_file);
  const parameters = { order_id: order.order_id, submitted_object_refs: [{ object_type: 'DishLot', object_id: dishId }] };
  return { ...prepared, dishId, order, parameters };
}

function assertOrderRefusalUnchanged(prepared: ReturnType<typeof prepareOrderState>, parameters: unknown, code: string, suffix: string) {
  const before = cloneForCompare(prepared.state);
  const serializedBefore = new SaveManager().serialize(prepared.state);
  const refused = dispatch(prepared.runtime, prepared.state, 'submit_order', parameters, suffix);
  assert.equal(refused.success, false);
  assert.equal(refused.status_code, code);
  assert.deepEqual(refused.domain_events, []);
  assert.deepEqual(refused.event_log_entries, []);
  assert.deepEqual(refused.consumed_resources, []);
  assert.deepEqual(refused.created_objects, []);
  assert.deepEqual(refused.updated_objects, []);
  assert.deepEqual(prepared.state, before);
  assert.equal(new SaveManager().serialize(prepared.state), serializedBefore);
  prepared.contracts.assertSaveFile(prepared.state.save_file);
  new StorageAudit(auditPolicies).assertReconciled(prepared.state.save_file);
  return refused;
}

for (const status of ['available', 'accepted']) {
  for (const deadlineOffset of [1, 0]) {
    test(`order state: ${status} settles before or exactly at deadline offset ${deadlineOffset} only once`, () => {
      const prepared = prepareOrderState(status, deadlineOffset);
      const { runtime, state, contracts, dishId, parameters, order } = prepared;
      const before = cloneForCompare(state);
      const submittedDish = before.save_file.dish_lots.find((dish) => dish.dish_lot_id === dishId)!;
      const storedBefore = before.save_file.storage_containers.find((container) => container.container_id === submittedDish.storage_ref.container_id)!;
      const result = dispatch(runtime, state, 'submit_order', parameters, `order_state_${status}_${deadlineOffset}`);
      assert.equal(result.success, true);
      assert.equal(result.status_code, 'OK_DEMAND_ACCEPTED');
      assert.equal(order.status, 'completed');
      assert.deepEqual(order.submitted_object_refs, parameters.submitted_object_refs);
      assert.equal(order.result_summary?.reward_final, 37, 'the existing real-dish baseline reward is preserved');
      assert.equal(order.result_summary?.submitted_count, submittedDish.serving_count);
      assert.equal(state.save_file.player_state.money, Number(before.save_file.player_state.money) + 37);
      assert.equal(state.save_file.player_state.reputation_map.west_market_tavern, before.save_file.player_state.reputation_map.west_market_tavern + 1);
      assert.deepEqual(result.domain_events.map((event) => event.event_type), ['order.submitted', 'order.completed']);
      assert.equal(state.domain_events.length, before.domain_events.length + 2);
      for (const event of result.domain_events) {
        assert.deepEqual(event.payload.submitted_object_refs, parameters.submitted_object_refs);
        assert.equal(event.payload.order_id, order.order_id);
        contracts.assertDomainEvent(event);
      }
      assert.equal(result.consumed_resources.length, 1);
      assert.equal(result.consumed_resources[0]!.resource_id, dishId);
      assert.deepEqual(state.save_file.dish_lots, before.save_file.dish_lots.filter((dish) => dish.dish_lot_id !== dishId));
      assert.deepEqual(state.save_file.inventory, before.save_file.inventory);
      assert.deepEqual(state.save_file.fuel_state, before.save_file.fuel_state);
      assert.equal(state.save_file.storage_containers.some((container) => container.active_object_refs.some((ref) => ref.object_type === 'DishLot' && ref.object_id === dishId)), false);
      assert.equal(state.save_file.storage_containers.find((container) => container.container_id === storedBefore.container_id)!.used_capacity, storedBefore.used_capacity - submittedDish.storage_footprint.amount);
      contracts.assertSaveFile(state.save_file);
      new StorageAudit(auditPolicies).assertReconciled(state.save_file);
      assertOrderRefusalUnchanged(prepared, parameters, 'ERR_ORDER_NOT_AVAILABLE', 'order_state_repeat');
    });
  }

  test(`order state: directly submitting a past-deadline ${status} order preserves the full state`, () => {
    const prepared = prepareOrderState(status, -1);
    const refused = assertOrderRefusalUnchanged(prepared, prepared.parameters, 'ERR_ORDER_NOT_AVAILABLE', 'order_state_deadline_refused');
    assert.equal(refused.message_params.some((param) => param.key === 'raw_error' && param.value === 'ERR_ORDER_NOT_AVAILABLE:deadline'), true);
    assert.equal(prepared.state.save_file.orders[0]!.status, status, 'refusal does not secretly expire a loaded open order');
  });

  test(`order state: advancing time expires ${status} only after the deadline and leaves terminal states closed`, () => {
    const prepared = prepareOrderState(status, 1);
    const { runtime, state, contracts, order, parameters } = prepared;
    const closed = ['submitted', 'completed', 'failed', 'expired', 'cancelled'].map((closedStatus) => ({
      ...cloneForCompare(order), order_id: `order_state_${closedStatus}`, status: closedStatus,
      deadline_absolute_minute: state.save_file.world_time.absolute_minute
    }));
    state.save_file.orders.push(...closed);
    contracts.assertSaveFile(state.save_file);
    const before = cloneForCompare(state);
    assert.equal(dispatch(runtime, state, 'advance_time', { minutes: 1 }, 'order_state_at_deadline').success, true);
    assert.equal(order.status, status);
    assert.deepEqual(state.save_file.orders.slice(1), before.save_file.orders.slice(1));
    assert.equal(dispatch(runtime, state, 'advance_time', { minutes: 1 }, 'order_state_after_deadline').success, true);
    assert.equal(order.status, 'expired');
    assert.deepEqual(state.save_file.orders.slice(1), before.save_file.orders.slice(1));
    assert.deepEqual(state.save_file.dish_lots, before.save_file.dish_lots);
    assert.deepEqual(state.save_file.player_state, before.save_file.player_state);
    assert.deepEqual(order.submitted_object_refs, before.save_file.orders[0]!.submitted_object_refs);
    assert.equal(state.domain_events.length, before.domain_events.length + 2);
    assert.deepEqual(state.domain_events.slice(before.domain_events.length).map((event) => event.event_type), ['time.advanced', 'time.advanced']);
    contracts.assertSaveFile(state.save_file);
    assertOrderRefusalUnchanged(prepared, parameters, 'ERR_ORDER_NOT_AVAILABLE', 'order_state_expired_refused');
  });

  test(`order state: ${status} rejects missing or unsupported choices without consuming the healthy dish`, () => {
    const prepared = prepareOrderState(status, 1);
    const { runtime, state, parameters } = prepared;
    assertOrderRefusalUnchanged(prepared, { ...parameters, order_id: 'order_state_missing' }, 'ERR_ORDER_NOT_FOUND', 'order_state_missing_order');
    assertOrderRefusalUnchanged(prepared, { ...parameters, submitted_object_refs: [{ object_type: 'DishLot', object_id: 'order_state_missing_dish' }] }, 'ERR_DISH_LOT_NOT_FOUND', 'order_state_missing_dish');
    assertOrderRefusalUnchanged(prepared, { ...parameters, submitted_object_refs: [{ object_type: 'MaterialLot', object_id: 'salt_initial_001' }] }, 'ERR_SUBMITTED_OBJECT_TYPE_UNSUPPORTED', 'order_state_unsupported');
    assert.equal(dispatch(runtime, state, 'submit_order', parameters, 'order_state_healthy_after_refusal').success, true);
    assert.equal(state.save_file.orders[0]!.status, 'completed');
    assert.equal(state.save_file.player_state.money, 137);
  });

  test(`order state: ${status} demand refusals preserve dish, reward, audit and events`, () => {
    for (const failure of ['safety', 'defect', 'score']) {
      const prepared = prepareOrderState(status, 1);
      const dish = prepared.state.save_file.dish_lots.find((item) => item.dish_lot_id === prepared.dishId)!;
      if (failure === 'safety') dish.dish_profile.safety_risk = 26;
      if (failure === 'defect') dish.defects.push('unsafe');
      if (failure === 'score') {
        dish.dish_profile.saltiness = 0;
        dish.dish_profile.oiliness = 0;
        dish.suitability_tags = [];
      }
      prepared.contracts.assertSaveFile(prepared.state.save_file);
      assertOrderRefusalUnchanged(prepared, prepared.parameters, failure === 'safety' ? 'ERR_DEMAND_REJECTED_SAFETY' : failure === 'defect' ? 'ERR_DEMAND_REJECTED_DEFECT' : 'ERR_DEMAND_SCORE_TOO_LOW', `order_state_${failure}`);
    }
  });

  test(`order state: ${status} settlement failure rolls back a consumed dish and reward and can retry`, () => {
    const prepared = prepareOrderState(status, 1);
    const { runtime, state, parameters } = prepared;
    const handler = runtime.registry.get('submit_order');
    const execute = handler.execute.bind(handler);
    handler.execute = (currentState, request) => {
      execute(currentState, request);
      throw new Error('ERR_ORDER_TEST_SETTLEMENT_REFUSED');
    };
    assertOrderRefusalUnchanged(prepared, parameters, 'ERR_ORDER_TEST_SETTLEMENT_REFUSED', 'order_state_late_failure');
    handler.execute = execute;
    const recovered = dispatch(runtime, state, 'submit_order', parameters, 'order_state_late_recovery');
    assert.equal(recovered.success, true);
    assert.equal(state.save_file.player_state.money, 137);
    assert.equal(state.save_file.player_state.reputation_map.west_market_tavern, 1);
    assert.deepEqual(recovered.domain_events.map((event) => event.event_type), ['order.submitted', 'order.completed']);
    assertOrderRefusalUnchanged(prepared, parameters, 'ERR_ORDER_NOT_AVAILABLE', 'order_state_late_repeated');
  });
}

test('order state: every non-open schema-valid state refuses submission with the complete state preserved', () => {
  for (const status of ['submitted', 'completed', 'failed', 'expired', 'cancelled']) {
    const prepared = prepareOrderState(status, 1);
    assertOrderRefusalUnchanged(prepared, prepared.parameters, 'ERR_ORDER_NOT_AVAILABLE', `order_state_closed_${status}`);
  }
});

test('submit_order resolves demand profile, completes order, rewards player, and removes submitted DishLot from storage', () => {
  const { contracts, runtime, state } = buildRuntime();
  const pickledLotId = preparePickledCabbage(runtime, state);
  const cook = cookBaconCabbage(runtime, state, pickledLotId, 'order_prepare_cook');
  const dishId = cook.created_objects[0]!.object_id;
  const beforeMoney = Number(state.save_file.player_state.money);
  const beforeRep = Number((state.save_file.player_state.reputation_map as Record<string, number>).west_market_tavern);
  const result = dispatch(runtime, state, 'submit_order', {
    order_id: 'tavern_home_dish_001',
    submitted_object_refs: [{ object_type: 'DishLot', object_id: dishId }]
  }, 'submit_success_contract');

  assert.equal(result.success, true);
  assert.equal(result.status_code, 'OK_DEMAND_ACCEPTED');
  assert.equal(result.domain_events.map((event) => event.event_type).includes('order.submitted'), true);
  assert.equal(result.domain_events.map((event) => event.event_type).includes('order.completed'), true);
  assert.equal(result.updated_objects.some((item) => item.object_type === 'Order'), true);
  assert.equal(result.updated_objects.some((item) => item.object_type === 'PlayerState'), true);
  assert.equal(result.consumed_resources[0]?.resource_type, 'DishLot');
  assert.equal(result.consumed_resources[0]?.resource_id, dishId);

  const order = state.save_file.orders.find((item) => item.order_id === 'tavern_home_dish_001');
  assert.equal(order?.status, 'completed');
  assert.equal(order?.submitted_object_refs[0]?.object_id, dishId);
  assert.equal(order?.result_summary?.result_key, 'OK_DEMAND_ACCEPTED');
  assert.equal(Number(order?.result_summary?.match_score) >= 60, true);
  assert.equal(Number(order?.result_summary?.reward_final) > 0, true);
  assert.equal(Number(state.save_file.player_state.money) > beforeMoney, true);
  assert.equal(Number((state.save_file.player_state.reputation_map as Record<string, number>).west_market_tavern), beforeRep + 1);
  assert.equal(state.save_file.dish_lots.some((item) => item.dish_lot_id === dishId), false);
  assert.equal(state.save_file.storage_containers.some((container) => container.active_object_refs.some((ref) => ref.object_type === 'DishLot' && ref.object_id === dishId)), false);

  contracts.assertOrder(order!);
  contracts.assertSaveFile(state.save_file);
  contracts.assertActionResult(result);
  for (const event of result.domain_events) contracts.assertDomainEvent(event);
  new StorageAudit(auditPolicies).assertReconciled(state.save_file);
});

test('cooking and submit_order failures roll back SaveFile, DomainEvent stream, and StorageAudit state', () => {
  const audit = new StorageAudit(auditPolicies);

  {
    const { runtime, state } = buildRuntime();
    const pickledLotId = preparePickledCabbage(runtime, state);
    const before = cloneForCompare(state);
    const failed = dispatch(runtime, state, 'cook_dish', {
      recipe_variant_id: 'bacon_cabbage_basic',
      ingredients: {
        main: { lot_id: pickledLotId, quantity: { amount: 999999, unit: 'g' } },
        side: { lot_id: 'bacon_initial_001', quantity: { amount: 50, unit: 'g' } },
        oil: { lot_id: 'oil_initial_001', quantity: { amount: 10, unit: 'ml' } }
      },
      technique: 'stir_fry',
      operation_profile: { heat_level: 'high', active_minutes: 8 }
    }, 'bad_cook_shortage');
    assert.equal(failed.success, false);
    assert.equal(failed.status_code, 'ERR_NOT_ENOUGH_RESOURCE');
    assert.deepEqual(state, before);
    audit.assertReconciled(state.save_file);
  }

  {
    const { runtime, state } = buildRuntime();
    const before = cloneForCompare(state);
    const failed = dispatch(runtime, state, 'cook_dish', {
      recipe_variant_id: 'bacon_cabbage_basic',
      ingredients: {
        main: { lot_id: 'salt_initial_001', quantity: { amount: 250, unit: 'g' } },
        side: { lot_id: 'bacon_initial_001', quantity: { amount: 50, unit: 'g' } },
        oil: { lot_id: 'oil_initial_001', quantity: { amount: 10, unit: 'ml' } }
      },
      technique: 'stir_fry',
      operation_profile: { heat_level: 'high', active_minutes: 8 }
    }, 'bad_cook_illegal_form');
    assert.equal(failed.success, false);
    assert.equal(failed.status_code, 'ERR_INVALID_LOT_STATE');
    assert.deepEqual(state, before);
    audit.assertReconciled(state.save_file);
  }

  {
    const { runtime, state } = buildRuntime();
    const pickledLotId = preparePickledCabbage(runtime, state);
    const before = cloneForCompare(state);
    const failed = dispatch(runtime, state, 'cook_dish', {
      recipe_variant_id: 'bacon_cabbage_basic',
      ingredients: {
        main: { lot_id: pickledLotId, quantity: { amount: 250, unit: 'g' } },
        side: { lot_id: 'bacon_initial_001', quantity: { amount: 50, unit: 'g' } },
        oil: { lot_id: 'oil_initial_001', quantity: { amount: 10, unit: 'ml' } }
      },
      technique: 'boil',
      operation_profile: { heat_level: 'high', active_minutes: 8 }
    }, 'bad_cook_technique');
    assert.equal(failed.success, false);
    assert.equal(failed.status_code, 'ERR_COOKING_TECHNIQUE_MISMATCH');
    assert.deepEqual(state, before);
    audit.assertReconciled(state.save_file);
  }

  {
    const { runtime, state } = buildRuntime();
    const before = cloneForCompare(state);
    const failed = dispatch(runtime, state, 'submit_order', {
      order_id: 'missing_order',
      submitted_object_refs: [{ object_type: 'DishLot', object_id: 'missing_dish' }]
    }, 'bad_order_missing');
    assert.equal(failed.success, false);
    assert.equal(failed.status_code, 'ERR_ORDER_NOT_FOUND');
    assert.deepEqual(state, before);
    audit.assertReconciled(state.save_file);
  }

  {
    const { runtime, state } = buildRuntime();
    const before = cloneForCompare(state);
    const failed = dispatch(runtime, state, 'submit_order', {
      order_id: 'tavern_home_dish_001',
      submitted_object_refs: [{ object_type: 'DishLot', object_id: 'missing_dish' }]
    }, 'bad_order_object_missing');
    assert.equal(failed.success, false);
    assert.equal(failed.status_code, 'ERR_DISH_LOT_NOT_FOUND');
    assert.deepEqual(state, before);
    audit.assertReconciled(state.save_file);
  }

  {
    const { runtime, state } = buildRuntime();
    const before = cloneForCompare(state);
    const failed = dispatch(runtime, state, 'submit_order', {
      order_id: 'tavern_home_dish_001',
      submitted_object_refs: [{ object_type: 'MaterialLot', object_id: 'salt_initial_001' }]
    }, 'bad_order_object_type');
    assert.equal(failed.success, false);
    assert.equal(failed.status_code, 'ERR_SUBMITTED_OBJECT_TYPE_UNSUPPORTED');
    assert.deepEqual(state, before);
    audit.assertReconciled(state.save_file);
  }

  {
    const { runtime, state } = buildRuntime();
    const pickledLotId = preparePickledCabbage(runtime, state);
    const cook = cookBaconCabbage(runtime, state, pickledLotId, 'repeat_submit_prepare');
    const dishId = cook.created_objects[0]!.object_id;
    const first = dispatch(runtime, state, 'submit_order', {
      order_id: 'tavern_home_dish_001',
      submitted_object_refs: [{ object_type: 'DishLot', object_id: dishId }]
    }, 'repeat_submit_first');
    assert.equal(first.success, true);
    const before = cloneForCompare(state);
    const failed = dispatch(runtime, state, 'submit_order', {
      order_id: 'tavern_home_dish_001',
      submitted_object_refs: [{ object_type: 'DishLot', object_id: dishId }]
    }, 'repeat_submit_second');
    assert.equal(failed.success, false);
    assert.equal(failed.status_code, 'ERR_ORDER_NOT_AVAILABLE');
    assert.deepEqual(state, before);
    audit.assertReconciled(state.save_file);
  }
});

function injectTestReservation(state: GameState, lotId: string, amount: number, suffix: string): string {
  const lot = state.save_file.inventory.find((item) => item.lot_id === lotId);
  assert.ok(lot);
  const reservationId = `res_test_${suffix}`;
  state.save_file.reservations.push({
    reservation_id: reservationId,
    actor_id: 'test_runner',
    target_ref: { object_type: 'MaterialLot', object_id: lotId },
    quantity: { amount, unit: lot.quantity.unit },
    reason: 'reservation_guard_contract_test',
    created_time: state.save_file.world_time.absolute_minute,
    expire_time: null,
    status: 'active',
    source_action_id: null,
    flags: ['test_only']
  });
  return reservationId;
}

function releaseTestReservation(state: GameState, reservationId: string): void {
  const reservation = state.save_file.reservations.find((item) => item.reservation_id === reservationId);
  assert.ok(reservation);
  reservation.status = 'released';
}

test('active reservation blocks split_lot, start_processing, and cook_dish without polluting failed Action state', () => {
  const audit = new StorageAudit(auditPolicies);

  {
    const { contracts, runtime, state } = buildRuntime();
    const cabbageLotId = prepareHarvestedCabbage(runtime, state);
    const reservationId = injectTestReservation(state, cabbageLotId, 50, 'split');
    const reservation = state.save_file.reservations.find((item) => item.reservation_id === reservationId)!;
    contracts.assertReservation(reservation);
    audit.assertReconciled(state.save_file);
    const before = cloneForCompare(state);
    const failed = dispatch(runtime, state, 'split_lot', { source_lot_id: cabbageLotId, quantity: { amount: 50, unit: 'g' } }, 'reserved_split_failure');
    assert.equal(failed.success, false);
    assert.equal(failed.status_code, 'ERR_ALREADY_RESERVED');
    assert.equal(failed.domain_events.length, 0);
    assert.equal(failed.event_log_entries.length, 0);
    assert.deepEqual(state, before);
    audit.assertReconciled(state.save_file);
    releaseTestReservation(state, reservationId);
    const releasedSplit = dispatch(runtime, state, 'split_lot', { source_lot_id: cabbageLotId, quantity: { amount: 50, unit: 'g' } }, 'released_split_success');
    assert.equal(releasedSplit.success, true);
    contracts.assertSaveFile(state.save_file);
    audit.assertReconciled(state.save_file);
  }

  {
    const { contracts, runtime, state } = buildRuntime();
    const cabbageLotId = prepareHarvestedCabbage(runtime, state);
    const split = dispatch(runtime, state, 'split_lot', { source_lot_id: cabbageLotId, quantity: { amount: 300, unit: 'g' } }, 'reservation_processing_split');
    assert.equal(split.success, true);
    const splitLotId = split.created_objects[0]!.object_id;
    const reservationId = injectTestReservation(state, splitLotId, 50, 'processing');
    const before = cloneForCompare(state);
    const failed = dispatch(runtime, state, 'start_processing', {
      method_id: 'pickling_cabbage_basic',
      input_lots: [
        { lot_id: splitLotId, quantity: { amount: 300, unit: 'g' } },
        { lot_id: 'salt_initial_001', quantity: { amount: 15, unit: 'g' } }
      ],
      facility_ref: picklingFacilityRef
    }, 'reserved_processing_failure');
    assert.equal(failed.success, false);
    assert.equal(failed.status_code, 'ERR_ALREADY_RESERVED');
    assert.equal(failed.domain_events.length, 0);
    assert.equal(failed.event_log_entries.length, 0);
    assert.deepEqual(state, before);
    audit.assertReconciled(state.save_file);
    releaseTestReservation(state, reservationId);
    const releasedStart = dispatch(runtime, state, 'start_processing', {
      method_id: 'pickling_cabbage_basic',
      input_lots: [
        { lot_id: splitLotId, quantity: { amount: 300, unit: 'g' } },
        { lot_id: 'salt_initial_001', quantity: { amount: 15, unit: 'g' } }
      ],
      facility_ref: picklingFacilityRef
    }, 'released_processing_success');
    assert.equal(releasedStart.success, true);
    contracts.assertSaveFile(state.save_file);
    audit.assertReconciled(state.save_file);
  }

  {
    const { contracts, runtime, state } = buildRuntime();
    const pickledLotId = preparePickledCabbage(runtime, state);
    const reservationId = injectTestReservation(state, pickledLotId, 50, 'cooking');
    const before = cloneForCompare(state);
    const failed = cookBaconCabbage(runtime, state, pickledLotId, 'reserved_cooking_failure');
    assert.equal(failed.success, false);
    assert.equal(failed.status_code, 'ERR_ALREADY_RESERVED');
    assert.equal(failed.domain_events.length, 0);
    assert.equal(failed.event_log_entries.length, 0);
    assert.deepEqual(state, before);
    audit.assertReconciled(state.save_file);
    releaseTestReservation(state, reservationId);
    const releasedCook = cookBaconCabbage(runtime, state, pickledLotId, 'released_cooking_success');
    assert.equal(releasedCook.success, true);
    contracts.assertSaveFile(state.save_file);
    audit.assertReconciled(state.save_file);
  }
});

test('StorageAudit detects active reservation target and quantity inconsistencies', () => {
  const { runtime, state } = buildRuntime();
  const audit = new StorageAudit(auditPolicies);
  const cabbageLotId = prepareHarvestedCabbage(runtime, state);
  const lot = state.save_file.inventory.find((item) => item.lot_id === cabbageLotId)!;

  const excessive = injectTestReservation(state, cabbageLotId, lot.quantity.amount + 1, 'excessive');
  let report = audit.audit(state.save_file);
  assert.equal(report.ok, false);
  assert.equal(report.issues.some((issue) => issue.code === 'ERR_RESERVATION_QUANTITY_EXCEEDS_LOT' && issue.object_id === cabbageLotId), true);

  state.save_file.reservations = state.save_file.reservations.filter((item) => item.reservation_id !== excessive);
  state.save_file.reservations.push({
    reservation_id: 'res_test_ghost',
    actor_id: 'test_runner',
    target_ref: { object_type: 'MaterialLot', object_id: 'missing_lot_for_reservation' },
    quantity: { amount: 1, unit: 'g' },
    reason: 'reservation_audit_contract_test',
    created_time: state.save_file.world_time.absolute_minute,
    expire_time: null,
    status: 'active',
    source_action_id: null,
    flags: ['test_only']
  });
  report = audit.audit(state.save_file);
  assert.equal(report.ok, false);
  assert.equal(report.issues.some((issue) => issue.code === 'ERR_RESERVATION_TARGET_MISSING' && issue.object_id === 'missing_lot_for_reservation'), true);
});
