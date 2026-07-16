import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CocosAppRuntimeSession } from '../src/cocos-app/runtime/CocosAppRuntimeSession';
import { FORMAL_STAGE_1A_ACTION_TYPES, InMemorySaveStoragePort, StorageAudit, type ActionResult, type SaveFile } from '../src/game-core';
import { Stage1AActionScriptRunner, Stage1AHeadlessRuntime } from '../src/game-core/dev-api';
import { Stage1AFixtureRunner, type Stage1AFixtureDocument } from '../src/game-core/testing-api';
import { buildRuntimeWithoutState } from './support/runtimeHarness';
import { baselineBuildIds } from './support/buildId.mjs';

const EXPECTED_FORMAL_ACTIONS = [
  'plant_crop',
  'advance_time',
  'harvest_crop',
  'store_item',
  'split_lot',
  'start_processing',
  'collect_processing_result',
  'cook_dish',
  'submit_order'
];

function dispatchAndAssert(result: ActionResult, actionType: string): ActionResult {
  assert.equal(result.success, true, `${actionType} failed with ${result.status_code}`);
  return result;
}

function runCoreLoopThroughSession(session: CocosAppRuntimeSession): Record<string, string> {
  const refs: Record<string, string> = {};

  const plant = dispatchAndAssert(session.dispatch('plant_crop', {
    field_plot_id: 'field_plot_01',
    seed_lot_id: 'seed_cabbage_initial_001',
    seed_quantity: { amount: 1, unit: 'count' }
  }), 'plant_crop');
  refs.crop = plant.created_objects.find((item) => item.object_type === 'CropInstance')!.object_id;

  dispatchAndAssert(session.dispatch('advance_time', { minutes: 5400 }), 'advance_time');

  const harvest = dispatchAndAssert(session.dispatch('harvest_crop', { crop_id: refs.crop }), 'harvest_crop');
  refs.cabbage_lot = harvest.created_objects.find((item) => item.object_type === 'MaterialLot')!.object_id;

  const split = dispatchAndAssert(session.dispatch('split_lot', {
    source_lot_id: refs.cabbage_lot,
    quantity: { amount: 300, unit: 'g' }
  }), 'split_lot');
  refs.cabbage_split_lot = split.created_objects.find((item) => item.object_type === 'MaterialLot')!.object_id;

  const start = dispatchAndAssert(session.dispatch('start_processing', {
    method_id: 'pickling_cabbage_basic',
    input_lots: [
      { lot_id: refs.cabbage_split_lot, quantity: { amount: 300, unit: 'g' } },
      { lot_id: 'salt_initial_001', quantity: { amount: 15, unit: 'g' } }
    ],
    facility_ref: {
      location_id: 'home',
      storage_type: 'pickling_jar',
      container_id: 'pickling_jar_basic_01',
      definition_id: 'pickling_jar_basic',
      facility_id: 'pickling_jar_basic_01'
    }
  }), 'start_processing');
  refs.pickling_task = start.created_objects.find((item) => item.object_type === 'ProcessingTask')!.object_id;

  dispatchAndAssert(session.dispatch('advance_time', { minutes: 2880 }), 'advance_time');

  const collect = dispatchAndAssert(session.dispatch('collect_processing_result', { task_id: refs.pickling_task }), 'collect_processing_result');
  refs.pickled_cabbage_lot = collect.created_objects.find((item) => item.object_type === 'MaterialLot')!.object_id;

  const cook = dispatchAndAssert(session.dispatch('cook_dish', {
    recipe_variant_id: 'bacon_cabbage_basic',
    ingredients: {
      main: { lot_id: refs.pickled_cabbage_lot, quantity: { amount: 250, unit: 'g' } },
      side: { lot_id: 'bacon_initial_001', quantity: { amount: 50, unit: 'g' } },
      oil: { lot_id: 'oil_initial_001', quantity: { amount: 10, unit: 'ml' } }
    },
    technique: 'stir_fry',
    operation_profile: { heat_level: 'high', active_minutes: 8 },
    target_storage_ref: { location_id: 'home', storage_type: 'room_temp', container_id: 'home_room_temp_01' }
  }), 'cook_dish');
  refs.dish_lot = cook.created_objects.find((item) => item.object_type === 'DishLot')!.object_id;

  dispatchAndAssert(session.dispatch('submit_order', {
    order_id: 'tavern_home_dish_001',
    submitted_object_refs: [{ object_type: 'DishLot', object_id: refs.dish_lot }]
  }), 'submit_order');

  return refs;
}

function assertStage1ABaselineSaveFile(saveFile: SaveFile, submittedDishLotId: string | undefined): void {
  const order = saveFile.orders.find((item) => item.order_id === 'tavern_home_dish_001');
  assert.equal(order?.status, 'completed');
  assert.equal(Number(saveFile.player_state.money), 137);
  assert.equal(saveFile.player_state.reputation_map.west_market_tavern, 1);
  assert.equal(saveFile.dish_lots.length, 0);
  if (submittedDishLotId) {
    assert.equal(saveFile.dish_lots.some((item) => item.dish_lot_id === submittedDishLotId), false);
    assert.equal(saveFile.storage_containers.some((container) => container.active_object_refs.some((ref) => ref.object_type === 'DishLot' && ref.object_id === submittedDishLotId)), false);
  }
  assert.equal(saveFile.processing_tasks.some((item) => item.status === 'completed'), true);
  new StorageAudit().assertReconciled(saveFile);
}

test('Stage 1A baseline keeps the formal action catalog closed and explicit', () => {
  assert.deepEqual([...FORMAL_STAGE_1A_ACTION_TYPES], EXPECTED_FORMAL_ACTIONS);
});

