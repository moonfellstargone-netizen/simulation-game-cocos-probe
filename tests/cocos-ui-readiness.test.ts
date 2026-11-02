import test from 'node:test';
import { testBuildId } from './support/buildId.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CocosActionDraftBuilder } from '../src/cocos-app/adapters/CocosActionDraftBuilder';
import { CocosAppRuntimeSession } from '../src/cocos-app/runtime/CocosAppRuntimeSession';
import { CocosSelectableViewModel } from '../src/cocos-app/view-models/CocosSelectableViewModel';
import { InMemorySaveStoragePort, type ActionResult, type SaveFile } from '../src/game-core';
import { buildRuntimeWithoutState, cloneForCompare } from './support/runtimeHarness';

function makeSessionFixture(storage = new InMemorySaveStoragePort()) {
  const { configs, contracts } = buildRuntimeWithoutState();
  const session = new CocosAppRuntimeSession(configs, contracts, storage, {
    buildId: testBuildId('cocos_ui_readiness_test'),
    nowIso8601: '2026-05-19T00:00:00.000Z'
  });
  return { session, storage, configs };
}

function makeSession() {
  return makeSessionFixture().session;
}

function dispatchAndAssert(result: ActionResult, actionType: string): ActionResult {
  assert.equal(result.success, true, `${actionType} failed with ${result.status_code}`);
  return result;
}

function required<T>(value: T | undefined | null, label: string): T {
  assert.ok(value !== undefined && value !== null, label);
  return value;
}

function harvestForProcessing(session: CocosAppRuntimeSession): string {
  const selectable = session.getSelectableViewModel();
  const field = required(selectable.field_options.find((option) => option.enabled), 'available field');
  const seed = required(selectable.seed_lot_options.find((option) => option.enabled), 'available seed');
  const planted = dispatchAndAssert(session.dispatch('plant_crop', {
    field_plot_id: field.id, seed_lot_id: seed.id, seed_quantity: { amount: 1, unit: seed.quantity.unit }
  }), 'plant_crop');
  const cropId = required(planted.created_objects.find((object) => object.object_type === 'CropInstance'), 'planted crop').object_id;
  dispatchAndAssert(session.dispatch('advance_time', { minutes: 5400 }), 'advance_time');
  const harvested = dispatchAndAssert(session.dispatch('harvest_crop', { crop_id: cropId }), 'harvest_crop');
  return required(harvested.created_objects.find((object) => object.object_type === 'MaterialLot'), 'harvested lot').object_id;
}

test('processing methods remain browsable without cabbage and expose configured input requirements and compatible facilities', () => {
  const { session, configs } = makeSessionFixture();
  const selectable = session.getSelectableViewModel();
  assert.ok(Array.isArray(selectable.processing_method_options), 'public processing methods are available before any harvest');
  const config = configs.requiredDoc<{
    id: string; display_name_key: string; time_cost_minutes: number; process_duration_minutes: number; tool_requirements: string[];
    input_view_requirements: Array<{ category?: string; allowed_base_ids?: string[]; allowed_forms?: string[]; min_freshness?: number; base_id?: string; min_quantity_g?: number }>;
  }>('configs/processing/methods/pickling_cabbage_basic.yaml');
  assert.deepEqual(selectable.processing_method_options.map((method) => method.id), [config.id], 'only loaded Stage 1A methods are exposed');
  const method = selectable.processing_method_options[0]!;
  assert.equal(method.label_key, config.display_name_key);
  assert.equal(method.enabled, true, 'missing material must not hide the requirements');
  assert.equal(method.reason_key, null);
  assert.equal(method.time_cost_minutes, config.time_cost_minutes);
  assert.equal(method.process_duration_minutes, config.process_duration_minutes);
  assert.deepEqual(method.tool_requirements, config.tool_requirements, 'display-only tool requirements come from the active method configuration');
  assert.equal(method.input_requirements.length, config.input_view_requirements.length);
  const primary = required(method.input_requirements.find((input) => input.requirement_index === 0), 'primary requirement slot');
  assert.deepEqual(primary.constraints, {
    category: config.input_view_requirements[0]!.category, base_id: null,
    allowed_base_ids: config.input_view_requirements[0]!.allowed_base_ids,
    allowed_forms: config.input_view_requirements[0]!.allowed_forms,
    min_freshness: config.input_view_requirements[0]!.min_freshness
  });
  assert.equal(primary.min_quantity, null, '300g is a chosen amount, not a configured primary minimum');
  assert.deepEqual(primary.lot_ids, []);
  const salt = required(method.input_requirements.find((input) => input.constraints.base_id === 'salt'), 'salt requirement slot');
  assert.equal(salt.requirement_index, 1);
  assert.deepEqual(salt.min_quantity, { amount: config.input_view_requirements[1]!.min_quantity_g, unit: 'g' });
  assert.deepEqual(salt.lot_ids, selectable.processable_lot_options.filter((lot) => lot.base_id === 'salt').map((lot) => lot.id));
  assert.deepEqual(method.compatible_facility_ids, selectable.processing_facility_options.filter((facility) => facility.compatible_method_ids.includes(method.id)).map((facility) => facility.id));
  assert.ok(method.compatible_facility_ids.length > 0);
  assert.deepEqual(selectable.processing_task_options, []);
});

