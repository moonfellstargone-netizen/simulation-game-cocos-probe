import test from 'node:test';
import { testBuildId } from './support/buildId.mjs';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CocosSessionHost, MinimalMenuInteractionController, QinglanUiSceneProbeComponent, RecordingCocosComponentNodeBindingPort } from '../src/cocos-creator-adapter';
import { MenuActionBinding } from '../src/cocos-creator-adapter/menu/MenuActionBinding';
import { InMemorySaveStoragePort, type Quantity, type SaveFile } from '../src/game-core';
import type { CocosSelectableViewModelData, CocosMaterialLotOption, CocosCookableRecipeOption } from '../src/cocos-app/view-models/CocosSelectableViewModel';
import { buildRuntimeWithoutState, cloneForCompare } from './support/runtimeHarness';

function makeMenu() {
  const { configs, contracts } = buildRuntimeWithoutState();
  const storage = new InMemorySaveStoragePort();
  const host = new CocosSessionHost(configs, contracts, storage, {
    buildId: testBuildId('cocos_menu_binding_test'),
    nowIso8601: '2026-05-21T00:00:00.000Z'
  });
  host.createSession();
  const controller = new MinimalMenuInteractionController(host);
  return { host, controller, storage, configs };
}

async function v44MenuBytes(menu: ReturnType<typeof makeMenu>, slot: string): Promise<string> {
  await menu.host.requireSession().save(slot);
  return required(await menu.storage.read(slot), 'serialized complete menu state');
}

function makeV44MenuWithRealDishes() {
  const menu = makeMenu();
  const confirm = (selection: Parameters<typeof menu.controller.confirm>[0]) => {
    const snapshot = menu.controller.confirm(selection);
    assert.equal(snapshot.last_preview_result?.success, true, JSON.stringify(snapshot.errors));
    assert.equal(snapshot.last_action_result?.success, true, snapshot.last_action_result?.status_code);
    return snapshot;
  };
  const initial = required(menu.controller.refresh().selectable_view_model, 'initial options');
  const field = firstEnabled(initial.field_options, 'field');
  const seed = firstEnabled(initial.seed_lot_options, 'seed');
  const planted = confirm({ action_type: 'plant_crop', field_option_id: field.id, seed_lot_option_id: seed.id, seed_quantity: quantity(1, seed.quantity.unit) });
  const cropId = planted.last_action_result!.created_objects.find((item) => item.object_type === 'CropInstance')!.object_id;
  confirm({ action_type: 'advance_time', minutes: 5400 });
  const harvested = confirm({ action_type: 'harvest_crop', crop_option_id: cropId });
  const afterHarvest = required(harvested.selectable_view_model, 'harvest options');
  const cabbage = optionById(afterHarvest.processable_lot_options, harvested.last_action_result!.created_objects[0]!.object_id, 'fresh cabbage');
  const salt = required(afterHarvest.processable_lot_options.find((lot) => lot.base_id === 'salt'), 'salt');
  const methodId = commonProcessingMethod(cabbage, salt, afterHarvest);
  const facility = firstEnabled(afterHarvest.processing_facility_options.filter((item) => item.compatible_method_ids.includes(methodId)), 'facility');
  const started = confirm({ action_type: 'start_processing', method_id: methodId, input_lots: [
    { lot_option_id: cabbage.id, quantity: quantity(600, 'g') }, { lot_option_id: salt.id, quantity: quantity(30, 'g') }
  ], facility_option_id: facility.id });
  const taskId = started.last_action_result!.created_objects.find((item) => item.object_type === 'ProcessingTask')!.object_id;
  confirm({ action_type: 'advance_time', minutes: 2880 });
  confirm({ action_type: 'collect_processing_result', task_option_id: taskId });
  const dishIds: string[] = [];
  for (let index = 0; index < 2; index++) {
    const selectable = required(menu.controller.refresh().selectable_view_model, 'cooking options');
    const recipe = firstEnabled(selectable.cookable_recipe_options, 'recipe');
    const target = required(selectable.storage_target_options.find((item) => item.enabled && item.supported_forms.includes('cooked_dish')), 'dish storage');
    const cooked = confirm({ action_type: 'cook_dish', recipe_option_id: recipe.id, ingredient_options: buildIngredients(recipe, selectable),
      operation_profile: { heat_level: 'high', active_minutes: 8 }, target_storage_option_id: target.id });
    dishIds.push(cooked.last_action_result!.created_objects.find((item) => item.object_type === 'DishLot')!.object_id);
  }
  assert.notEqual(dishIds[0], dishIds[1]);
  return { ...menu, dishIds };
}

