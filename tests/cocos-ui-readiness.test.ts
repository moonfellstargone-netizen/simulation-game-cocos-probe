import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CocosActionDraftBuilder } from '../src/cocos-app/adapters/CocosActionDraftBuilder';
import { CocosAppRuntimeSession } from '../src/cocos-app/runtime/CocosAppRuntimeSession';
import { InMemorySaveStoragePort, type ActionResult } from '../src/game-core';
import { buildRuntimeWithoutState, cloneForCompare } from './support/runtimeHarness';

function makeSession() {
  const { configs, contracts } = buildRuntimeWithoutState();
  return new CocosAppRuntimeSession(configs, contracts, new InMemorySaveStoragePort(), {
    buildId: 'cocos_ui_readiness_test_v0_0_2_22',
    nowIso8601: '2026-05-19T00:00:00.000Z'
  });
}

function dispatchAndAssert(result: ActionResult, actionType: string): ActionResult {
  assert.equal(result.success, true, `${actionType} failed with ${result.status_code}`);
  return result;
}

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