test('processing requirement candidates refresh from their constraints and detached public data cannot mutate state or config', async () => {
  const { session, storage, configs } = makeSessionFixture();
  const cabbageId = harvestForProcessing(session);
  await session.save('readiness_candidates');
  const source = required(await storage.read('readiness_candidates'), 'saved candidate fixture');
  const save = JSON.parse(source) as SaveFile;
  const projector = new CocosSelectableViewModel(configs);
  const selectable = projector.build(save);
  assert.ok(Array.isArray(selectable.processing_method_options), 'public requirement candidates are exposed');
  const method = selectable.processing_method_options[0]!;
  const primary = required(method.input_requirements.find((input) => input.constraints.allowed_base_ids.includes('cabbage')), 'cabbage requirement');
  const salt = required(method.input_requirements.find((input) => input.constraints.base_id === 'salt'), 'salt requirement');
  assert.deepEqual(primary.lot_ids, [cabbageId]);
  assert.equal(salt.lot_ids.includes(cabbageId), false);
  const cabbage = required(save.inventory.find((lot) => lot.lot_id === cabbageId), 'source cabbage');
  const freshness = cabbage.property_profile.freshness;
  cabbage.property_profile.freshness = required(primary.constraints.min_freshness, 'configured freshness') - 1;
  assert.deepEqual(projector.build(save).processing_method_options[0]!.input_requirements[primary.requirement_index]!.lot_ids, []);
  cabbage.property_profile.freshness = primary.constraints.min_freshness!;
  assert.deepEqual(projector.build(save).processing_method_options[0]!.input_requirements[primary.requirement_index]!.lot_ids, [cabbageId], 'freshness boundary remains selectable');
  cabbage.current_form = 'pickled';
  assert.deepEqual(projector.build(save).processing_method_options[0]!.input_requirements[primary.requirement_index]!.lot_ids, [], 'an incompatible form is absent from this slot');
  cabbage.current_form = 'fresh';
  cabbage.property_profile.freshness = freshness!;
  const before = projector.build(save);
  const configPath = `configs/processing/methods/${method.id}.yaml`;
  const configBefore = structuredClone(configs.requiredDoc(configPath));
  primary.constraints.allowed_base_ids.push('unregistered_test_value');
  primary.constraints.allowed_forms.length = 0;
  primary.lot_ids.length = 0;
  salt.min_quantity!.amount = 999;
  method.compatible_facility_ids.length = 0;
  method.tool_requirements.push('detached_tool');
  selectable.processing_method_options.length = 0;
  assert.deepEqual(projector.build(save), before, 'later projections are detached from every nested option array and quantity');
  assert.deepEqual(configs.requiredDoc(configPath), configBefore);
  assert.deepEqual(save, JSON.parse(source), 'projection and public mutations leave the complete source save unchanged');
});