test('v44 explicit order and dish choices preview without mutation and settle only the selected real dish across fresh-host recovery', async () => {
  const menu = makeV44MenuWithRealDishes();
  const session = menu.host.requireSession();
  const source = JSON.parse(await v44MenuBytes(menu, 'v44_select_source')) as SaveFile;
  const selected = { ...structuredClone(source.orders[0]!), order_id: 'v44_selected_order', status: 'accepted', base_reward: 41 };
  source.orders.push(selected);
  await menu.storage.write('v44_select_controlled', JSON.stringify(source));
  await session.load('v44_select_controlled');
  const snapshot = menu.controller.refresh();
  const beforeView = structuredClone(snapshot.view_model);
  const beforeChoices = structuredClone(snapshot.selectable_view_model);
  const before = await v44MenuBytes(menu, 'v44_select_before');
  const selection = { action_type: 'submit_order' as const, order_option_id: selected.order_id, dish_lot_option_ids: [menu.dishIds[1]!] };
  const preview = menu.controller.preview(selection);
  assert.equal(preview.last_preview_result?.success, true);
  assert.equal(preview.last_action_result, null);
  assert.deepEqual(preview.view_model, beforeView);
  assert.deepEqual(preview.selectable_view_model, beforeChoices);
  assert.equal(await v44MenuBytes(menu, 'v44_select_preview'), before);

  const completed = menu.controller.confirm(selection);
  assert.equal(completed.last_preview_result?.success, true);
  assert.equal(completed.last_action_result?.success, true);
  const action = completed.last_action_result!;
  assert.equal(action.updated_objects.some((item) => item.object_type === 'Order' && item.object_id === selected.order_id), true);
  assert.equal(action.consumed_resources.length, 1);
  assert.equal(action.consumed_resources[0]!.resource_id, menu.dishIds[1]);
  assert.deepEqual(action.domain_events.map((event) => event.event_type), ['order.submitted', 'order.completed']);
  assert.equal(action.domain_events.every((event) => event.payload.order_id === selected.order_id), true);
  const after = JSON.parse(await v44MenuBytes(menu, 'v44_select_complete')) as SaveFile;
  const actual = required(completed.selectable_view_model?.order_options.find((order) => order.id === selected.order_id), 'completed selected order');
  assert.equal(actual.status, 'completed');
  assert.equal(actual.enabled, false);
  assert.deepEqual(actual.submitted_object_refs, [{ object_type: 'DishLot', object_id: menu.dishIds[1] }]);
  assert.equal(actual.result_summary?.submitted_count, source.dish_lots[1]!.serving_count);
  assert.equal(actual.result_summary?.result_key, 'OK_DEMAND_ACCEPTED');
  assert.notEqual(actual.result_summary?.reward_final, selected.base_reward, 'final reward comes from actual scoring rather than the displayed base');
  assert.equal(Number(after.player_state.money) - Number(source.player_state.money), actual.result_summary!.reward_final);
  assert.equal(after.player_state.reputation_map.west_market_tavern, source.player_state.reputation_map.west_market_tavern + 1);
  assert.deepEqual(after.orders[0], source.orders[0], 'selecting the second order never auto-submits the first');
  assert.deepEqual(after.dish_lots, source.dish_lots.filter((dish) => dish.dish_lot_id !== menu.dishIds[1]));
  assert.equal(after.storage_containers.some((container) => container.active_object_refs.some((ref) => ref.object_id === menu.dishIds[1])), false);
  assert.deepEqual(after.inventory, source.inventory);
  assert.deepEqual(after.fuel_state, source.fuel_state);
  assert.deepEqual(after.world_time, source.world_time);

  const complete = await v44MenuBytes(menu, 'v44_select_saved');
  const fresh = makeMenu();
  await fresh.storage.write('v44_select_restored', complete);
  await fresh.host.requireSession().load('v44_select_restored');
  const restored = fresh.controller.refresh();
  assert.deepEqual(restored.selectable_view_model?.order_options.find((order) => order.id === selected.order_id), actual);
  assert.equal(restored.last_action_result, null, 'a historical settlement is not this host\'s new command result');
  for (const current of [menu, fresh]) {
    const refused = current.controller.confirm(selection);
    assert.equal(refused.last_action_result, null);
    assert.equal(refused.errors.some((error) => error.message === 'ERR_MENU_OPTION_DISABLED:order_option'), true);
    assert.equal(await v44MenuBytes(current, 'v44_select_repeat'), complete);
  }
});

