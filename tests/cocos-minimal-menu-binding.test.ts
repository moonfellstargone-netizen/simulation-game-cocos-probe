import test from 'node:test';
import { testBuildId } from './support/buildId.mjs';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CocosSessionHost, MinimalMenuInteractionController } from '../src/cocos-creator-adapter';
import { MenuActionBinding } from '../src/cocos-creator-adapter/menu/MenuActionBinding';
import { InMemorySaveStoragePort, type Quantity } from '../src/game-core';
import type { CocosSelectableViewModelData, CocosMaterialLotOption, CocosCookableRecipeOption } from '../src/cocos-app/view-models/CocosSelectableViewModel';
import { buildRuntimeWithoutState, cloneForCompare } from './support/runtimeHarness';

function makeMenu() {
  const { configs, contracts } = buildRuntimeWithoutState();
  const host = new CocosSessionHost(configs, contracts, new InMemorySaveStoragePort(), {
    buildId: testBuildId('cocos_menu_binding_test'),
    nowIso8601: '2026-05-21T00:00:00.000Z'
  });
  host.createSession();
  const controller = new MinimalMenuInteractionController(host);
  return { host, controller };
}

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