test('processing task choices distinguish active, collectable and completed tasks across fresh-session load without leaking mutable references', async () => {
  const { session, storage } = makeSessionFixture();
  const cabbageId = harvestForProcessing(session);
  const selectable = session.getSelectableViewModel();
  assert.ok(Array.isArray(selectable.processing_method_options), 'public processing methods are available');
  const method = selectable.processing_method_options[0]!;
  const salt = required(selectable.processable_lot_options.find((lot) => lot.base_id === 'salt' && lot.enabled), 'available salt');
  const facility = required(selectable.processing_facility_options.find((option) => option.enabled && method.compatible_facility_ids.includes(option.id)), 'compatible facility');
  const inputs = [{ lot_id: cabbageId, quantity: { amount: 300, unit: 'g' } }, { lot_id: salt.id, quantity: { amount: 15, unit: 'g' } }];
  const draft = new CocosActionDraftBuilder().startProcessing(method.id, inputs, facility.facility_ref);
  assert.deepEqual(Object.keys(draft.parameters).sort(), ['facility_ref', 'input_lots', 'method_id']);
  for (const input of draft.parameters.input_lots) assert.deepEqual(Object.keys(input).sort(), ['lot_id', 'quantity'], 'requirement indices never become formal roles');
  const started = dispatchAndAssert(session.dispatch(draft.action_type, draft.parameters), 'start_processing');
  const taskId = required(started.created_objects.find((object) => object.object_type === 'ProcessingTask'), 'created task').object_id;
  const activeChoices = session.getSelectableViewModel();
  const active = required(activeChoices.processing_task_options.find((task) => task.id === taskId), 'visible active task');
  assert.equal(active.status, 'active');
  assert.equal(active.enabled, false);
  assert.equal(active.method_id, method.id);
  assert.equal(active.expected_finish_minute - active.start_world_minute, method.process_duration_minutes);
  assert.deepEqual(active.facility_ref, facility.facility_ref);
  assert.deepEqual(active.expected_output, { base_id: 'cabbage', quantity: inputs[0]!.quantity });
  assert.deepEqual(activeChoices.collectable_task_options, []);
  assert.equal(session.dispatch('collect_processing_result', { task_id: taskId }).status_code, 'ERR_PROCESSING_TASK_NOT_READY');
  await session.save('readiness_active');
  const activeSave = await storage.read('readiness_active');
  const expectedChoices = structuredClone(activeChoices);
  active.facility_ref.container_id = 'detached_container';
  active.expected_output!.quantity!.amount = 999;
  activeChoices.processing_task_options.length = 0;
  assert.deepEqual(session.getSelectableViewModel(), expectedChoices);
  await session.save('readiness_after_public_mutation');
  assert.equal(await storage.read('readiness_after_public_mutation'), activeSave);

  const restored = makeSessionFixture(storage).session;
  await restored.load('readiness_active');
  assert.deepEqual(restored.getSelectableViewModel().processing_task_options, expectedChoices.processing_task_options);
  dispatchAndAssert(restored.dispatch('advance_time', { minutes: method.process_duration_minutes }), 'advance_time');
  const readyChoices = restored.getSelectableViewModel();
  const ready = required(readyChoices.processing_task_options.find((task) => task.id === taskId), 'visible ready task');
  assert.equal(ready.status, 'ready_to_collect');
  assert.equal(ready.enabled, true);
  assert.equal(ready.reason_key, null);
  assert.deepEqual(readyChoices.collectable_task_options, [{
    id: ready.id, label_key: ready.label_key, enabled: true, reason_key: null,
    method_id: ready.method_id, status: ready.status, current_stage: ready.current_stage, expected_finish_minute: ready.expected_finish_minute
  }], 'legacy collectable options retain exactly their original shape');
  const collected = dispatchAndAssert(restored.dispatch('collect_processing_result', { task_id: taskId }), 'collect_processing_result');
  const outputId = required(collected.created_objects.find((object) => object.object_type === 'MaterialLot'), 'actual collected lot').object_id;
  const completedChoices = restored.getSelectableViewModel();
  const output = required(completedChoices.splittable_lot_options.find((lot) => lot.id === outputId), 'actual output remains publicly available');
  assert.deepEqual(output.quantity, inputs[0]!.quantity);
  assert.equal(output.current_form, 'pickled');
  assert.equal(completedChoices.processing_task_options.find((task) => task.id === taskId)?.status, 'completed');
  assert.equal(completedChoices.processing_task_options.find((task) => task.id === taskId)?.enabled, false);
  assert.deepEqual(completedChoices.collectable_task_options, []);
  await restored.save('readiness_completed');
  const completeSave = await storage.read('readiness_completed');
  const duplicate = restored.dispatch('collect_processing_result', { task_id: taskId });
  assert.equal(duplicate.success, false);
  assert.equal(duplicate.status_code, 'ERR_PROCESSING_TASK_ALREADY_COMPLETED');
  await restored.save('readiness_duplicate');
  assert.equal(await storage.read('readiness_duplicate'), completeSave);
  const reloaded = makeSessionFixture(storage).session;
  await reloaded.load('readiness_completed');
  assert.deepEqual(reloaded.getSelectableViewModel(), completedChoices);
});