test('v44 menu rejects no dish, stale choices, closed or overdue orders and keeps the complete save usable', async () => {
  const empty = makeMenu();
  const options = required(empty.controller.refresh().selectable_view_model, 'empty options');
  assert.equal(options.submittable_dish_lot_options.length, 0);
  const emptyBefore = await v44MenuBytes(empty, 'v44_empty_before');
  const refusedEmpty = empty.controller.confirm({ action_type: 'submit_order', order_option_id: options.order_options[0]!.id, dish_lot_option_ids: [] });
  assert.equal(refusedEmpty.last_action_result, null);
  assert.equal(refusedEmpty.errors.some((item) => item.message === 'ERR_DRAFT_SUBMITTED_REFS_EMPTY'), true);
  assert.equal(await v44MenuBytes(empty, 'v44_empty_after'), emptyBefore);

  const menu = makeV44MenuWithRealDishes();
  const source = JSON.parse(await v44MenuBytes(menu, 'v44_refusal_source')) as SaveFile;
  const selection = { action_type: 'submit_order' as const, order_option_id: source.orders[0]!.order_id, dish_lot_option_ids: [menu.dishIds[0]!] };
  const cases = [
    ...['available', 'accepted'].map((status) => ({ status, overdue: true, selection })),
    ...['submitted', 'completed', 'failed', 'expired', 'cancelled'].map((status) => ({ status, overdue: false, selection })),
    { status: 'available', overdue: false, selection: { ...selection, dish_lot_option_ids: ['v44_missing_dish'] } },
    { status: 'available', overdue: false, selection: { ...selection, order_option_id: 'v44_missing_order' } }
  ];
  for (const item of cases) {
    const save = structuredClone(source);
    save.orders[0]!.status = item.status;
    if (item.overdue) save.orders[0]!.deadline_absolute_minute = save.world_time.absolute_minute - 1;
    const serialized = JSON.stringify(save);
    await menu.storage.write('v44_refusal_case', serialized);
    await menu.host.requireSession().load('v44_refusal_case');
    const beforeView = menu.controller.refresh().view_model;
    const result = menu.controller.confirm(item.selection);
    assert.equal(result.last_action_result, null);
    assert.equal(result.last_preview_result, null, 'binding rejects unavailable public selections before dispatch');
    assert.equal(result.errors.length, 1);
    assert.deepEqual(result.view_model, beforeView);
    assert.equal(await v44MenuBytes(menu, 'v44_refusal_after'), serialized);
  }
  await menu.storage.write('v44_refusal_healthy', JSON.stringify(source));
  await menu.host.requireSession().load('v44_refusal_healthy');
  assert.equal(menu.controller.confirm(selection).last_action_result?.success, true);
});

test('v44 accepted menu demand refusals preserve complete state and can recover with the other actual dish', async () => {
  const menu = makeV44MenuWithRealDishes();
  const source = JSON.parse(await v44MenuBytes(menu, 'v44_demand_source')) as SaveFile;
  source.orders[0]!.status = 'accepted';
  const selection = { action_type: 'submit_order' as const, order_option_id: source.orders[0]!.order_id, dish_lot_option_ids: [menu.dishIds[0]!] };
  for (const failure of ['safety', 'score']) {
    const save = structuredClone(source);
    const dish = save.dish_lots.find((lot) => lot.dish_lot_id === menu.dishIds[0])!;
    if (failure === 'safety') dish.dish_profile.safety_risk = 26;
    else { dish.dish_profile.saltiness = 0; dish.dish_profile.oiliness = 0; dish.suitability_tags = []; }
    const serialized = JSON.stringify(save);
    await menu.storage.write('v44_demand_controlled', serialized);
    await menu.host.requireSession().load('v44_demand_controlled');
    const before = menu.controller.refresh();
    assert.equal(before.selectable_view_model?.submittable_dish_lot_options.find((lot) => lot.id === menu.dishIds[0])?.enabled, true, 'a candidate is not a promise of a matching dish');
    for (const operation of ['preview', 'confirm'] as const) {
      const result = menu.controller[operation](selection);
      assert.equal(result.last_preview_result?.success, false);
      assert.equal(result.last_preview_result?.status_code, failure === 'safety' ? 'ERR_DEMAND_REJECTED_SAFETY' : 'ERR_DEMAND_SCORE_TOO_LOW');
      assert.equal(result.last_action_result, null);
      assert.deepEqual(result.view_model, before.view_model);
      assert.equal(await v44MenuBytes(menu, 'v44_demand_after_reject'), serialized);
    }
    const recovered = menu.controller.confirm({ ...selection, dish_lot_option_ids: [menu.dishIds[1]!] });
    assert.equal(recovered.last_action_result?.success, true);
    const after = JSON.parse(await v44MenuBytes(menu, 'v44_demand_recovered')) as SaveFile;
    assert.deepEqual(after.dish_lots, save.dish_lots.filter((lot) => lot.dish_lot_id !== menu.dishIds[1]));
    assert.equal(after.orders[0]!.status, 'completed');
  }
});