test('Stage 1A baseline final state is consistent across fixture runner, headless runtime, and Cocos session save port', async () => {
  const { snapshot, configs, contracts, runtime } = buildRuntimeWithoutState();
  const fixture = snapshot.loaded_documents['tests/fixtures/stage_1A_action_sequence.yaml'] as Stage1AFixtureDocument;

  const fixtureReport = new Stage1AFixtureRunner(runtime.pipeline, {
    configs,
    buildId: baselineBuildIds.fixture_baseline,
    nowIso8601: '2026-05-19T00:00:00.000Z'
  }).runFixtureThroughStepId(fixture, 'T20_release_injected_reservation');

  const headlessRuntime = new Stage1AHeadlessRuntime(configs, contracts, {
    buildId: baselineBuildIds.headless_baseline,
    nowIso8601: '2026-05-19T00:00:00.000Z'
  });
  const headlessReport = new Stage1AActionScriptRunner().runCoreLoop(headlessRuntime);

  const storage = new InMemorySaveStoragePort();
  const cocosSession = new CocosAppRuntimeSession(configs, contracts, storage, {
    buildId: baselineBuildIds.cocos_baseline,
    nowIso8601: '2026-05-19T00:00:00.000Z'
  });
  const cocosRefs = runCoreLoopThroughSession(cocosSession);
  await cocosSession.save('stage1a_baseline');
  const savedCocos = storage.snapshot().get('stage1a_baseline');
  assert.equal(typeof savedCocos, 'string');
  const cocosSaveFile = JSON.parse(savedCocos!) as SaveFile;

  assertStage1ABaselineSaveFile(fixtureReport.state.save_file, fixtureReport.aliases.dish_lot as string | undefined);
  assertStage1ABaselineSaveFile(headlessRuntime.state.save_file, headlessReport.refs.dish_lot);
  assertStage1ABaselineSaveFile(cocosSaveFile, cocosRefs.dish_lot);

  contracts.assertSaveFile(fixtureReport.state.save_file);
  contracts.assertSaveFile(headlessRuntime.state.save_file);
  contracts.assertSaveFile(cocosSaveFile);

  assert.deepEqual(headlessReport.step_results.map((step) => step.action_type), [
    'plant_crop',
    'advance_time',
    'harvest_crop',
    'split_lot',
    'start_processing',
    'advance_time',
    'collect_processing_result',
    'cook_dish',
    'submit_order'
  ]);
  assert.equal(headlessReport.step_results.every((step) => step.success), true);
  assert.equal(headlessReport.step_results.some((step) => step.action_type.startsWith('system.')), false);

  const fixtureActionTypes = fixtureReport.step_results.map((step) => step.action_type);
  for (const actionType of EXPECTED_FORMAL_ACTIONS) {
    assert.equal(fixtureActionTypes.includes(actionType), true, `fixture does not cover ${actionType}`);
  }
});

test('Stage 1A baseline package metadata and docs do not retain old code package version markers', () => {
  const root = process.cwd();
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string; scripts: Record<string, string> };
  assert.equal(packageJson.version, '0.0.2-26');
  const checkSurface = `${packageJson.scripts.check}\n${readFileSync(join(root, 'tools/run-code-check.mjs'), 'utf8')}\n${readFileSync(join(root, 'tools/quality/test-registry.json'), 'utf8')}`;
  assert.equal(checkSurface.includes('tests/cocos-ui-readiness.test.ts'), true);
  assert.equal(checkSurface.includes('tests/action-preview-boundary.test.ts'), true);
  assert.equal(checkSurface.includes('tests/cocos-creator-lifecycle-probe.test.ts'), true);
  assert.equal(checkSurface.includes('tests/cocos-minimal-menu-binding.test.ts'), true);
  assert.equal(checkSurface.includes('tests/stage1a-baseline.test.ts'), true);
  assert.equal(checkSurface.includes('tests/cocos-save-load-ui-binding.test.ts'), true);
  assert.equal(checkSurface.includes('tests/cocos-error-presentation.test.ts'), true);
  assert.equal(checkSurface.includes('tests/cocos-ui-shell-composition.test.ts'), true);
  assert.equal(checkSurface.includes('tests/cocos-ui-command-queue.test.ts'), true);
  assert.equal(checkSurface.includes('tests/cocos-ui-render-diff.test.ts'), true);
  assert.equal(checkSurface.includes('tests/package-hygiene.test.mjs'), true);

  const sourceDesign = readFileSync(join(root, 'design_snapshot/SOURCE_DESIGN_PACK.txt'), 'utf8');
  assert.equal(sourceDesign.includes('code_package_version: v0.0.2.26'), true);

  const scannedFiles = [
    'README.md',
    'docs/ARCHITECTURE.md',
    'docs/IMPLEMENTATION_SCOPE.md',
    'docs/SOURCE_DESIGN_PACK.md',
    'design_snapshot/SOURCE_DESIGN_PACK.txt',
    'src/cocos-app/README.md',
    'src/cocos-creator-adapter/README.md'
  ];
  const oldCodeMarkers = [
    'v0.0.1.8', 'v0.0.1.9', 'v0_0_1_8', 'v0_0_1_9', '0.0.1-9',
    ...Array.from({ length: 18 }, (_, patch) => [`v0.0.2.${patch}`, `v0_0_2_${patch}`, `0.0.2-${patch}`]).flat()
  ];
  for (const rel of scannedFiles) {
    const text = readFileSync(join(root, rel), 'utf8');
    for (const marker of oldCodeMarkers) {
      const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      assert.equal(new RegExp(`${escaped}(?![0-9])`).test(text), false, `${rel} kept an old code package marker ${marker}`);
    }
  }
});