test('selectable view model exposes UI-operable options without exposing SaveFile or GameState', () => {
  const session = makeSession();
  const before = cloneForCompare(session.getViewModel());
  const selectable = session.getSelectableViewModel();

  assert.equal(selectable.field_options.some((option) => option.id === 'field_plot_01' && option.enabled), true);
  assert.equal(selectable.seed_lot_options.some((option) => option.id === 'seed_cabbage_initial_001' && option.enabled), true);
  assert.equal(selectable.storage_target_options.some((option) => option.id === 'home_cellar_01'), true);
  assert.equal(selectable.order_options.some((option) => option.id === 'tavern_home_dish_001' && option.enabled), true);
  assert.equal(JSON.stringify(selectable).includes('save_file'), false);
  assert.equal(JSON.stringify(selectable).includes('domain_events'), false);
  assert.deepEqual(session.getViewModel(), before);
});

test('selectable view model updates from current state but stays read-only', () => {
  const session = makeSession();
  const plant = dispatchAndAssert(session.dispatch('plant_crop', {
    field_plot_id: 'field_plot_01',
    seed_lot_id: 'seed_cabbage_initial_001',
    seed_quantity: { amount: 1, unit: 'count' }
  }), 'plant_crop');
  const cropId = plant.created_objects.find((item) => item.object_type === 'CropInstance')!.object_id;

  let selectable = session.getSelectableViewModel();
  assert.equal(selectable.field_options.find((option) => option.id === 'field_plot_01')?.enabled, false);
  assert.equal(selectable.harvestable_crop_options.some((option) => option.id === cropId), false);

  dispatchAndAssert(session.dispatch('advance_time', { minutes: 5400 }), 'advance_time');
  selectable = session.getSelectableViewModel();
  assert.equal(selectable.harvestable_crop_options.some((option) => option.id === cropId && option.enabled), true);

  const harvest = dispatchAndAssert(session.dispatch('harvest_crop', { crop_id: cropId }), 'harvest_crop');
  const cabbageLotId = harvest.created_objects.find((item) => item.object_type === 'MaterialLot')!.object_id;
  selectable = session.getSelectableViewModel();
  assert.equal(selectable.splittable_lot_options.some((option) => option.id === cabbageLotId), true);
  assert.equal(selectable.processable_lot_options.some((option) => option.id === cabbageLotId && option.compatible_method_ids.includes('pickling_cabbage_basic')), true);
});

test('CocosActionDraftBuilder converts selected UI values into formal Action parameters without fixture defaults', () => {
  const drafts = new CocosActionDraftBuilder();

  assert.deepEqual(drafts.plantCrop('selected_field', 'selected_seed', { amount: 2, unit: 'count' }), {
    action_type: 'plant_crop',
    parameters: { field_plot_id: 'selected_field', seed_lot_id: 'selected_seed', seed_quantity: { amount: 2, unit: 'count' } }
  });
  assert.deepEqual(drafts.splitLot('selected_lot', { amount: 120, unit: 'g' }), {
    action_type: 'split_lot',
    parameters: { source_lot_id: 'selected_lot', quantity: { amount: 120, unit: 'g' } }
  });
  assert.throws(() => drafts.advanceTime(0), /ERR_DRAFT_MINUTES_INVALID/);
  assert.throws(() => drafts.plantCrop('', 'selected_seed', { amount: 1, unit: 'count' }), /ERR_DRAFT_ID_INVALID/);

  const source = readFileSync(join(process.cwd(), 'src/cocos-app/adapters/CocosActionDraftBuilder.ts'), 'utf8');
  for (const forbidden of ['field_plot_01', 'seed_cabbage_initial_001', 'tavern_home_dish_001', 'pickling_jar_basic_01']) {
    assert.equal(source.includes(forbidden), false, `draft builder hardcoded fixture or initial ID ${forbidden}`);
  }
});