test('split quantity menu preview rejects fractional counts and full confirmation refreshes the active batch choices', async () => {
  const { host, storage } = makeMenu();
  const component = new QinglanUiSceneProbeComponent(host, new RecordingCocosComponentNodeBindingPort());
  await component.mount();
  const session = host.requireSession();
  const seed = required(session.getSelectableViewModel().splittable_lot_options.find((lot) => lot.quantity.unit === 'count'), 'discrete source');
  await session.save('split_menu_before');
  const before = await storage.read('split_menu_before');
  const beforeView = session.getViewModel();
  const invalid = { action_type: 'split_lot' as const, source_lot_option_id: seed.id, quantity: quantity(0.5, 'count') };
  for (const name of ['menu_preview', 'menu_confirm'] as const) {
    const response = await component.execute({ name, selection: invalid });
    assert.equal(response.command_result.status, 'completed');
    assert.equal(response.command_result.snapshot.menu.last_preview_result?.success, false);
    assert.equal(response.command_result.snapshot.menu.last_action_result, null);
    assert.deepEqual(session.getViewModel(), beforeView);
    await session.save('split_menu_failed');
    assert.equal(await storage.read('split_menu_failed'), before);
  }
  const full = await component.execute({ name: 'menu_confirm', selection: { ...invalid, quantity: quantity(seed.quantity.amount, 'count') } });
  assert.equal(full.command_result.snapshot.menu.last_preview_result?.success, true);
  const result = full.command_result.snapshot.menu.last_action_result!;
  assert.equal(result.success, true);
  assert.deepEqual(result.updated_objects.find((object) => object.object_id === seed.id)?.summary, { status: 'consumed' });
  const choices = session.getSelectableViewModel().splittable_lot_options;
  assert.equal(choices.some((lot) => lot.id === seed.id), false);
  const created = required(choices.find((lot) => lot.id === result.created_objects[0]!.object_id), 'full split output');
  assert.deepEqual(created.quantity, seed.quantity);
  await session.save('split_menu_complete');
  await component.unmount();
});

test('processing required inputs public component rejects missing salt and recovers using current selectable choices', async () => {
  const { host, storage, configs } = makeMenu();
  const port = new RecordingCocosComponentNodeBindingPort();
  const component = new QinglanUiSceneProbeComponent(host, port);
  await component.mount();
  const session = host.requireSession();
  const initial = session.getSelectableViewModel();
  const seed = firstEnabled(initial.seed_lot_options, 'seed');
  const field = firstEnabled(initial.field_options, 'field');
  await component.execute({ name: 'menu_confirm', selection: { action_type: 'plant_crop', field_option_id: field.id, seed_lot_option_id: seed.id, seed_quantity: quantity(1, seed.quantity.unit) } });
  await component.execute({ name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 5400 } });
  const crop = firstEnabled(session.getSelectableViewModel().harvestable_crop_options, 'harvestable crop');
  await component.execute({ name: 'menu_confirm', selection: { action_type: 'harvest_crop', crop_option_id: crop.id } });
  const selectable = session.getSelectableViewModel();
  const cabbage = required(selectable.processable_lot_options.find((lot) => lot.base_id === 'cabbage'), 'processable cabbage');
  const salt = required(selectable.processable_lot_options.find((lot) => lot.base_id === 'salt'), 'processable salt');
  const methodId = commonProcessingMethod(cabbage, salt, selectable);
  const facility = firstEnabled(selectable.processing_facility_options.filter((item) => item.compatible_method_ids.includes(methodId)), 'facility');
  const method = configs.requiredDoc<{ input_view_requirements: Array<{ base_id?: string; min_quantity_g?: number }> }>(`configs/processing/methods/${methodId}.yaml`);
  const minimumSalt = method.input_view_requirements.find((item) => item.base_id === 'salt')!.min_quantity_g!;
  const selection = { action_type: 'start_processing' as const, method_id: methodId,
    input_lots: [{ lot_option_id: cabbage.id, quantity: quantity(300, 'g') }], facility_option_id: facility.id };
  await session.save('component_processing_before');
  const before = await storage.read('component_processing_before');
  const beforeView = session.getViewModel();
  for (const name of ['menu_preview', 'menu_confirm'] as const) {
    const response = await component.execute({ name, selection });
    assert.equal(response.command_result.status, 'completed', 'queue processing completion is separate from business rejection');
    const menu = response.command_result.snapshot.menu;
    assert.equal(menu.last_preview_result?.success, false);
    assert.equal(menu.last_preview_result?.status_code, 'ERR_PROCESSING_INPUT_MISSING');
    assert.equal(menu.last_action_result, null);
    assert.deepEqual(session.getViewModel(), beforeView);
    assert.deepEqual(session.getSelectableViewModel(), selectable);
    await session.save('component_processing_after');
    assert.equal(await storage.read('component_processing_after'), before);
    const menuPatch = port.recordedPatches().filter((patch) => patch.section === 'menu').at(-1);
    assert.deepEqual(menuPatch?.payload, menu, 'actual component output carries the rejection');
  }
  const recovered = await component.execute({ name: 'menu_confirm', selection: { ...selection,
    input_lots: [...selection.input_lots, { lot_option_id: salt.id, quantity: quantity(minimumSalt, 'g') }] } });
  assert.equal(recovered.command_result.snapshot.menu.last_preview_result?.success, true);
  assert.equal(recovered.command_result.snapshot.menu.last_action_result?.success, true);
  assert.equal(recovered.command_result.snapshot.menu.last_action_result?.created_objects[0]?.object_id, 'task_processing_000001');
  assert.equal(session.getSelectableViewModel().splittable_lot_options.find((lot) => lot.id === cabbage.id)?.quantity.amount, cabbage.quantity.amount - 300);
  assert.equal(session.getSelectableViewModel().splittable_lot_options.find((lot) => lot.id === salt.id)?.quantity.amount, salt.quantity.amount - minimumSalt);
  await component.unmount();
});

function required<T>(value: T | undefined | null, label: string): T {
  assert.notEqual(value, undefined, label);
  assert.notEqual(value, null, label);
  return value as T;
}

function firstEnabled<T extends { enabled: boolean }>(options: T[], label: string): T {
  return required(options.find((item) => item.enabled), label);
}

function optionById<T extends { id: string }>(options: T[], id: string, label: string): T {
  return required(options.find((item) => item.id === id), label);
}

function quantity(amount: number, unit: Quantity['unit']): Quantity {
  return { amount, unit };
}

test('store_item binding previews without mutation then moves an explicitly selected whole material lot', () => {
  const { host, controller } = makeMenu();
  const selectable = required(controller.refresh().selectable_view_model, 'current selectable');
  const source = required(selectable.splittable_lot_options.find((lot) => lot.enabled
    && selectable.storage_target_options.some((target) => target.enabled
      && target.id !== lot.storage_ref.container_id && target.supported_forms.includes(lot.current_form))), 'movable material');
  const target = required(selectable.storage_target_options.find((candidate) => candidate.enabled
    && candidate.id !== source.storage_ref.container_id && candidate.supported_forms.includes(source.current_form)), 'compatible target');
  const selection = { action_type: 'store_item' as const, source_lot_option_id: source.id, target_storage_option_id: target.id };
  const before = cloneForCompare(host.requireSession().getSelectableViewModel());
  const preview = controller.preview(selection);
  assert.equal(preview.last_preview_result?.success, true);
  assert.equal(preview.last_action_result, null);
  assert.deepEqual(host.requireSession().getSelectableViewModel(), before);
  const moved = controller.confirm(selection);
  assert.equal(moved.last_preview_result?.success, true);
  assert.equal(moved.last_action_result?.success, true);
  const after = required(moved.selectable_view_model, 'selectable after move');
  const current = optionById(after.splittable_lot_options, source.id, 'same material lot');
  assert.deepEqual(current.quantity, source.quantity);
  assert.equal(current.base_id, source.base_id);
  assert.equal(current.current_form, source.current_form);
  assert.deepEqual(current.storage_ref, { location_id: target.location_id, storage_type: target.storage_type, container_id: target.id });
  assert.equal(moved.view_model?.time_label, preview.view_model?.time_label, 'moving does not advance world time');
  assert.equal(moved.view_model?.inventory_lot_count, preview.view_model?.inventory_lot_count, 'a whole lot keeps its identity/count');
  assert.ok(optionById(after.storage_target_options, target.id, 'updated target').used_capacity > target.used_capacity);
  assert.ok(optionById(after.storage_target_options, source.storage_ref.container_id, 'updated source').used_capacity
    < optionById(before.storage_target_options, source.storage_ref.container_id, 'previous source').used_capacity);
});

test('store_item binding rejects missing or disabled public source/target choices before dispatch', () => {
  const { host, controller } = makeMenu();
  const selectable = required(controller.refresh().selectable_view_model, 'current public choices');
  const lot = firstEnabled(selectable.splittable_lot_options, 'source lot');
  const target = firstEnabled(selectable.storage_target_options, 'target storage');
  const binding = new MenuActionBinding();
  const selection = { action_type: 'store_item' as const, source_lot_option_id: lot.id, target_storage_option_id: target.id };
  const before = cloneForCompare(host.requireSession().getSelectableViewModel());
  assert.throws(() => binding.buildDraft(selectable, { ...selection, source_lot_option_id: '' }), /ERR_MENU_OPTION_ID_INVALID:source_lot_option/);
  assert.throws(() => binding.buildDraft(selectable, { ...selection, source_lot_option_id: 'not_current' }), /ERR_MENU_OPTION_NOT_FOUND:source_lot_option/);
  assert.throws(() => binding.buildDraft(selectable, { ...selection, target_storage_option_id: 'not_current' }), /ERR_MENU_OPTION_NOT_FOUND:storage_target_option/);
  const disabledSource = structuredClone(selectable);
  optionById(disabledSource.splittable_lot_options, lot.id, 'isolated source observation').enabled = false;
  assert.throws(() => binding.buildDraft(disabledSource, selection), /ERR_MENU_OPTION_DISABLED:source_lot_option/);
  const disabledTarget = structuredClone(selectable);
  optionById(disabledTarget.storage_target_options, target.id, 'isolated target observation').enabled = false;
  assert.throws(() => binding.buildDraft(disabledTarget, selection), /ERR_MENU_OPTION_DISABLED:storage_target_option/);
  assert.deepEqual(host.requireSession().getSelectableViewModel(), before);
});

test('store_item binding preserves the existing formal same-container success contract', () => {
  const { host, controller } = makeMenu();
  const initial = controller.refresh();
  const selectable = required(initial.selectable_view_model, 'current public choices');
  const lot = required(selectable.splittable_lot_options.find((item) => item.enabled
    && selectable.storage_target_options.some((target) => target.id === item.storage_ref.container_id && target.enabled)), 'source in non-full container');
  const before = cloneForCompare(host.requireSession().getSelectableViewModel());
  const result = controller.confirm({ action_type: 'store_item', source_lot_option_id: lot.id, target_storage_option_id: lot.storage_ref.container_id });
  assert.equal(result.last_preview_result?.success, true);
  assert.equal(result.last_action_result?.success, true);
  assert.deepEqual(host.requireSession().getSelectableViewModel(), before, 'UI admission may prevent this no-op, but binding does not invent a new core refusal');
  assert.equal(result.view_model?.time_label, initial.view_model?.time_label);
});

function commonProcessingMethod(cabbage: CocosMaterialLotOption, salt: CocosMaterialLotOption, selectable: CocosSelectableViewModelData): string {
  const methodId = required(cabbage.compatible_method_ids.find((id) => salt.compatible_method_ids.includes(id)), 'common processing method');
  assert.equal(selectable.processing_facility_options.some((facility) => facility.enabled && facility.compatible_method_ids.includes(methodId)), true);
  return methodId;
}

function buildIngredients(recipe: CocosCookableRecipeOption, selectable: CocosSelectableViewModelData): Record<string, { lot_option_id: string; quantity: Quantity }> {
  const ingredients: Record<string, { lot_option_id: string; quantity: Quantity }> = {};
  for (const role of recipe.roles) {
    if (!role.required && role.lot_ids.length === 0) continue;
    const compatibleLots = role.lot_ids.map((id) => optionById(selectable.splittable_lot_options, id, `ingredient option ${role.role}`));
    const selectedLot = role.role === 'main'
      ? required(compatibleLots.find((lot) => lot.current_form === 'pickled') ?? compatibleLots[0], `ingredient lot for role ${role.role}`)
      : required(compatibleLots[0], `ingredient lot for role ${role.role}`);
    const roleQuantity = role.min_quantity ?? selectedLot.quantity;
    ingredients[role.role] = { lot_option_id: selectedLot.id, quantity: { ...roleQuantity } };
  }
  return ingredients;
}

test('Minimal menu binding runs Stage 1A clicks through selectable -> draft -> preview -> confirm dispatch -> refresh', () => {
  const { host, controller } = makeMenu();
  const initialSnapshot = controller.refresh();
  const initialSelectable = required(initialSnapshot.selectable_view_model, 'initial selectable');
  const beforePreview = cloneForCompare(host.requireSession().getViewModel());

  const field = firstEnabled(initialSelectable.field_options, 'enabled field');
  const seed = firstEnabled(initialSelectable.seed_lot_options, 'enabled seed');
  const plantSelection = { action_type: 'plant_crop' as const, field_option_id: field.id, seed_lot_option_id: seed.id, seed_quantity: quantity(1, seed.quantity.unit) };

  const plantPreview = controller.preview(plantSelection);
  assert.equal(plantPreview.last_preview_result?.success, true);
  assert.equal(plantPreview.last_action_result, null);
  assert.deepEqual(host.requireSession().getViewModel(), beforePreview);

  let snapshot = controller.confirm(plantSelection);
  assert.equal(snapshot.last_preview_result?.success, true);
  assert.equal(snapshot.last_action_result?.success, true);
  const cropId = required(snapshot.last_action_result?.created_objects.find((item) => item.object_type === 'CropInstance')?.object_id, 'crop id');
  assert.equal(required(snapshot.selectable_view_model, 'selectable after plant').field_options.find((item) => item.id === field.id)?.enabled, false);

  snapshot = controller.confirm({ action_type: 'advance_time', minutes: 5400 });
  assert.equal(snapshot.last_action_result?.success, true);

  const harvestable = optionById(required(snapshot.selectable_view_model, 'selectable after growth').harvestable_crop_options, cropId, 'harvestable crop');
  snapshot = controller.confirm({ action_type: 'harvest_crop', crop_option_id: harvestable.id });
  assert.equal(snapshot.last_action_result?.success, true);
  const cabbageLotId = required(snapshot.last_action_result?.created_objects.find((item) => item.object_type === 'MaterialLot')?.object_id, 'harvested cabbage lot');

  const cabbageLot = optionById(required(snapshot.selectable_view_model, 'selectable after harvest').processable_lot_options, cabbageLotId, 'processable cabbage');
  snapshot = controller.confirm({ action_type: 'split_lot', source_lot_option_id: cabbageLot.id, quantity: quantity(300, 'g') });
  assert.equal(snapshot.last_action_result?.success, true);
  const splitLotId = required(snapshot.last_action_result?.created_objects.find((item) => item.object_type === 'MaterialLot')?.object_id, 'split cabbage lot');

  const afterSplit = required(snapshot.selectable_view_model, 'selectable after split');
  const splitCabbage = optionById(afterSplit.processable_lot_options, splitLotId, 'split cabbage option');
  const salt = required(afterSplit.processable_lot_options.find((item) => item.base_id === 'salt'), 'salt option from selectable');
  const methodId = commonProcessingMethod(splitCabbage, salt, afterSplit);
  const facility = firstEnabled(afterSplit.processing_facility_options.filter((item) => item.compatible_method_ids.includes(methodId)), 'processing facility');
  snapshot = controller.confirm({
    action_type: 'start_processing',
    method_id: methodId,
    input_lots: [
      { lot_option_id: splitCabbage.id, quantity: quantity(300, 'g') },
      { lot_option_id: salt.id, quantity: quantity(15, 'g') }
    ],
    facility_option_id: facility.id
  });
  assert.equal(snapshot.last_action_result?.success, true);
  const taskId = required(snapshot.last_action_result?.created_objects.find((item) => item.object_type === 'ProcessingTask')?.object_id, 'processing task');

  snapshot = controller.confirm({ action_type: 'advance_time', minutes: 2880 });
  assert.equal(snapshot.last_action_result?.success, true);

  const task = optionById(required(snapshot.selectable_view_model, 'selectable after processing time').collectable_task_options, taskId, 'collectable task');
  snapshot = controller.confirm({ action_type: 'collect_processing_result', task_option_id: task.id });
  assert.equal(snapshot.last_action_result?.success, true);

  const afterCollect = required(snapshot.selectable_view_model, 'selectable after collect');
  const recipe = firstEnabled(afterCollect.cookable_recipe_options, 'enabled recipe');
  const target = required(afterCollect.storage_target_options.find((item) => item.enabled && item.supported_forms.includes('cooked_dish')), 'dish storage target');
  snapshot = controller.confirm({
    action_type: 'cook_dish',
    recipe_option_id: recipe.id,
    ingredient_options: buildIngredients(recipe, afterCollect),
    operation_profile: { heat_level: 'high', active_minutes: 8 },
    target_storage_option_id: target.id
  });
  assert.equal(snapshot.last_action_result?.success, true);
  const dishLotId = required(snapshot.last_action_result?.created_objects.find((item) => item.object_type === 'DishLot')?.object_id, 'dish lot');

  const afterCook = required(snapshot.selectable_view_model, 'selectable after cook');
  const order = firstEnabled(afterCook.order_options, 'enabled order');
  const dish = optionById(afterCook.submittable_dish_lot_options, dishLotId, 'submittable dish');
  snapshot = controller.confirm({ action_type: 'submit_order', order_option_id: order.id, dish_lot_option_ids: [dish.id] });

  assert.equal(snapshot.last_action_result?.success, true);
  assert.equal(snapshot.view_model?.money, 137);
  assert.equal(snapshot.view_model?.orders.find((item) => item.id === order.id)?.status, 'completed');
  assert.equal(snapshot.view_model?.dish_lot_count, 0);
  assert.equal(snapshot.view_model?.active_reservation_count, 0);
});

test('Minimal menu binding refuses unavailable choices before dispatch and refreshes without direct state access', () => {
  const { host, controller } = makeMenu();
  const snapshot = controller.refresh();
  const before = cloneForCompare(host.requireSession().getViewModel());
  const missing = controller.confirm({ action_type: 'harvest_crop', crop_option_id: 'not_in_selectable_options' });

  assert.equal(missing.last_action_result, null);
  assert.equal(missing.errors.some((item) => item.message.includes('ERR_MENU_OPTION_NOT_FOUND')), true);
  assert.deepEqual(host.requireSession().getViewModel(), before);
  assert.equal(snapshot.selectable_view_model?.field_options.some((item) => item.enabled), true);
});

test('Minimal menu source stays engine-neutral and contains no fixture business defaults', () => {
  const files = collectFiles(join(process.cwd(), 'src/cocos-creator-adapter/menu')).filter((file) => file.endsWith('.ts'));
  const combined = files.map((file) => readFileSync(file, 'utf8')).join('\n');

  for (const forbidden of [
    'game-core/dev-api',
    'game-core/testing-api',
    'Stage1AFixtureRunner',
    'Stage1AHeadlessRuntime',
    'Stage1AActionScriptRunner',
    "from 'cc'",
    'from "cc"',
    "from 'node:fs'",
    'from "node:fs"',
    "from 'fs'",
    'from "fs"',
    'wx.',
    'field_plot_01',
    'seed_cabbage_initial_001',
    'salt_initial_001',
    'pickling_jar_basic_01',
    'tavern_home_dish_001'
  ]) {
    assert.equal(combined.includes(forbidden), false, `menu source leaked forbidden token ${forbidden}`);
  }

  for (const forbiddenPattern of [/\.inventory\s*=/, /\.orders\s*=/, /\.dish_lots\s*=/, /\.reservations\s*=/, /\.money\s*=/]) {
    assert.equal(forbiddenPattern.test(combined), false, `menu source contains direct mutation pattern ${forbiddenPattern}`);
  }
});

function collectFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? collectFiles(full) : [full];
  });
}
