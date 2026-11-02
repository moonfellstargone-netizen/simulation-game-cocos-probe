import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { assertClickObservation, assertDisabledInventoryObservation, assertFarmingCommandObservation, assertFarmingLoadRecovery, assertFarmingProjection, assertInventoryCommandObservation, assertInventoryLoadRecovery, assertInventoryProjection, assertLocalInventoryObservation, assertLocalSaveRecovery, assertLocalSelectionObservation, assertSplitConfirmObservation, assertSplitDisabledObservation, assertSplitLoadRecovery, assertSplitPreviewObservation, assertSplitProjection, assertSplitQuantityObservation, assertStoredSaveUnchanged, assertUiCommandObservation, capturePreparedSurface, checkPreparedSurfaceAfterBuild, createWebReportDirectory, parseWebProbeArgs, readWebProbeSource, resizeViewports, serveWebProbe, sha256, timeInMinutes, webTreeDigest, within } from '../tools/cocos-probe/lib/webProbeSupport.mjs';
import { verifyWebProbe } from '../tools/cocos-probe/verify-web.mjs';
import * as processingChecks from '../tools/cocos-probe/lib/webProbeSupport.mjs';

function cookingState() {
  const state = inventoryState();
  state.panel = 'cooking';
  state.farming.materialOptions = structuredClone(state.inventory.lotOptions);
  state.cooking = {
    recipeOptions: [{ id: 'recipe', roles: [{ role: 'main', required: true, lot_ids: ['material'] }], fuel: { enabled: true, current_quantity: { amount: 15, unit: 'bundle' }, cost: { amount: 1, unit: 'bundle' } } }],
    lotOptions: structuredClone(state.inventory.lotOptions), targetOptions: structuredClone(state.inventory.targetOptions), dishOptions: [],
    selectedRecipeId: 'recipe', selectedRole: 'main', selectedTargetId: 'room', heatLevel: 'high', activeMinutesText: '8',
    inputSelections: [{ role: 'main', lotId: 'material', quantityText: '30' }], currentInputLotOptions: [structuredClone(state.inventory.lotOptions[0])],
    currentInputQuantityText: '30', currentInputUnit: 'g', inputError: null, canPreview: true, canCook: false, preview: null, result: null
  };
  state.displayedCooking = { recipe: '配方', role: '主料', lot: '材料', quantityText: '30', unit: '克', selection: '已选30克', operation: '大火', minutesText: '8', target: '常温储存', fuel: '燃料15捆', preview: '请先预览', result: '尚无本次菜品', dishes: '暂无菜品' };
  return state;
}

test('cooking preview verifies current failure and unchanged materials, fuel and dishes', () => {
  const before = cookingState(); const after = structuredClone(before);
  after.operation = { sequence: before.operation.sequence + 1, name: 'menu_preview', status: 'completed', errorMessage: null, slotId: null, worldMinute: null, message: '本次校验通过，尚未执行' };
  after.displayedOperation = after.operation.message;
  after.cooking.preview = { success: true, statusCode: 'OK' }; after.cooking.canCook = true;
  const valid = farmingClick(before, after);
  assert.doesNotThrow(() => processingChecks.assertCookingPreviewObservation(valid));
  for (const mutate of [
    x => { x.after.displayedCooking.fuel = '燃料999捆'; },
    x => { x.after.cooking.recipeOptions[0].fuel.current_quantity.amount--; },
    x => { x.after.cooking.dishOptions.push({ id: 'unexpected' }); },
    x => { x.after.inventory.lotOptions[0].quantity.amount--; },
    x => { x.after.operation.status = 'failed'; },
    x => { x.after.cooking.preview.statusCode = 'STALE'; },
    x => { x.eventCount = 0; }
  ]) { const bad = structuredClone(valid); mutate(bad); assert.throws(() => processingChecks.assertCookingPreviewObservation(bad)); }
  const rejected = structuredClone(valid);
  rejected.after.operation.status = 'failed'; rejected.after.operation.errorMessage = 'ERR_MENU_RECIPE_ROLE_MISSING:side';
  rejected.after.operation.message = rejected.after.displayedOperation = '缺少必需材料';
  rejected.after.cooking.preview = { success: false, statusCode: 'ERR_MENU_RECIPE_ROLE_MISSING:side' }; rejected.after.cooking.canCook = false;
  assert.doesNotThrow(() => processingChecks.assertCookingPreviewObservation(rejected, { statusCode: 'ERR_MENU_RECIPE_ROLE_MISSING:side' }));
  rejected.after.cooking.canCook = true;
  assert.throws(() => processingChecks.assertCookingPreviewObservation(rejected, { statusCode: 'ERR_MENU_RECIPE_ROLE_MISSING:side' }));
});

test('cooking local and disabled input cannot dispatch or mutate the world', () => {
  const before = cookingState(); const after = structuredClone(before); after.cooking.selectedRole = 'main';
  const local = farmingClick(before, after);
  assert.doesNotThrow(() => processingChecks.assertLocalCookingObservation(local, { key: 'selectedRole', value: 'main' }));
  for (const mutate of [x => { x.after.operation.sequence++; }, x => { x.after.cooking.dishOptions.push({ id: 'fake' }); }, x => { x.after.inventory.targetOptions[0].used_capacity++; }]) {
    const bad = structuredClone(local); mutate(bad); assert.throws(() => processingChecks.assertLocalCookingObservation(bad, {}));
  }
  const disabled = farmingClick(before, structuredClone(before)); disabled.eventCount = 0; disabled.layout.buttonInteractable = false;
  assert.doesNotThrow(() => processingChecks.assertCookingDisabledObservation(disabled, 'CookDish'));
  for (const mutate of [x => { x.eventCount = 1; }, x => { x.layout.buttonInteractable = true; }, x => { x.after.cooking.recipeOptions[0].fuel.current_quantity.amount--; }]) {
    const bad = structuredClone(disabled); mutate(bad); assert.throws(() => processingChecks.assertCookingDisabledObservation(bad, 'CookDish'));
  }
});

test('cooking manual load restores exact dishes and fuel while clearing local success', () => {
  const saved = cookingState(); const before = structuredClone(saved); before.cooking.recipeOptions[0].fuel.current_quantity.amount = 14;
  const after = structuredClone(saved); after.operation = { sequence: before.operation.sequence + 1, name: 'load', status: 'completed', errorMessage: null, slotId: 'web_probe', worldMinute: timeInMinutes(saved.timeLabel) - 1440, message: '已恢复本地存档' }; after.displayedOperation = after.operation.message;
  const valid = farmingClick(before, after);
  assert.doesNotThrow(() => processingChecks.assertCookingLoadRecovery(saved, valid));
  for (const mutate of [x => { x.after.cooking.recipeOptions[0].fuel.current_quantity.amount--; }, x => { x.after.cooking.dishOptions.push({ id: 'fake' }); }, x => { x.after.cooking.result = { dishLotId: 'old' }; }, x => { x.after.operation.sequence++; }]) {
    const bad = structuredClone(valid); mutate(bad); assert.throws(() => processingChecks.assertCookingLoadRecovery(saved, bad));
  }
});

test('cooking edits require physical events, visible text geometry and invalidated preview', () => {
  for (const inputName of ['CookingQuantity', 'CookingMinutes']) {
    const before = cookingState(); const after = structuredClone(before);
    if (inputName === 'CookingQuantity') { after.cooking.currentInputQuantityText = after.cooking.inputSelections[0].quantityText = after.displayedCooking.quantityText = '20'; }
    else after.cooking.activeMinutesText = after.displayedCooking.minutesText = '20';
    const valid = farmingClick(before, after); valid.eventCount = 0; valid.inputName = inputName;
    valid.focused = { className: 'cocosEditBox', value: '20' }; valid.editEvents = { began: 1, changed: 2, ended: 1 };
    valid.layout.inputLabels = { text: { ...valid.layout.button }, placeholder: { ...valid.layout.button } };
    assert.doesNotThrow(() => processingChecks.assertCookingInputObservation(valid, '20'));
    for (const mutate of [x => { x.editEvents.changed = 0; }, x => { x.focused.value = '8'; }, x => { x.layout.inputLabels.text.left--; }, x => { x.after.cooking.preview = { success: true, statusCode: 'OK' }; }, x => { x.after.operation.sequence++; }]) {
      const bad = structuredClone(valid); mutate(bad); assert.throws(() => processingChecks.assertCookingInputObservation(bad, '20'));
    }
  }
});

test('cooking confirmation rejects old dishes, false consumption, false fuel and stale preview', () => {
  const before = cookingState(); before.cooking.preview = { success: true, statusCode: 'OK' }; before.cooking.canCook = true;
  const after = structuredClone(before);
  after.operation = { sequence: before.operation.sequence + 1, name: 'menu_confirm', status: 'completed', errorMessage: null, slotId: null, worldMinute: null, message: '烹饪成功' }; after.displayedOperation = after.operation.message;
  for (const list of [after.inventory.lotOptions, after.cooking.lotOptions, after.farming.materialOptions]) list[0].quantity.amount = 70;
  after.cooking.recipeOptions[0].fuel.current_quantity.amount = 14;
  after.displayedCooking.fuel = '燃料14捆';
  const dish = { id: 'dish-new', recognized_dish_id: 'cooked', serving_count: 2, storage_ref: { location_id: 'home', storage_type: 'room_temp', container_id: 'room' } };
  after.cooking.dishOptions = [dish]; after.cooking.result = { dishLotId: dish.id, servingCount: 2, recognizedDishId: 'cooked', storageRef: dish.storage_ref };
  after.cooking.preview = null; after.cooking.canCook = false; after.displayedCooking.result = '烹饪成功，2份';
  const valid = farmingClick(before, after);
  assert.doesNotThrow(() => processingChecks.assertCookingConfirmObservation(valid));
  for (const mutate of [
    x => { x.before.cooking.dishOptions = structuredClone(x.after.cooking.dishOptions); },
    x => { x.after.cooking.result.dishLotId = 'wrong'; },
    x => { x.after.inventory.lotOptions[0].quantity.amount = 100; },
    x => { x.after.cooking.recipeOptions[0].fuel.current_quantity.amount = 15; },
    x => { x.after.cooking.preview = { success: true, statusCode: 'OK' }; },
    x => { x.before.cooking.canCook = false; },
    x => { x.after.displayedCooking.result = '尚无菜品'; }
  ]) { const bad = structuredClone(valid); mutate(bad); assert.throws(() => processingChecks.assertCookingConfirmObservation(bad)); }
});

const root = realpathSync(resolve('.'));
function fixture(t) {
  const temporary = mkdtempSync(join(tmpdir(), 'cocos-web-contract-'));
  t.after(() => { assert.ok(within(realpathSync(tmpdir()), realpathSync(temporary))); rmSync(temporary, { recursive: true, force: true }); });
  const project = join(temporary, 'project'); mkdirSync(project);
  writeFileSync(join(project, 'source.txt'), 'prepared source');
  const manifest = { format: 'cocos-probe-source/v1', sourceCommit: 'a'.repeat(40), sourceDirty: false, version: 'fixture', creatorVersion: '3.8.8', outputs: { 'source.txt': { sha256: sha256('prepared source') } } };
  const bytes = JSON.stringify(manifest); writeFileSync(join(project, 'probe-source-manifest.json'), bytes);
  mkdirSync(join(project, 'build/web-desktop'), { recursive: true });
  writeFileSync(join(project, 'build/web-desktop/index.html'), '<html>built bytes</html>');
  const buildRecord = join(temporary, 'build.json');
  const built = { passed: true, creatorExitCode: 36, preparedManifestSha256: sha256(bytes), projectDir: project, sourceCommit: manifest.sourceCommit, sourceDirty: false, creatorVersion: '3.8.8', preparedSurfaceAfter: capturePreparedSurface(project, manifest), creatorNormalizations: [], webBuild: webTreeDigest(join(project, 'build/web-desktop')) };
  writeFileSync(buildRecord, JSON.stringify(built));
  return { temporary, project, buildRecord, manifest, built };
}

test('CLI requires explicit absolute inputs and only accepts loopback editor preview', () => {
  const args = ['--project', resolve('project'), '--browser', resolve('browser'), '--report-dir', resolve('reports'), '--build-record', resolve('build.json')];
  assert.equal(parseWebProbeArgs(args).project, resolve('project'));
  assert.equal(parseWebProbeArgs([...args, '--preview-url', 'http://localhost:7456/?scene=sample']).previewUrl, 'http://localhost:7456/?scene=sample');
  for (const invalid of [[], args.slice(0, -2), [...args, '--project', resolve('other')], [...args, '--unknown', 'value'], ['--project', 'relative'], [...args, '--preview-url', 'https://example.com/'], [...args, '--preview-url', 'http://localhost.evil.example/'], [...args, '--preview-url', 'http://user:password@localhost/']]) {
    assert.throws(() => parseWebProbeArgs(invalid), /ERR_WEB_PROBE_/);
  }
  const cli = spawnSync(process.execPath, ['tools/cocos-probe/verify-web.mjs'], { encoding: 'utf8', windowsHide: true });
  assert.equal(cli.status, 1); assert.match(cli.stderr, /ERR_WEB_PROBE_/);
});

test('physical click observations reject no-op, duplicate action, scrolling and clipped controls', () => {
  const before = { phase: 'ready', hasSession: true, timeLabel: 'day 1 minute 360', displayedTime: 'day 1 minute 360', errors: [] };
  const rectangle = { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 };
  const valid = { before, after: { ...before, timeLabel: 'day 1 minute 420', displayedTime: 'day 1 minute 420' }, eventCount: 1, scrollBefore: { x: 0, y: 0 }, scrollDown: { x: 0, y: 0 }, scrollAfter: { x: 0, y: 0 }, layout: { viewport: { width: 800, height: 600 }, canvas: rectangle, button: { left: 200, top: 200, right: 400, bottom: 300, width: 200, height: 100 } } };
  assert.doesNotThrow(() => assertClickObservation(valid));
  const variants = [
    { ...valid, eventCount: 0 }, { ...valid, eventCount: 2 },
    { ...valid, after: { ...valid.after, timeLabel: 'day 1 minute 480', displayedTime: 'day 1 minute 480' } },
    { ...valid, after: { ...valid.after, displayedTime: before.displayedTime } },
    { ...valid, scrollDown: { x: 0, y: 85 } }, { ...valid, scrollAfter: { x: 1, y: 0 } },
    { ...valid, layout: { ...valid.layout, canvas: { ...rectangle, right: 1280, width: 1280 } } },
    { ...valid, layout: { ...valid.layout, button: { ...valid.layout.button, bottom: 610 } } },
    { ...valid, after: { ...valid.after, errors: ['failure'] } }
  ];
  for (const variant of variants) assert.throws(() => assertClickObservation(variant));
  assert.equal(timeInMinutes('day 2 minute 10') - timeInMinutes('day 1 minute 1390'), 60);
  assert.throws(() => timeInMinutes('day 1 minute 1440'), /ERR_WEB_PROBE_TIME_LABEL/);
});

test('save and load click observations require one current command, exact state and visible feedback', () => {
  const time = 'day 1 minute 420';
  const rectangle = { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 };
  const before = { phase: 'ready', hasSession: true, busy: false, timeLabel: time, displayedTime: time, errors: [], operation: { sequence: 3 } };
  const saved = {
    before, after: { ...before, operation: { sequence: 4, name: 'save', status: 'completed', message: 'Saved temporary slot', errorMessage: null, slotId: 'web_probe', worldMinute: 420 }, displayedOperation: 'Saved temporary slot' },
    eventCount: 1, scrollBefore: { x: 0, y: 0 }, scrollDown: { x: 0, y: 0 }, scrollAfter: { x: 0, y: 0 },
    layout: { viewport: { width: 800, height: 600 }, canvas: rectangle, button: { left: 200, top: 200, right: 400, bottom: 300, width: 200, height: 100 } }
  };
  const expectation = { name: 'save', status: 'completed', timeLabel: time };
  assert.doesNotThrow(() => assertUiCommandObservation(saved, expectation));
  const variants = [
    { ...saved, eventCount: 0 }, { ...saved, eventCount: 2 },
    { ...saved, before: { ...before, busy: true } },
    ...[{ sequence: 3 }, { sequence: 5 }, { name: 'load' }, { status: 'failed' }, { errorMessage: 'old load failed' }, { slotId: 'wrong_slot' }, { worldMinute: 480 }, { worldMinute: null }, { message: '' }].map((change) => ({ ...saved, after: { ...saved.after, operation: { ...saved.after.operation, ...change } } })),
    { ...saved, after: { ...saved.after, busy: true } },
    { ...saved, after: { ...saved.after, displayedOperation: 'old success' } },
    { ...saved, after: { ...saved.after, timeLabel: 'day 1 minute 480', displayedTime: 'day 1 minute 480' } },
    { ...saved, after: { ...saved.after, errors: ['unexpected runtime failure'] } }
  ];
  for (const variant of variants) assert.throws(() => assertUiCommandObservation(variant, expectation));
  const loaded = { ...saved, before: { ...before, timeLabel: 'day 1 minute 480', displayedTime: 'day 1 minute 480' }, after: { ...saved.after, operation: { ...saved.after.operation, name: 'load' } } };
  assert.doesNotThrow(() => assertUiCommandObservation(loaded, { name: 'load', status: 'completed', timeLabel: time }));
  assert.throws(() => assertUiCommandObservation({ ...loaded, after: { ...loaded.after, timeLabel: loaded.before.timeLabel, displayedTime: loaded.before.timeLabel } }, { name: 'load', status: 'completed', timeLabel: time }));
  const nextDayTime = 'day 2 minute 10';
  assert.doesNotThrow(() => assertUiCommandObservation({ ...loaded, after: { ...loaded.after, timeLabel: nextDayTime, displayedTime: nextDayTime, operation: { ...loaded.after.operation, worldMinute: 1450 } } }, { name: 'load', status: 'completed', timeLabel: nextDayTime }));
});

function farmingState() {
  return {
    phase: 'ready', hasSession: true, busy: false, timeLabel: 'day 1 minute 360', displayedTime: 'day 1 minute 360', errors: [],
    operation: { sequence: 0, name: null, status: 'idle', message: '请选择地块和种子', errorMessage: null, slotId: null, worldMinute: null },
    displayedOperation: '请选择地块和种子', displayedFarming: { field: '地块可用', seed: '种子10粒', crop: '暂无可收获作物', inventory: '种子10粒', amount: '1粒' },
    farming: {
      fieldOptions: [{ id: 'field', enabled: true, occupied_tiles: 0, active_crop_count: 0 }],
      seedOptions: [{ id: 'seed', enabled: true, quantity: { amount: 10, unit: 'count' } }],
      harvestableOptions: [], materialOptions: [{ id: 'seed', enabled: true, quantity: { amount: 10, unit: 'count' } }],
      selectedFieldId: 'field', selectedSeedId: 'seed', selectedCropId: null, seedAmount: 1, canPlant: true, canHarvest: false
    }
  };
}

function farmingClick(before, after) {
  return {
    before, after, eventCount: 1, scrollBefore: { x: 0, y: 0 }, scrollDown: { x: 0, y: 0 }, scrollAfter: { x: 0, y: 0 },
    layout: { viewport: { width: 960, height: 640 }, canvas: { left: 0, top: 0, right: 960, bottom: 640, width: 960, height: 640 }, button: { left: 100, top: 100, right: 300, bottom: 140, width: 200, height: 40 } }
  };
}

function plantedState() {
  const state = farmingState();
  state.farming.fieldOptions[0] = { id: 'field', enabled: false, occupied_tiles: 1, active_crop_count: 1 };
  state.farming.seedOptions[0].quantity.amount = 9;
  state.farming.materialOptions[0].quantity.amount = 9;
  state.farming.selectedFieldId = null;
  state.farming.canPlant = false;
  state.operation = { sequence: 1, name: 'menu_confirm', status: 'completed', message: '播种成功', errorMessage: null, slotId: null, worldMinute: null };
  state.displayedOperation = '播种成功';
  return state;
}

test('farming selections require one physical event, no command and unchanged public world data', () => {
  const before = farmingState(); before.farming.selectedFieldId = null;
  const after = structuredClone(before); after.farming.selectedFieldId = 'field';
  const valid = farmingClick(before, after);
  assert.doesNotThrow(() => assertLocalSelectionObservation(valid, { key: 'selectedFieldId', value: 'field' }));
  const mutations = [
    (x) => { x.eventCount = 2; },
    (x) => { x.after.operation.sequence++; },
    (x) => { x.after.timeLabel = x.after.displayedTime = 'day 1 minute 420'; },
    (x) => { x.after.farming.seedOptions[0].quantity.amount--; },
    (x) => { x.after.farming.selectedFieldId = 'old-field'; },
    (x) => { x.after.farming.fieldOptions[0].enabled = false; },
    (x) => { x.after.displayedFarming.field = ''; },
    (x) => { x.after.busy = true; }
  ];
  for (const mutate of mutations) {
    const invalid = structuredClone(valid); mutate(invalid);
    assert.throws(() => assertLocalSelectionObservation(invalid, { key: 'selectedFieldId', value: 'field' }));
  }
});

test('farming success needs actual seed consumption and field occupancy, while rejection preserves state', () => {
  const valid = farmingClick(farmingState(), plantedState());
  const expectation = { actionType: 'plant_crop', status: 'completed', timeLabel: valid.before.timeLabel };
  assert.doesNotThrow(() => assertFarmingCommandObservation(valid, expectation));
  for (const mutate of [
    (x) => { x.after.farming.seedOptions[0].quantity.amount = 10; },
    (x) => { x.after.farming.seedOptions[0].quantity.unit = 'g'; },
    (x) => { x.after.farming.fieldOptions[0].occupied_tiles = 0; },
    (x) => { x.after.farming.fieldOptions[0].active_crop_count = 0; },
    (x) => { x.after.farming.selectedFieldId = 'field'; },
    (x) => { x.after.displayedOperation = x.after.operation.message = '已推进一小时'; }
  ]) {
    const invalid = structuredClone(valid); mutate(invalid);
    assert.throws(() => assertFarmingCommandObservation(invalid, expectation));
  }
  const rejected = structuredClone(valid); rejected.after = structuredClone(rejected.before);
  rejected.after.operation = { ...rejected.before.operation, sequence: 1, name: 'menu_confirm', status: 'failed', message: '资源不足，请调整数量', errorMessage: 'ERR_NOT_ENOUGH_RESOURCE' };
  rejected.after.displayedOperation = rejected.after.operation.message;
  const failure = { ...expectation, status: 'failed', errorMessage: 'ERR_NOT_ENOUGH_RESOURCE' };
  assert.doesNotThrow(() => assertFarmingCommandObservation(rejected, failure));
  for (const mutate of [
    (x) => { x.after.operation.status = 'completed'; },
    (x) => { x.after.farming.seedOptions[0].quantity.amount--; },
    (x) => { x.after.farming.fieldOptions[0].occupied_tiles++; }
  ]) {
    const invalid = structuredClone(rejected); mutate(invalid);
    assert.throws(() => assertFarmingCommandObservation(invalid, failure));
  }
  const day = farmingClick(farmingState(), farmingState());
  day.after.timeLabel = day.after.displayedTime = 'day 2 minute 360';
  day.after.operation = { ...valid.after.operation, message: '已推进一天' }; day.after.displayedOperation = '已推进一天';
  const dayExpected = { actionType: 'advance_time', status: 'completed', timeLabel: day.after.timeLabel };
  assert.doesNotThrow(() => assertFarmingCommandObservation(day, dayExpected));
  const short = structuredClone(day); short.after.timeLabel = short.after.displayedTime = 'day 1 minute 420';
  assert.throws(() => assertFarmingCommandObservation(short, { ...dayExpected, timeLabel: short.after.timeLabel }));
  const stale = structuredClone(day); stale.after.displayedOperation = stale.after.operation.message = '已推进一小时';
  assert.throws(() => assertFarmingCommandObservation(stale, dayExpected));
});

test('harvest requires positive public output quantity and field release, never a lot-count-only success', () => {
  const before = plantedState();
  before.farming.harvestableOptions = [{ id: 'crop', enabled: true, field_plot_id: 'field' }];
  before.farming.selectedCropId = 'crop'; before.farming.canHarvest = true;
  const after = structuredClone(before);
  after.farming.fieldOptions[0] = { id: 'field', enabled: true, occupied_tiles: 0, active_crop_count: 0 };
  after.farming.harvestableOptions = []; after.farming.selectedCropId = null; after.farming.canHarvest = false;
  after.farming.materialOptions.push({ id: 'produce', enabled: true, quantity: { amount: 100, unit: 'g' } });
  after.displayedFarming.inventory = '作物100克';
  after.operation = { ...before.operation, sequence: 2, message: '收获成功' }; after.displayedOperation = '收获成功';
  const valid = farmingClick(before, after);
  const expected = { actionType: 'harvest_crop', status: 'completed', timeLabel: before.timeLabel };
  assert.doesNotThrow(() => assertFarmingCommandObservation(valid, expected));
  for (const mutate of [
    (x) => { x.after.farming.materialOptions.at(-1).quantity.amount = 0; },
    (x) => { x.after.farming.fieldOptions[0].occupied_tiles = 1; },
    (x) => { x.after.farming.harvestableOptions = structuredClone(x.before.farming.harvestableOptions); },
    (x) => { x.after.farming.selectedCropId = 'crop'; },
    (x) => { x.after.displayedFarming.inventory = '共2批材料'; }
  ]) {
    const invalid = structuredClone(valid); mutate(invalid);
    assert.throws(() => assertFarmingCommandObservation(invalid, expected));
  }
  assert.throws(() => assertFarmingProjection({ ...after, displayedFarming: null }));
});

test('farming load restores saved quantities and clears the selected crop from the later mature world', () => {
  const saved = plantedState();
  const mature = structuredClone(saved);
  mature.timeLabel = mature.displayedTime = 'day 5 minute 360';
  mature.farming.harvestableOptions = [{ id: 'crop', enabled: true, field_plot_id: 'field' }];
  mature.farming.selectedCropId = 'crop';
  const loaded = structuredClone(saved);
  loaded.operation = { ...saved.operation, sequence: 2, name: 'load', message: '已恢复本地存档', slotId: 'web_probe', worldMinute: 360 };
  loaded.displayedOperation = '已恢复本地存档';
  const valid = farmingClick(mature, loaded);
  assert.doesNotThrow(() => assertFarmingLoadRecovery(saved, valid));
  for (const mutate of [
    (x) => { x.after.farming.selectedCropId = 'crop'; },
    (x) => { x.after.farming.seedOptions[0].quantity.amount = 10; },
    (x) => { x.after.farming.fieldOptions[0].occupied_tiles = 0; },
    (x) => { x.after.displayedOperation = x.after.operation.message = '播种成功'; }
  ]) {
    const invalid = structuredClone(valid); mutate(invalid);
    assert.throws(() => assertFarmingLoadRecovery(saved, invalid));
  }
});

function inventoryState() {
  const state = farmingState();
  const room = { location_id: 'home', storage_type: 'room_temp', container_id: 'room' };
  state.panel = 'inventory';
  state.inventory = {
    lotOptions: [
      { id: 'material', enabled: true, base_id: 'vegetable', current_form: 'fresh', quantity: { amount: 100, unit: 'g' }, storage_ref: { ...room } },
      { id: 'other', enabled: true, base_id: 'seasoning', current_form: 'dry', quantity: { amount: 50, unit: 'g' }, storage_ref: { ...room } }
    ],
    targetOptions: [
      { id: 'room', enabled: true, location_id: 'home', storage_type: 'room_temp', used_capacity: 3, capacity: { amount: 50, unit: 'slot_weight' }, supported_forms: ['fresh','dry'] },
      { id: 'cellar', enabled: true, location_id: 'home', storage_type: 'cellar', used_capacity: 1, capacity: { amount: 20, unit: 'slot_weight' }, supported_forms: ['fresh'] },
      { id: 'jar', enabled: true, location_id: 'home', storage_type: 'pickling_jar', used_capacity: 0, capacity: { amount: 3, unit: 'slot_weight' }, supported_forms: ['pickling'] }
    ],
    selectedLotId: 'material', selectedTargetId: 'cellar', canMove: true
  };
  state.displayedInventory = { lot: '蔬菜批次', form: '鲜品', quantity: '数量：100克', location: '当前位置：常温储存', target: '目标：菜窖', capacity: '目标容量占用：1/20', hint: '可以整批转移' };
  return state;
}

function splitState() {
  const state = inventoryState();
  Object.assign(state.inventory, { splitQuantityText: '30', splitUnit: 'g', splitInputError: null,
    canPreviewSplit: true, canConfirmSplit: false, splitPreview: null, splitResult: null });
  state.displayedSplit = { quantityText: '30', unit: '克', selection: '所选材料100克', preview: '请先预览', result: '尚无拆分结果' };
  state.farming.materialOptions = structuredClone(state.inventory.lotOptions);
  return state;
}

function processingState() {
  const state = inventoryState();
  state.panel = 'processing';
  state.inventory.lotOptions[0] = { ...state.inventory.lotOptions[0], id: 'cabbage', base_id: 'cabbage', category: 'vegetable', quantity: { amount: 1200, unit: 'g' } };
  state.inventory.lotOptions[1] = { ...state.inventory.lotOptions[1], id: 'salt', base_id: 'salt', category: 'seasoning', quantity: { amount: 200, unit: 'g' } };
  state.inventory.selectedLotId = null;
  state.farming.materialOptions = structuredClone(state.inventory.lotOptions);
  const facility_ref = { location_id: 'home', storage_type: 'pickling_jar', container_id: 'jar', definition_id: 'jar_definition', facility_id: 'jar' };
  state.processing = {
    methodOptions: [{ id: 'method', enabled: true, display_name_key: 'processing.method.name', input_requirements: [
      { requirement_index: 0, constraints: { category: 'vegetable', allowed_base_ids: ['cabbage'], allowed_forms: ['fresh'], min_freshness: 45 }, min_quantity: null, lot_ids: ['cabbage'] },
      { requirement_index: 1, constraints: { base_id: 'salt' }, min_quantity: { amount: 8, unit: 'g' }, lot_ids: ['salt'] }
    ], compatible_facility_ids: ['jar'], time_cost_minutes: 20, process_duration_minutes: 2880 }],
    lotOptions: structuredClone(state.inventory.lotOptions), facilityOptions: [{ id: 'jar', enabled: true, compatible_method_ids: ['method'], facility_ref }], taskOptions: [],
    selectedMethodId: 'method', selectedRequirementIndex: 1, inputSelections: [{ requirementIndex: 0, lotId: 'cabbage', quantityText: '300' }, { requirementIndex: 1, lotId: 'salt', quantityText: '15' }],
    selectedFacilityId: 'jar', selectedTaskId: null, currentInputLotOptions: [structuredClone(state.inventory.lotOptions[1])], currentInputQuantityText: '15', currentInputUnit: 'g', inputError: null,
    canPreview: true, canStart: false, canCollect: false, preview: null, startResult: null, collectResult: null
  };
  state.displayedProcessing = { method: '加工方法', facility: '腌菜缸', requirement: '盐，至少8克', lot: '盐200克', quantityText: '15', unit: '克', selection: '白菜300克、盐15克', preview: '请先预览', task: '暂无加工任务', result: '尚无加工结果' };
  return state;
}

function processingReadyState() {
  const state = processingState();
  state.processing.preview = { success: true, statusCode: 'OK' };
  state.processing.canStart = true;
  return state;
}

function processingStartedState() {
  const state = processingReadyState();
  state.inventory.lotOptions[0].quantity.amount = 900;
  state.inventory.lotOptions[1].quantity.amount = 185;
  state.farming.materialOptions = structuredClone(state.inventory.lotOptions);
  state.processing.lotOptions = structuredClone(state.inventory.lotOptions);
  state.processing.currentInputLotOptions = [structuredClone(state.inventory.lotOptions[1])];
  state.processing.taskOptions = [{ id: 'task_new', label_key: 'processing.method.name', enabled: false, reason_key: 'ui.reason.processing_not_ready', method_id: 'method', status: 'active', current_stage: 'fermenting', start_world_minute: 360, expected_finish_minute: 3240,
    facility_ref: structuredClone(state.processing.facilityOptions[0].facility_ref), expected_output: { base_id: 'cabbage', quantity: { amount: 300, unit: 'g' } } }];
  state.processing.startResult = { taskId: 'task_new', methodId: 'method' };
  state.processing.preview = null; state.processing.canStart = false;
  state.displayedProcessing.task = '加工中'; state.displayedProcessing.result = '加工开工成功';
  state.operation = { sequence: 1, name: 'menu_confirm', status: 'completed', message: '加工开工成功', errorMessage: null, slotId: null, worldMinute: null };
  state.displayedOperation = state.operation.message;
  return state;
}

test('processing keyboard and browsing observations reject world mutation, synthetic edits and stale preview', () => {
  const before = processingReadyState();
  const after = structuredClone(before);
  after.processing.inputSelections[1].quantityText = after.processing.currentInputQuantityText = after.displayedProcessing.quantityText = '16';
  after.processing.preview = null; after.processing.canStart = false;
  const valid = farmingClick(before, after); valid.eventCount = 0;
  valid.focused = { className: 'cocosEditBox', value: '16' }; valid.editEvents = { began: 1, changed: 1, ended: 1 };
  valid.layout.inputLabels = { text: { ...valid.layout.button }, placeholder: { ...valid.layout.button } };
  assert.doesNotThrow(() => processingChecks.assertProcessingQuantityObservation(valid, '16'));
  for (const mutate of [
    (x) => { x.eventCount = 1; }, (x) => { x.editEvents.changed = 0; }, (x) => { x.focused.value = '15'; },
    (x) => { x.layout.inputLabels.text.right++; }, (x) => { x.after.processing.preview = { success: true, statusCode: 'OK' }; },
    (x) => { x.after.processing.canStart = true; }, (x) => { x.after.inventory.lotOptions[1].quantity.amount--; },
    (x) => { x.after.operation.sequence++; }, (x) => { x.after.processing.taskOptions.push({ id: 'hidden_task' }); }
  ]) {
    const invalid = structuredClone(valid); mutate(invalid);
    assert.throws(() => processingChecks.assertProcessingQuantityObservation(invalid, '16'));
  }
  const selected = farmingClick(before, structuredClone(before)); selected.after.processing.selectedRequirementIndex = 0;
  selected.after.processing.preview = null; selected.after.processing.canStart = false;
  selected.after.processing.currentInputQuantityText = selected.after.displayedProcessing.quantityText = '300';
  selected.after.processing.currentInputLotOptions = [structuredClone(before.inventory.lotOptions[0])];
  assert.doesNotThrow(() => processingChecks.assertLocalProcessingObservation(selected, { key: 'selectedRequirementIndex', value: 0 }));
  const mutated = structuredClone(selected); mutated.after.processing.taskOptions.push({ id: 'task' });
  assert.throws(() => processingChecks.assertLocalProcessingObservation(mutated, { key: 'selectedRequirementIndex', value: 0 }));
});

test('processing previews require actual business outcome and preserve inventory, tasks, time and capacity', () => {
  for (const statusCode of ['OK', 'ERR_PROCESSING_INPUT_MISSING']) {
    const before = processingState(); const after = structuredClone(before);
    const success = statusCode === 'OK';
    after.processing.preview = { success, statusCode }; after.processing.canStart = success;
    after.operation = { sequence: 1, name: 'menu_preview', status: success ? 'completed' : 'failed', message: success ? '本次校验通过，尚未执行' : '加工所需材料缺失或数量不足', errorMessage: success ? null : statusCode, slotId: null, worldMinute: null };
    after.displayedOperation = after.operation.message;
    const valid = farmingClick(before, after);
    const expected = { statusCode };
    assert.doesNotThrow(() => processingChecks.assertProcessingPreviewObservation(valid, expected));
    for (const mutate of [
      (x) => { x.eventCount = 2; }, (x) => { x.after.processing.preview.statusCode = 'stale'; },
      (x) => { x.after.operation.status = success ? 'failed' : 'completed'; },
      (x) => { x.after.processing.canStart = !success; }, (x) => { x.after.inventory.lotOptions[0].quantity.amount--; },
      (x) => { x.after.processing.taskOptions.push({ id: 'unexpected_task' }); }, (x) => { x.after.inventory.targetOptions[0].used_capacity++; },
      (x) => { x.after.timeLabel = x.after.displayedTime = 'day 1 minute 380'; }
    ]) {
      const invalid = structuredClone(valid); mutate(invalid);
      assert.throws(() => processingChecks.assertProcessingPreviewObservation(invalid, expected));
    }
  }
});

test('processing start requires exact selected consumption, a new active task, real duration and one-use preview', () => {
  const valid = farmingClick(processingReadyState(), processingStartedState());
  assert.doesNotThrow(() => processingChecks.assertProcessingStartObservation(valid));
  for (const mutate of [
    (x) => { x.after.inventory.lotOptions[0].quantity.amount = 1200; }, (x) => { x.after.inventory.lotOptions[1].quantity.amount = 200; },
    (x) => { x.after.processing.taskOptions = []; }, (x) => { x.before.processing.taskOptions = structuredClone(x.after.processing.taskOptions); },
    (x) => { x.after.processing.taskOptions[0].status = 'ready_to_collect'; }, (x) => { x.after.processing.taskOptions[0].expected_finish_minute = 380; },
    (x) => { x.after.processing.taskOptions[0].expected_output.quantity.amount = 301; },
    (x) => { x.after.processing.startResult.taskId = 'wrong_task'; }, (x) => { x.after.processing.canStart = true; },
    (x) => { x.after.processing.preview = { success: true, statusCode: 'OK' }; }, (x) => { x.after.timeLabel = x.after.displayedTime = 'day 1 minute 380'; }
  ]) {
    const invalid = structuredClone(valid); mutate(invalid);
    assert.throws(() => processingChecks.assertProcessingStartObservation(invalid));
  }
});

test('processing active and completed disabled collection emits no event or command and preserves the whole public world', () => {
  for (const taskStatus of ['active', 'completed']) {
    const before = processingStartedState(); before.processing.selectedTaskId = 'task_new'; before.processing.taskOptions[0].status = taskStatus;
    const valid = farmingClick(before, structuredClone(before)); valid.eventCount = 0; valid.layout.buttonInteractable = false;
    assert.doesNotThrow(() => processingChecks.assertProcessingDisabledObservation(valid, 'CollectProcessing'));
    for (const mutate of [
      (x) => { x.eventCount = 1; }, (x) => { x.after.operation.sequence++; }, (x) => { x.layout.buttonInteractable = true; },
      (x) => { x.after.processing.taskOptions[0].status = 'ready_to_collect'; }, (x) => { x.after.inventory.lotOptions[0].quantity.amount++; }
    ]) {
      const invalid = structuredClone(valid); mutate(invalid);
      assert.throws(() => processingChecks.assertProcessingDisabledObservation(invalid, 'CollectProcessing'));
    }
  }
});

function processingCollectedState() {
  const before = processingStartedState(); before.timeLabel = before.displayedTime = 'day 3 minute 360';
  before.processing.selectedTaskId = 'task_new'; before.processing.canCollect = true;
  before.processing.taskOptions[0].status = 'ready_to_collect'; before.processing.taskOptions[0].current_stage = 'ready';
  before.processing.taskOptions[0].enabled = true; before.processing.taskOptions[0].reason_key = null;
  const after = structuredClone(before);
  after.processing.taskOptions[0].status = 'completed'; after.processing.taskOptions[0].enabled = false;
  after.processing.taskOptions[0].reason_key = 'ui.reason.processing_not_ready'; after.processing.canCollect = false;
  const created = { ...structuredClone(before.inventory.lotOptions[0]), id: 'output_new', current_form: 'pickled', quantity: { amount: 300, unit: 'g' }, storage_ref: { location_id: 'home', storage_type: 'cellar', container_id: 'cellar' } };
  after.inventory.lotOptions.push(created); after.farming.materialOptions = structuredClone(after.inventory.lotOptions);
  after.processing.collectResult = { taskId: 'task_new', lotId: 'output_new', quantity: { amount: 300, unit: 'g' } };
  after.operation = { ...before.operation, sequence: before.operation.sequence + 1, message: '加工产物领取成功' }; after.displayedOperation = after.operation.message;
  after.displayedProcessing.result = '加工产物领取成功：300克';
  return farmingClick(before, after);
}

test('processing collection requires a unique real positive output, exact task transition and stable unrelated inventory', () => {
  const valid = processingCollectedState();
  assert.doesNotThrow(() => processingChecks.assertProcessingCollectObservation(valid));
  for (const mutate of [
    (x) => { x.after.inventory.lotOptions.pop(); }, (x) => { x.after.inventory.lotOptions.at(-1).quantity.amount = 0; },
    (x) => { x.after.inventory.lotOptions.at(-1).id = 'cabbage'; x.after.processing.collectResult.lotId = 'cabbage'; },
    (x) => { x.after.inventory.lotOptions.at(-1).quantity.amount = 301; }, (x) => { x.after.processing.collectResult.quantity.amount = 301; },
    (x) => { x.after.processing.taskOptions[0].status = 'ready_to_collect'; }, (x) => { x.before.processing.taskOptions[0].status = 'active'; },
    (x) => { x.after.processing.collectResult.taskId = 'another_task'; }, (x) => { x.after.inventory.lotOptions[1].quantity.amount--; },
    (x) => { x.after.processing.canCollect = true; }, (x) => { x.after.displayedProcessing.result = '领取成功'; }
  ]) {
    const invalid = structuredClone(valid); mutate(invalid);
    assert.throws(() => processingChecks.assertProcessingCollectObservation(invalid));
  }
});

test('processing manual load restores active tasks and exact saved quantities, clears previews and cannot publish old results', () => {
  const saved = processingStartedState();
  const before = processingCollectedState().after;
  const after = structuredClone(saved); after.processing.startResult = null; after.processing.collectResult = null;
  after.operation = { sequence: before.operation.sequence + 1, name: 'load', status: 'completed', message: '已恢复本地存档', errorMessage: null, slotId: 'web_probe', worldMinute: 360 };
  after.displayedOperation = after.operation.message;
  const valid = farmingClick(before, after);
  assert.doesNotThrow(() => processingChecks.assertProcessingLoadRecovery(saved, valid));
  for (const mutate of [
    (x) => { x.after.processing.taskOptions[0].status = 'completed'; }, (x) => { x.after.inventory.lotOptions[0].quantity.amount++; },
    (x) => { x.after.processing.preview = { success: true, statusCode: 'OK' }; }, (x) => { x.after.processing.canStart = true; },
    (x) => { x.after.processing.startResult = { taskId: 'task_new', methodId: 'method' }; },
    (x) => { x.after.processing.collectResult = { taskId: 'task_new', lotId: 'old', quantity: { amount: 300, unit: 'g' } }; }
  ]) {
    const invalid = structuredClone(valid); mutate(invalid);
    assert.throws(() => processingChecks.assertProcessingLoadRecovery(saved, invalid));
  }
});

function splitReadyState(full = false) {
  const state = splitState();
  state.inventory.splitQuantityText = state.displayedSplit.quantityText = full ? '100' : '30';
  state.inventory.splitPreview = { success: true, statusCode: 'OK' };
  state.inventory.canConfirmSplit = true;
  state.displayedSplit.preview = '预览通过';
  return state;
}

function splitCompletedState(full = false) {
  const state = splitReadyState(full);
  const source = structuredClone(state.inventory.lotOptions[0]);
  const amount = full ? 100 : 30;
  if (full) state.inventory.lotOptions.shift();
  else state.inventory.lotOptions[0].quantity.amount = 70;
  state.inventory.lotOptions.push({ ...source, id: 'new_child', quantity: { amount, unit: 'g' } });
  state.inventory.selectedLotId = full ? null : source.id;
  state.inventory.canConfirmSplit = false;
  state.inventory.splitPreview = null;
  state.inventory.splitResult = { sourceLotId: source.id, newLotId: 'new_child', quantity: { amount, unit: 'g' }, remainingQuantity: full ? null : { amount: 70, unit: 'g' } };
  state.displayedInventory.quantity = full ? '数量：—' : '数量：70克';
  state.displayedSplit.result = `新增批次：${amount}克 · ${full ? '来源已全部拆出' : '来源剩余70克'}`;
  state.farming.materialOptions = structuredClone(state.inventory.lotOptions);
  state.operation = { sequence: 1, name: 'menu_confirm', status: 'completed', message: '拆分成功', errorMessage: null, slotId: null, worldMinute: null };
  state.displayedOperation = state.operation.message;
  return state;
}

test('split keyboard observations require real editing events, exact visible text and zero world or command effects', () => {
  const before = splitReadyState();
  const after = splitState(); after.inventory.splitQuantityText = after.displayedSplit.quantityText = '31';
  const valid = { ...farmingClick(before, after), eventCount: 0, focused: { className: 'cocosEditBox', value: '31' }, editEvents: { began: 1, changed: 3, ended: 1 } };
  valid.layout.inputLabels = {
    text: { left: 110, top: 100, right: 290, bottom: 140, width: 180, height: 40 },
    placeholder: { left: 110, top: 100, right: 290, bottom: 140, width: 180, height: 40 }
  };
  assert.doesNotThrow(() => assertSplitQuantityObservation(valid, '31'));
  for (const mutate of [
    (x) => { x.eventCount = 1; },
    (x) => { x.editEvents.began = 0; },
    (x) => { x.editEvents.changed = 0; },
    (x) => { x.editEvents.ended = 0; },
    (x) => { x.focused.className = 'otherInput'; },
    (x) => { x.focused.value = '30'; },
    (x) => { x.after.inventory.splitQuantityText = '30'; },
    (x) => { x.after.displayedSplit.quantityText = '30'; },
    (x) => { x.after.operation.sequence++; },
    (x) => { x.after.inventory.lotOptions[0].quantity.amount--; },
    (x) => { x.after.inventory.splitPreview = { success: true, statusCode: 'OK' }; },
    (x) => { x.after.inventory.canConfirmSplit = true; },
    // The original centered anchors put the Label left/up beyond the EditBox even though text input still worked.
    (x) => { x.layout.inputLabels.text.left -= 100; x.layout.inputLabels.text.right -= 100; },
    (x) => { x.layout.inputLabels.text.top -= 20; x.layout.inputLabels.text.bottom -= 20; },
    (x) => { x.layout.inputLabels.placeholder.left -= 100; x.layout.inputLabels.placeholder.right -= 100; },
    (x) => { x.layout.inputLabels.placeholder.top -= 20; x.layout.inputLabels.placeholder.bottom -= 20; },
    (x) => { delete x.layout.inputLabels.text; },
    (x) => { x.layout.inputLabels.placeholder.left = NaN; }
  ]) {
    const invalid = structuredClone(valid); mutate(invalid);
    assert.throws(() => assertSplitQuantityObservation(invalid, '31'));
  }
});

test('split preview and disabled observations reject stale success, business mutation and unintended commands', () => {
  const after = splitReadyState();
  after.operation = { sequence: 1, name: 'menu_preview', status: 'completed', message: '拆分预览通过', errorMessage: null, slotId: null, worldMinute: null };
  after.displayedOperation = after.operation.message;
  const valid = farmingClick(splitState(), after);
  const expected = { status: 'completed', statusCode: 'OK' };
  assert.doesNotThrow(() => assertSplitPreviewObservation(valid, expected));
  for (const mutate of [
    (x) => { x.after.inventory.lotOptions[0].quantity.amount = 70; x.after.displayedInventory.quantity = '数量：70克'; },
    (x) => { x.after.inventory.targetOptions[0].used_capacity++; },
    (x) => { x.after.operation.name = 'menu_confirm'; },
    (x) => { x.after.operation.worldMinute = 360; },
    (x) => { x.after.operation.slotId = 'web_probe'; },
    (x) => { x.after.inventory.splitPreview.statusCode = 'OLD_RESULT'; },
    (x) => { x.after.inventory.canConfirmSplit = false; },
    (x) => { x.after.inventory.splitResult = { old: true }; }
  ]) {
    const invalid = structuredClone(valid); mutate(invalid);
    assert.throws(() => assertSplitPreviewObservation(invalid, expected));
  }
  const refused = farmingClick(splitState(), splitState());
  refused.after.inventory.splitPreview = { success: false, statusCode: 'ERR_NOT_ENOUGH_RESOURCE' };
  refused.after.operation = { ...after.operation, status: 'failed', message: '资源不足', errorMessage: 'ERR_NOT_ENOUGH_RESOURCE' };
  refused.after.displayedOperation = refused.after.operation.message;
  assert.doesNotThrow(() => assertSplitPreviewObservation(refused, { status: 'failed', statusCode: 'ERR_NOT_ENOUGH_RESOURCE', errorMessage: 'ERR_NOT_ENOUGH_RESOURCE' }));
  const disabled = farmingClick(splitState(), splitState()); disabled.eventCount = 0; disabled.layout.buttonInteractable = false;
  assert.doesNotThrow(() => assertSplitDisabledObservation(disabled, 'SplitConfirm'));
  for (const mutate of [
    (x) => { x.eventCount = 1; },
    (x) => { x.after.operation.sequence++; },
    (x) => { x.before.inventory.canConfirmSplit = true; },
    (x) => { x.layout.buttonInteractable = true; },
    (x) => { x.after.inventory.targetOptions[0].used_capacity--; }
  ]) {
    const invalid = structuredClone(disabled); mutate(invalid);
    assert.throws(() => assertSplitDisabledObservation(invalid, 'SplitConfirm'));
  }
});

test('split success requires exact source/child quantities, stable unrelated lots, unique IDs and exhausted-source removal', () => {
  for (const full of [false, true]) {
    const valid = farmingClick(splitReadyState(full), splitCompletedState(full));
    const amount = full ? 100 : 30;
    assert.doesNotThrow(() => assertSplitConfirmObservation(valid, { amount }));
    for (const mutate of [
      (x) => { x.after.inventory.lotOptions.at(-1).id = 'other'; },
      (x) => { x.after.inventory.splitResult.newLotId = 'missing'; },
      (x) => { x.after.inventory.lotOptions.at(-1).quantity.amount--; },
      (x) => { x.after.inventory.lotOptions.at(-1).quantity.unit = 'ml'; },
      (x) => { x.before.displayedSplit.unit = '毫升'; },
      (x) => { x.after.inventory.lotOptions.at(-1).storage_ref.container_id = 'jar'; },
      (x) => { x.after.inventory.lotOptions.find((lot) => lot.id === 'other').quantity.amount--; },
      (x) => { x.after.inventory.splitResult.quantity.amount--; },
      (x) => { x.after.inventory.canConfirmSplit = true; },
      (x) => { x.before.inventory.canConfirmSplit = false; },
      (x) => { x.after.farming.fieldOptions[0].occupied_tiles++; },
      (x) => { x.after.farming.materialOptions = structuredClone(x.before.farming.materialOptions); },
      (x) => { x.after.displayedSplit.result = '旧结果'; }
    ]) {
      const invalid = structuredClone(valid); mutate(invalid);
      assert.throws(() => assertSplitConfirmObservation(invalid, { amount }));
    }
  }
  const retained = farmingClick(splitReadyState(true), splitCompletedState(true));
  retained.after.inventory.lotOptions.push({ ...retained.before.inventory.lotOptions[0], quantity: { amount: 0, unit: 'g' } });
  assert.throws(() => assertSplitConfirmObservation(retained, { amount: 100 }));
  const staleRemainder = farmingClick(splitReadyState(), splitCompletedState()); staleRemainder.after.inventory.splitResult.remainingQuantity.amount = 69;
  assert.throws(() => assertSplitConfirmObservation(staleRemainder, { amount: 30 }));
});

test('split manual-load observations require saved lots/capacity and invalidate old preview and result', () => {
  const saved = splitCompletedState(); const after = structuredClone(saved);
  after.inventory.splitPreview = null; after.inventory.splitResult = null; after.inventory.canConfirmSplit = false;
  after.operation = { sequence: 4, name: 'load', status: 'completed', message: '已恢复本地存档', errorMessage: null, slotId: 'web_probe', worldMinute: 360 };
  after.displayedOperation = after.operation.message;
  const before = splitReadyState(); before.operation.sequence = 3;
  const valid = farmingClick(before, after);
  assert.doesNotThrow(() => assertSplitLoadRecovery(saved, valid));
  for (const mutate of [
    (x) => { x.after.inventory.lotOptions = structuredClone(x.before.inventory.lotOptions); },
    (x) => { x.after.inventory.targetOptions[0].used_capacity++; },
    (x) => { x.after.inventory.splitPreview = { success: true, statusCode: 'OK' }; },
    (x) => { x.after.inventory.splitResult = saved.inventory.splitResult; },
    (x) => { x.after.inventory.canConfirmSplit = true; },
    (x) => { x.after.inventory.lotOptions.push(structuredClone(x.after.inventory.lotOptions[0])); }
  ]) {
    const invalid = structuredClone(valid); mutate(invalid);
    assert.throws(() => assertSplitLoadRecovery(saved, invalid));
  }
  assert.throws(() => assertSplitProjection({ ...saved, displayedSplit: null }));
});

function movedInventoryState() {
  const state = inventoryState();
  state.inventory.lotOptions[0].storage_ref = { location_id: 'home', storage_type: 'cellar', container_id: 'cellar' };
  state.inventory.targetOptions[0].used_capacity = 2;
  state.inventory.targetOptions[1].used_capacity = 2;
  state.inventory.canMove = false;
  state.displayedInventory.location = '当前位置：菜窖';
  state.displayedInventory.capacity = '目标容量占用：2/20';
  state.displayedInventory.hint = '材料已在这个位置';
  state.operation = { sequence: 1, name: 'menu_confirm', status: 'completed', message: '整批转移成功', errorMessage: null, slotId: null, worldMinute: null };
  state.displayedOperation = state.operation.message;
  return state;
}

test('inventory browsing and panel changes need one event, no command and unchanged public quantities and capacity', () => {
  const before = inventoryState(); before.panel = 'farming'; before.inventory.selectedLotId = null;
  const after = structuredClone(before); after.panel = 'inventory';
  const valid = farmingClick(before, after);
  assert.doesNotThrow(() => assertLocalInventoryObservation(valid, { panel: 'inventory' }));
  for (const mutate of [
    (x) => { x.eventCount = 2; },
    (x) => { x.after.operation.sequence++; },
    (x) => { x.after.inventory.lotOptions[0].quantity.amount--; },
    (x) => { x.after.inventory.targetOptions[0].used_capacity++; },
    (x) => { x.after.farming.seedOptions[0].quantity.amount--; },
    (x) => { x.after.timeLabel = x.after.displayedTime = 'day 1 minute 420'; },
    (x) => { x.after.panel = 'unknown'; },
    (x) => { x.after.inventory.selectedLotId = 'missing'; },
    (x) => { x.after.displayedInventory.hint = ''; }
  ]) {
    const invalid = structuredClone(valid); mutate(invalid);
    assert.throws(() => assertLocalInventoryObservation(invalid, { panel: 'inventory' }));
  }
  const selected = farmingClick(after, inventoryState());
  assert.doesNotThrow(() => assertLocalInventoryObservation(selected, { key: 'selectedLotId', value: 'material' }));
  assert.throws(() => assertLocalInventoryObservation(selected, { key: 'selectedLotId', value: 'other' }));
  for (const mutate of [
    (x) => { x.displayedInventory.quantity = '数量：1100克'; },
    (x) => { x.displayedInventory.quantity = '数量：100毫升'; },
    (x) => { x.displayedInventory.location = '当前位置：菜窖'; },
    (x) => { x.displayedInventory.capacity = '目标容量占用：11/20'; },
    (x) => { x.inventory.targetOptions[0].capacity.unit = 'g'; }
  ]) {
    const invalid = inventoryState(); mutate(invalid);
    assert.throws(() => assertInventoryProjection(invalid));
  }
});

test('whole-batch move observations require exact identity and quantity, destination ref and conserved slot-weight usage', () => {
  const valid = farmingClick(inventoryState(), movedInventoryState());
  const expected = { status: 'completed', timeLabel: valid.before.timeLabel };
  assert.doesNotThrow(() => assertInventoryCommandObservation(valid, expected));
  for (const mutate of [
    (x) => { x.after.inventory.lotOptions[0].quantity.amount = 90; x.after.displayedInventory.quantity = '数量：90克'; },
    (x) => { x.after.inventory.lotOptions[0].quantity.unit = 'ml'; x.after.displayedInventory.quantity = '数量：100毫升'; },
    (x) => { x.after.inventory.lotOptions[0].base_id = 'different'; },
    (x) => { x.after.inventory.lotOptions[0].current_form = 'cut'; },
    (x) => { x.after.inventory.lotOptions[0].storage_ref.container_id = 'room'; },
    (x) => { x.after.inventory.lotOptions[1].quantity.amount--; },
    (x) => { x.after.inventory.targetOptions[0].used_capacity = 3; },
    (x) => { x.after.inventory.targetOptions[1].used_capacity = 3; x.after.displayedInventory.capacity = '目标容量占用：3/20'; },
    (x) => { x.after.inventory.targetOptions[2].used_capacity = 1; },
    (x) => { x.after.inventory.selectedLotId = null; },
    (x) => { x.after.inventory.canMove = true; },
    (x) => { x.after.operation.message = x.after.displayedOperation = '播种成功'; }
  ]) {
    const invalid = structuredClone(valid); mutate(invalid);
    assert.throws(() => assertInventoryCommandObservation(invalid, expected));
  }
});

test('an unsupported-form refusal preserves all public data and does not contaminate the next successful move', () => {
  const before = inventoryState(); before.inventory.selectedTargetId = 'jar';
  before.displayedInventory.target = '目标：腌菜缸'; before.displayedInventory.capacity = '目标容量占用：0/3';
  const after = structuredClone(before);
  after.operation = { sequence: 1, name: 'menu_confirm', status: 'failed', message: '该位置不支持这种物料形态', errorMessage: 'ERR_STORAGE_FORM_NOT_SUPPORTED', slotId: null, worldMinute: null };
  after.displayedOperation = after.operation.message;
  const refused = farmingClick(before, after);
  const expected = { status: 'failed', timeLabel: before.timeLabel, errorMessage: 'ERR_STORAGE_FORM_NOT_SUPPORTED' };
  assert.doesNotThrow(() => assertInventoryCommandObservation(refused, expected));
  for (const mutate of [
    (x) => { x.after.operation.status = 'completed'; },
    (x) => { x.after.inventory.lotOptions[0].quantity.amount--; },
    (x) => { x.after.inventory.targetOptions[0].used_capacity--; },
    (x) => { x.after.farming.seedOptions[0].quantity.amount--; },
    (x) => { x.after.operation.errorMessage = null; }
  ]) {
    const invalid = structuredClone(refused); mutate(invalid);
    assert.throws(() => assertInventoryCommandObservation(invalid, expected));
  }
  const selected = inventoryState(); selected.operation = structuredClone(after.operation); selected.displayedOperation = after.displayedOperation;
  const completed = movedInventoryState(); completed.operation.sequence = 2;
  const recovered = farmingClick(selected, completed);
  assert.doesNotThrow(() => assertInventoryCommandObservation(recovered, { status: 'completed', timeLabel: before.timeLabel }));
});

test('a physical same-container disabled click emits no event or command and must preserve state', () => {
  const state = movedInventoryState();
  const valid = farmingClick(state, structuredClone(state));
  valid.eventCount = 0; valid.layout.buttonInteractable = false;
  assert.doesNotThrow(() => assertDisabledInventoryObservation(valid));
  for (const mutate of [
    (x) => { x.eventCount = 1; },
    (x) => { x.layout.buttonInteractable = true; },
    (x) => { x.after.operation.sequence++; },
    (x) => { x.before.inventory.canMove = true; },
    (x) => { x.after.inventory.lotOptions[0].quantity.amount--; },
    (x) => { x.before.inventory.selectedTargetId = 'room'; x.before.displayedInventory.target = '目标：常温储存'; x.before.displayedInventory.capacity = '目标容量占用：2/50'; }
  ]) {
    const invalid = structuredClone(valid); mutate(invalid);
    assert.throws(() => assertDisabledInventoryObservation(invalid));
  }
});

test('manual inventory load restores the moved location and capacity, retaining valid selection with current data', () => {
  const saved = movedInventoryState();
  const before = inventoryState(); before.operation = { ...saved.operation, sequence: 3 };
  const after = structuredClone(saved);
  after.operation = { sequence: 4, name: 'load', status: 'completed', message: '已恢复本地存档', errorMessage: null, slotId: 'web_probe', worldMinute: 360 };
  after.displayedOperation = after.operation.message;
  const valid = farmingClick(before, after);
  assert.doesNotThrow(() => assertInventoryLoadRecovery(saved, valid));
  for (const mutate of [
    (x) => { x.after.inventory.lotOptions[0].storage_ref = structuredClone(x.before.inventory.lotOptions[0].storage_ref); x.after.displayedInventory.location = '当前位置：常温储存'; },
    (x) => { x.after.inventory.lotOptions[0].quantity.amount = 90; x.after.displayedInventory.quantity = '数量：90克'; },
    (x) => { x.after.inventory.targetOptions[0].used_capacity++; },
    (x) => { x.after.inventory.selectedLotId = null; },
    (x) => { x.after.operation.message = x.after.displayedOperation = '整批转移成功'; },
    (x) => { x.before.inventory = structuredClone(saved.inventory); }
  ]) {
    const invalid = structuredClone(valid); mutate(invalid);
    assert.throws(() => assertInventoryLoadRecovery(saved, invalid));
  }
});

test('empty-slot feedback is a failed load with preserved ready state and cannot leak into the next successful command', () => {
  const time = 'day 1 minute 360';
  const rectangle = { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 };
  const before = { phase: 'ready', hasSession: true, busy: false, timeLabel: time, displayedTime: time, errors: [], operation: { sequence: 0 } };
  const failed = { before, after: { ...before, operation: { sequence: 1, name: 'load', status: 'failed', message: 'Temporary slot is empty', errorMessage: 'ERR_SAVE_SLOT_NOT_FOUND:web_probe', slotId: 'web_probe', worldMinute: null }, displayedOperation: 'Temporary slot is empty' }, eventCount: 1, scrollBefore: { x: 0, y: 0 }, scrollDown: { x: 0, y: 0 }, scrollAfter: { x: 0, y: 0 }, layout: { viewport: { width: 800, height: 600 }, canvas: rectangle, button: { left: 200, top: 200, right: 400, bottom: 300, width: 200, height: 100 } } };
  const expectation = { name: 'load', status: 'failed', timeLabel: time, errorMessage: 'ERR_SAVE_SLOT_NOT_FOUND:web_probe' };
  assert.doesNotThrow(() => assertUiCommandObservation(failed, expectation));
  for (const after of [
    { ...failed.after, phase: 'failed' }, { ...failed.after, hasSession: false },
    { ...failed.after, operation: { ...failed.after.operation, status: 'completed' } },
    { ...failed.after, operation: { ...failed.after.operation, errorMessage: null } },
    { ...failed.after, operation: { ...failed.after.operation, worldMinute: 360 } },
    { ...failed.after, operation: { ...failed.after.operation, message: '启动失败：empty slot' }, displayedOperation: '启动失败：empty slot' },
    { ...failed.after, timeLabel: 'day 1 minute 420', displayedTime: 'day 1 minute 420' }
  ]) assert.throws(() => assertUiCommandObservation({ ...failed, after }, expectation));
  const advanced = { ...failed, before: failed.after, after: { ...failed.after, timeLabel: 'day 1 minute 420', displayedTime: 'day 1 minute 420', operation: { sequence: 2, name: 'menu_confirm', status: 'completed', message: 'Advanced one hour', errorMessage: null, slotId: null, worldMinute: null }, displayedOperation: 'Advanced one hour' } };
  assert.doesNotThrow(() => assertClickObservation(advanced));
  assert.doesNotThrow(() => assertUiCommandObservation(advanced, { name: 'menu_confirm', status: 'completed', timeLabel: 'day 1 minute 420' }));
  assert.throws(() => assertUiCommandObservation({ ...advanced, after: { ...advanced.after, operation: { ...advanced.after.operation, status: 'failed', errorMessage: expectation.errorMessage } } }, { name: 'menu_confirm', status: 'completed', timeLabel: 'day 1 minute 420' }));
});

test('local save recovery rejects changed origin or bytes, automatic startup commands and a no-op manual load', () => {
  const initial = { phase: 'ready', hasSession: true, busy: false, timeLabel: 'day 1 minute 360', displayedTime: 'day 1 minute 360', errors: [], operation: { sequence: 0, status: 'idle' } };
  const stored = { origin: 'http://127.0.0.1:8999', key: 'qinglan.simulation-game.cocos-probe.save.web_probe', raw: '{"saved":"original bytes"}' };
  const rectangle = { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 };
  const loaded = {
    before: initial,
    after: { ...initial, timeLabel: 'day 1 minute 420', displayedTime: 'day 1 minute 420', operation: { sequence: 1, name: 'load', status: 'completed', message: '已恢复本地存档', errorMessage: null, slotId: 'web_probe', worldMinute: 420 }, displayedOperation: '已恢复本地存档' },
    eventCount: 1, scrollBefore: { x: 0, y: 0 }, scrollDown: { x: 0, y: 0 }, scrollAfter: { x: 0, y: 0 },
    layout: { viewport: { width: 800, height: 600 }, canvas: rectangle, button: { left: 200, top: 200, right: 400, bottom: 300, width: 200, height: 100 } }
  };
  const valid = { saved: { ...stored, timeLabel: 'day 1 minute 420' }, initial, afterStartup: stored, loaded, afterLoad: stored };
  assert.doesNotThrow(() => assertLocalSaveRecovery(valid));
  assert.doesNotThrow(() => assertStoredSaveUnchanged({ ...stored, raw: null }, { ...stored, raw: null }));
  for (const change of [
    { saved: { ...valid.saved, raw: null } }, { saved: { ...valid.saved, raw: '' } },
    { afterStartup: { ...stored, origin: 'http://127.0.0.1:9000' } },
    { afterStartup: { ...stored, key: 'new-version-key' } },
    { afterStartup: { ...stored, raw: null } },
    { afterStartup: { ...stored, raw: stored.raw + ' ' } },
    { afterLoad: { ...stored, raw: 'rewritten by load' } },
    { initial: { ...initial, timeLabel: 'day 1 minute 420', displayedTime: 'day 1 minute 420' } },
    { initial: { ...initial, operation: { sequence: 1, status: 'idle' } } },
    { initial: { ...initial, operation: { sequence: 0, status: 'completed' } } },
    { initial: { ...initial, hasSession: false } }, { initial: { ...initial, busy: true } },
    { loaded: { ...loaded, eventCount: 0 } },
    { loaded: { ...loaded, before: { ...initial, operation: { sequence: 9 } }, after: { ...loaded.after, operation: { ...loaded.after.operation, sequence: 10 } } } },
    { loaded: { ...loaded, after: { ...loaded.after, timeLabel: initial.timeLabel, displayedTime: initial.timeLabel } } }
  ]) assert.throws(() => assertLocalSaveRecovery({ ...valid, ...change }));
  assert.throws(() => assertStoredSaveUnchanged(stored, { ...stored, raw: null }));
});

test('variable parse rejection details still require the expected failure boundary and unchanged current time', () => {
  const time = 'day 1 minute 480';
  const before = { phase: 'ready', hasSession: true, busy: false, timeLabel: time, displayedTime: time, errors: [], operation: { sequence: 4 } };
  const prefix = 'ERR_COCOS_SESSION_LOAD_REJECTED:web_probe:';
  const message = prefix + 'browser-specific JSON syntax detail';
  const rectangle = { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 };
  const failed = {
    before, after: { ...before, operation: { sequence: 5, name: 'load', status: 'failed', message: '操作未完成，请重试', errorMessage: message, slotId: 'web_probe', worldMinute: null }, displayedOperation: '操作未完成，请重试' },
    eventCount: 1, scrollBefore: { x: 0, y: 0 }, scrollDown: { x: 0, y: 0 }, scrollAfter: { x: 0, y: 0 },
    layout: { viewport: { width: 800, height: 600 }, canvas: rectangle, button: { left: 200, top: 200, right: 400, bottom: 300, width: 200, height: 100 } }
  };
  const expected = { name: 'load', status: 'failed', timeLabel: time, errorMessagePrefix: prefix };
  assert.doesNotThrow(() => assertUiCommandObservation(failed, expected));
  for (const errorMessage of [null, '', 'unrelated storage failure']) {
    assert.throws(() => assertUiCommandObservation({ ...failed, after: { ...failed.after, operation: { ...failed.after.operation, errorMessage } } }, expected));
  }
  assert.throws(() => assertUiCommandObservation(failed, { ...expected, errorMessagePrefix: '' }));
  assert.throws(() => assertUiCommandObservation(failed, { ...expected, status: 'completed' }));
  assert.throws(() => assertUiCommandObservation({ ...failed, after: { ...failed.after, timeLabel: 'day 1 minute 420', displayedTime: 'day 1 minute 420' } }, expected));
});

test('build provenance rejects changed prepared bytes and unrelated or failed build records', (t) => {
  const f = fixture(t);
  const options = { rootDir: root, project: f.project, buildRecord: f.buildRecord };
  assert.equal(readWebProbeSource(options).manifest.sourceDirty, false);
  for (const change of [{ creatorExitCode: 0 }, { passed: false }, { sourceCommit: 'b'.repeat(40) }, { sourceDirty: true }, { preparedManifestSha256: '0'.repeat(64) }, { creatorVersion: 'other' }]) {
    writeFileSync(f.buildRecord, JSON.stringify({ ...f.built, ...change }));
    assert.throws(() => readWebProbeSource(options), /ERR_WEB_PROBE_BUILD_RECORD_MISMATCH/);
  }
  writeFileSync(f.buildRecord, JSON.stringify(f.built));
  writeFileSync(join(f.project, 'source.txt'), 'modified');
  assert.throws(() => readWebProbeSource(options), /ERR_WEB_PROBE_PREPARED_OUTPUT_CHANGED/);
});

test('real post-build file tampering and missing output digests cannot pass provenance', (t) => {
  const f = fixture(t);
  const options = { rootDir: root, project: f.project, buildRecord: f.buildRecord };
  const oldDigest = readWebProbeSource(options).webBuild.sha256;
  writeFileSync(join(f.project, 'build/web-desktop/index.html'), '<html>changed after Creator build</html>');
  assert.notEqual(webTreeDigest(join(f.project, 'build/web-desktop')).sha256, oldDigest);
  assert.throws(() => readWebProbeSource(options), /ERR_WEB_PROBE_BUILD_CONTENT_CHANGED/);
  writeFileSync(join(f.project, 'build/web-desktop/index.html'), '<html>built bytes</html>');
  const { webBuild, ...legacyRecord } = f.built;
  writeFileSync(f.buildRecord, JSON.stringify(legacyRecord));
  assert.throws(() => readWebProbeSource(options), /ERR_WEB_PROBE_BUILD_CONTENT_CHANGED/);
});

test('only the recorded Creator engine-profile post-image is accepted, never later edits or script changes', (t) => {
  const f = fixture(t);
  const file = 'settings/v2/packages/engine.json';
  mkdirSync(join(f.project, 'settings/v2/packages'), { recursive: true });
  const initial = '{"__version__":"1.0.11","modules":{"includeModules":["ui","2d"]}}';
  const normalized = '{"__version__":"1.0.12","modules":{"includeModules":["2d","ui"]}}';
  f.manifest.outputs[file] = { sha256: sha256(initial) };
  const manifestBytes = JSON.stringify(f.manifest); writeFileSync(join(f.project, 'probe-source-manifest.json'), manifestBytes);
  writeFileSync(join(f.project, file), normalized);
  const surface = capturePreparedSurface(f.project, f.manifest);
  const record = { ...f.built, preparedManifestSha256: sha256(manifestBytes), preparedSurfaceAfter: surface, creatorNormalizations: checkPreparedSurfaceAfterBuild(f.manifest, surface) };
  writeFileSync(f.buildRecord, JSON.stringify(record));
  const options = { rootDir: root, project: f.project, buildRecord: f.buildRecord };
  assert.equal(readWebProbeSource(options).manifest.sourceCommit, f.manifest.sourceCommit);
  assert.deepEqual(record.creatorNormalizations, [{ path: file, reason: 'Creator engine profile normalization', beforeSha256: sha256(initial), afterSha256: sha256(normalized) }]);
  writeFileSync(join(f.project, file), normalized + ' ');
  assert.throws(() => readWebProbeSource(options), /ERR_WEB_PROBE_PREPARED_OUTPUT_CHANGED/);
  writeFileSync(join(f.project, file), normalized);
  writeFileSync(join(f.project, 'source.txt'), 'changed runtime source during build');
  const changed = capturePreparedSurface(f.project, f.manifest);
  assert.throws(() => checkPreparedSurfaceAfterBuild(f.manifest, changed), /ERR_WEB_PROBE_PREPARED_OUTPUT_CHANGED:source.txt/);
});

test('missing browser is a recorded hard failure without silently skipping verification', async (t) => {
  const f = fixture(t);
  const reportDir = join(f.temporary, 'reports');
  await assert.rejects(verifyWebProbe({ project: f.project, browser: join(f.temporary, 'absent-browser'), reportDir, buildRecord: f.buildRecord }), /ERR_WEB_PROBE_FAILED:ERR_WEB_PROBE_BROWSER_MISSING/);
  const directories = readdirSync(reportDir); assert.equal(directories.length, 1);
  const result = JSON.parse(readFileSync(join(reportDir, directories[0], 'result.json')));
  assert.equal(result.passed, false); assert.equal(result.sourceCommit, f.manifest.sourceCommit);
  assert.equal(result.error, 'ERR_WEB_PROBE_BROWSER_MISSING'); assert.equal(result.browserVersion, undefined);
});

test('report paths cannot write into source/project or through a directory link', (t) => {
  const f = fixture(t);
  assert.throws(() => createWebReportDirectory(root, join(root, 'forbidden-probe-report'), f.project), /ERR_WEB_PROBE_REPORT_OVERLAP/);
  assert.throws(() => createWebReportDirectory(root, join(f.project, 'reports'), f.project), /ERR_WEB_PROBE_REPORT_OVERLAP/);
  const actual = join(f.temporary, 'actual'); mkdirSync(actual);
  const alias = join(f.temporary, 'alias'); symlinkSync(actual, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => createWebReportDirectory(root, join(alias, 'reports'), f.project), /ERR_WEB_PROBE_REPORT_LINK/);
  assert.deepEqual(readdirSync(actual), []);
});

test('names beginning with two dots remain children for report and project isolation', (t) => {
  const f = fixture(t);
  const source = join(f.temporary, 'source'); mkdirSync(source);
  const misleadingReport = join(source, '..reports');
  assert.throws(() => createWebReportDirectory(source, misleadingReport, f.project), /ERR_WEB_PROBE_REPORT_OVERLAP/);
  assert.equal(existsSync(misleadingReport), false);
  const misleadingProject = join(source, '..project'); mkdirSync(misleadingProject);
  assert.throws(() => readWebProbeSource({ rootDir: source, project: misleadingProject, buildRecord: f.buildRecord }), /ERR_WEB_PROBE_PROJECT_OVERLAP/);
});

test('real HTTP service serves Web bytes, rejects traversal/links/write methods and closes', async (t) => {
  const f = fixture(t); const web = join(f.temporary, 'web'); mkdirSync(web);
  writeFileSync(join(web, 'index.html'), '<html>actual fixture</html>');
  writeFileSync(join(web, 'runtime.js'), 'export const value=1;');
  const outside = join(f.temporary, 'outside'); mkdirSync(outside); writeFileSync(join(outside, 'secret.txt'), 'do not serve');
  symlinkSync(outside, join(web, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  const server = await serveWebProbe(web);
  const address = new URL(server.url);
  const fetchRaw = (pathname, method = 'GET') => new Promise((accept, reject) => {
    const req = request({ hostname: address.hostname, port: address.port, path: pathname, method }, (res) => {
      let text = ''; res.setEncoding('utf8'); res.on('data', (part) => { text += part; }); res.on('end', () => accept({ status: res.statusCode, text, type: res.headers['content-type'] }));
    }); req.on('error', reject); req.end();
  });
  try {
    assert.equal((await fetchRaw('/')).text, '<html>actual fixture</html>');
    assert.equal((await fetchRaw('/runtime.js')).type, 'text/javascript');
    for (const pathname of ['/../outside/secret.txt', '/%2e%2e/outside/secret.txt', '/linked/secret.txt', '/%5coutside%5csecret.txt', '/%E0%A4%A']) assert.equal((await fetchRaw(pathname)).status, 404, pathname);
    assert.equal((await fetchRaw('/', 'POST')).status, 405);
  } finally { await server.close(); }
  await assert.rejects(fetch(server.url));
  // Tree digest is computed from actual files and fails on links instead of following them.
  assert.throws(() => webTreeDigest(web), /ERR_WEB_PROBE_BUILD_LINK/);
  const clean = join(f.temporary, 'clean-web'); mkdirSync(clean); writeFileSync(join(clean, 'index.html'), 'one');
  const initial = webTreeDigest(clean); writeFileSync(join(clean, 'index.html'), 'two');
  assert.notEqual(webTreeDigest(clean).sha256, initial.sha256);
});

test('built Web retains the 800px resize regression while preview uses its declared desktop window scope', () => {
  assert.deepEqual(resizeViewports(false).map(x => [x.width,x.height]), [[960,640],[1440,1200],[800,600],[960,640]]);
  assert.deepEqual(resizeViewports(true).map(x => [x.width,x.height]), [[960,640],[1440,1200],[960,640]]);
});


function orderState(){
 const state=cookingState();state.panel='orders';
 const dish={id:'dish',enabled:true,serving_count:2,recognized_dish_id:'cabbage',storage_ref:{location_id:'home',storage_type:'room_temp',container_id:'room'}};
 state.cooking.dishOptions=[dish,{...structuredClone(dish),id:'other_dish'}];
 state.orders={orderOptions:[{id:'order',enabled:true,status:'available',quantity_required:{amount:1,unit:'serving'},base_reward:28,minutes_until_deadline:120,demand:{match_threshold:60},result_summary:null,submitted_object_refs:[]}],dishOptions:structuredClone(state.cooking.dishOptions),selectedOrderId:'order',selectedDishId:'dish',money:100,reputation:{west_market_tavern:0},canPreview:true,canSubmit:false,preview:null,result:null};
 state.displayedOrders={order:'订单',state:'状态：可提交',deadline:'剩余120分钟',quantity:'订单量1份·基础奖励28（仅参考）',demand:'硬要求：安全；偏好（非硬门槛）；阈值60',history:'尚无历史',dish:'菜品',detail:'整批2份',money:'当前金钱100',reputation:'声望0',preview:'请先预览',result:'尚无本次结算'};return state;
}
function settledOrderObservation(){
 const before=orderState();before.orders.preview={success:true,statusCode:'OK_DEMAND_ACCEPTED'};before.orders.canSubmit=true;
 const after=structuredClone(before);after.operation={...before.operation,sequence:before.operation.sequence+1,name:'menu_confirm',status:'completed',errorMessage:null,message:'订单结算完成'};after.displayedOperation=after.operation.message;
 Object.assign(after.orders.orderOptions[0],{status:'completed',enabled:false,submitted_object_refs:[{object_type:'DishLot',object_id:'dish'}],result_summary:{match_score:94,reward_final:37,submitted_count:2,result_key:'OK_DEMAND_ACCEPTED'}});
 Object.assign(after.orders,{money:137,reputation:{west_market_tavern:1},selectedDishId:null,canPreview:false,canSubmit:false,preview:null,result:{orderId:'order',dishLotId:'dish',servingCount:2,matchScore:94,rewardMoney:37,moneyAfter:137,reputationDelta:{west_market_tavern:1}}});
 after.orders.dishOptions=after.orders.dishOptions.filter(d=>d.id!=='dish');after.cooking.dishOptions=structuredClone(after.orders.dishOptions);after.inventory.targetOptions[0].used_capacity=1;after.cooking.targetOptions=structuredClone(after.inventory.targetOptions);
 Object.assign(after.displayedOrders,{state:'状态：已完成',money:'当前金钱137',reputation:'声望1',history:'历史奖励37/提交2份',result:'奖励37/匹配94/声望+1/实际提交2份'});
 return farmingClick(before,after);
}
test('order observation checks reject preview side effects, false eligibility and stale confirmation',()=>{
 const before=orderState(),after=structuredClone(before);after.operation={...before.operation,sequence:before.operation.sequence+1,name:'menu_preview',status:'completed',errorMessage:null,message:'校验通过'};after.displayedOperation='校验通过';after.orders.preview={success:true,statusCode:'OK_DEMAND_ACCEPTED'};after.orders.canSubmit=true;
 const valid=farmingClick(before,after);assert.doesNotThrow(()=>processingChecks.assertOrderPreviewObservation(valid));
 for(const mutate of [x=>x.after.orders.money++,x=>x.after.orders.reputation.west_market_tavern++,x=>x.after.orders.orderOptions[0].status='completed',x=>x.after.orders.dishOptions.pop(),x=>x.after.orders.preview.statusCode='STALE',x=>x.eventCount=2]){const bad=structuredClone(valid);mutate(bad);assert.throws(()=>processingChecks.assertOrderPreviewObservation(bad));}
});
test('order local browsing and disabled repeats cannot dispatch or change domain observations',()=>{
 const before=orderState(),after=structuredClone(before);after.orders.selectedDishId='other_dish';const valid=farmingClick(before,after);assert.doesNotThrow(()=>processingChecks.assertLocalOrderObservation(valid,{key:'selectedDishId',value:'other_dish'}));
 for(const mutate of [x=>x.after.operation.sequence++,x=>x.after.orders.money++,x=>x.after.orders.reputation.west_market_tavern++,x=>x.after.inventory.targetOptions[0].used_capacity--]){const bad=structuredClone(valid);mutate(bad);assert.throws(()=>processingChecks.assertLocalOrderObservation(bad,{key:'selectedDishId',value:'other_dish'}));}
 const closed=settledOrderObservation().after;const disabled=farmingClick(closed,structuredClone(closed));disabled.eventCount=0;disabled.layout.buttonInteractable=false;assert.doesNotThrow(()=>processingChecks.assertOrderDisabledObservation(disabled,'SubmitOrder'));
 const bad=structuredClone(disabled);bad.eventCount=1;assert.throws(()=>processingChecks.assertOrderDisabledObservation(bad,'SubmitOrder'));
});
test('order confirmation rejects false reward or reputation, wrong objects, old results and unrelated consumption',()=>{
 const valid=settledOrderObservation(),expected={rewardMoney:37,reputationDelta:{west_market_tavern:1}};assert.doesNotThrow(()=>processingChecks.assertOrderConfirmObservation(valid,expected));
 for(const mutate of [x=>x.after.orders.money=999,x=>x.after.orders.reputation.west_market_tavern=999,x=>x.after.orders.result.reputationDelta.west_market_tavern=999,x=>x.after.orders.result.orderId='wrong',x=>x.after.orders.result.dishLotId='other_dish',x=>x.after.orders.orderOptions[0].status='available',x=>x.after.orders.dishOptions=[],x=>x.before.orders.orderOptions[0].minutes_until_deadline=-1,x=>x.before.orders.orderOptions[0].status='completed',x=>x.after.displayedOrders.result='奖励28/提交2份',x=>x.after.inventory.targetOptions[0].used_capacity=3]){const bad=structuredClone(valid);mutate(bad);assert.throws(()=>processingChecks.assertOrderConfirmObservation(bad,expected));}
});
test('order load recovery and serialized settlement reject stale success, wrong state and lingering storage refs',()=>{
 const saved=settledOrderObservation().after,before=structuredClone(saved),after=structuredClone(saved);before.orders.money=999;after.orders.result=null;after.operation={...saved.operation,sequence:saved.operation.sequence+1,name:'load',status:'completed',message:'已恢复本地存档',slotId:'web_probe',worldMinute:360};after.displayedOperation=after.operation.message;
 const valid=farmingClick(before,after);assert.doesNotThrow(()=>processingChecks.assertOrderLoadRecovery(saved,valid));
 for(const mutate of [x=>x.after.orders.result=saved.orders.result,x=>x.after.orders.money++,x=>x.after.orders.orderOptions[0].status='available']){const bad=structuredClone(valid);mutate(bad);assert.throws(()=>processingChecks.assertOrderLoadRecovery(saved,bad));}
 const rawBefore={dish_lots:[{dish_lot_id:'dish',storage_ref:{container_id:'room'},storage_footprint:{amount:2}},{dish_lot_id:'other'}],storage_containers:[{container_id:'room',used_capacity:4,active_object_refs:[{object_type:'DishLot',object_id:'dish'}]}],orders:[{order_id:'order',status:'available'}],player_state:{money:100}};
 const rawAfter={dish_lots:[{dish_lot_id:'other'}],storage_containers:[{container_id:'room',used_capacity:2,active_object_refs:[]}],orders:[{order_id:'order',status:'completed'}],player_state:{money:137}};const selected={dishLotId:'dish',orderId:'order',rewardMoney:37};
 assert.doesNotThrow(()=>processingChecks.assertOrderSerializedSettlement(JSON.stringify(rawBefore),JSON.stringify(rawAfter),selected));
 for(const mutate of [x=>x.storage_containers[0].active_object_refs=rawBefore.storage_containers[0].active_object_refs,x=>x.storage_containers[0].active_object_refs.push({object_type:'MaterialLot',object_id:'foreign'}),x=>x.storage_containers.push({container_id:'foreign',used_capacity:0,active_object_refs:[]})]){const bad=structuredClone(rawAfter);mutate(bad);assert.throws(()=>processingChecks.assertOrderSerializedSettlement(JSON.stringify(rawBefore),JSON.stringify(bad),selected));}
});


test('order visible state cannot claim available after actual completion or invert signed expiry feedback',()=>{
 const settled=settledOrderObservation();settled.after.displayedOrders.state='状态：可提交';
 assert.throws(()=>processingChecks.assertOrderConfirmObservation(settled,{rewardMoney:37,reputationDelta:{west_market_tavern:1}}));
 const expired=orderState();Object.assign(expired.orders.orderOptions[0],{status:'expired',enabled:false,minutes_until_deadline:-1});Object.assign(expired.orders,{canPreview:false});
 Object.assign(expired.displayedOrders,{state:'状态：已超时',deadline:'已超时1分钟'});assert.doesNotThrow(()=>processingChecks.assertOrdersProjection(expired));
 for(const mutate of [x=>x.displayedOrders.state='状态：可提交',x=>x.displayedOrders.deadline='剩余1分钟']){const bad=structuredClone(expired);mutate(bad);assert.throws(()=>processingChecks.assertOrdersProjection(bad));}
 const available=orderState();available.displayedOrders.state='状态：可提交';available.displayedOrders.deadline='已超时120分钟';assert.throws(()=>processingChecks.assertOrdersProjection(available));
});


test('visible order settlement must show the actual match score and reputation delta',()=>{
 const expected={rewardMoney:37,reputationDelta:{west_market_tavern:1}};
 for(const label of ['奖励37/匹配999/声望+1/实际提交2份','奖励37/匹配94/声望+999/实际提交2份','奖励37/匹配94/实际提交2份']){const bad=settledOrderObservation();bad.after.displayedOrders.result=label;assert.throws(()=>processingChecks.assertOrderConfirmObservation(bad,expected));}
});

function crossStepState() {
  const state = orderState();
  state.processing = structuredClone(processingStartedState().processing);
  Object.assign(state.inventory, { splitPreview: null, splitResult: null, canConfirmSplit: false });
  return state;
}

function clearCrossStepLocals(state) {
  for (const [section, keys] of Object.entries({
    farming: ['selectedFieldId','selectedSeedId','selectedCropId'], inventory: ['selectedLotId','selectedTargetId','splitPreview','splitResult'],
    processing: ['selectedMethodId','selectedRequirementIndex','selectedFacilityId','selectedTaskId','preview','startResult','collectResult'],
    cooking: ['selectedRecipeId','selectedRole','selectedTargetId','heatLevel','preview','result'], orders: ['selectedOrderId','selectedDishId','preview','result']
  })) for (const key of keys) state[section][key] = null;
  state.processing.inputSelections=[]; state.cooking.inputSelections=[];
  for (const [section, keys] of Object.entries({farming:['canPlant','canHarvest'],inventory:['canMove','canConfirmSplit'],processing:['canPreview','canStart','canCollect'],cooking:['canPreview','canCook'],orders:['canPreview','canSubmit']}))
    for (const key of keys) state[section][key]=false;
  return state;
}

function crossStepFreshEvidence() {
  const savedState=crossStepState();
  savedState.timeLabel=savedState.displayedTime='day 5 minute 360';
  const initial=clearCrossStepLocals(crossStepState());
  initial.operation={sequence:0,name:null,status:'idle'};
  const after=clearCrossStepLocals(structuredClone(savedState));
  after.operation={sequence:1,name:'load',status:'completed',message:'已恢复本地存档',errorMessage:null,slotId:'web_probe',worldMinute:6120};
  after.displayedOperation=after.operation.message;
  const saved={origin:'http://127.0.0.1:1234',key:'qinglan.simulation-game.cocos-probe.save.web_probe',raw:'{"saved":"complete"}',timeLabel:savedState.timeLabel};
  return {savedState,saved,initial,afterStartup:{...saved},loaded:farmingClick(initial,after),afterLoad:{...saved},documentFresh:true};
}

test('cross-step fresh recovery rejects missing world entities and stale local success across every panel',()=>{
  const valid=crossStepFreshEvidence();
  assert.doesNotThrow(()=>processingChecks.assertCrossStepFreshRecovery(valid));
  for(const mutate of [
    x=>x.loaded.after.inventory.lotOptions[0].quantity.amount--,
    x=>x.loaded.after.processing.taskOptions=[], x=>x.loaded.after.orders.money++,
    x=>x.loaded.after.orders.orderOptions[0].status='completed',x=>x.loaded.after.cooking.dishOptions=[],
    x=>x.loaded.after.processing.preview={success:true,statusCode:'OK'},
    x=>x.loaded.after.orders.result={rewardMoney:37},x=>x.loaded.after.inventory.selectedLotId='material',
    x=>x.documentFresh=false,x=>x.initial.operation.sequence=1
  ]) { const bad=structuredClone(valid);mutate(bad);assert.throws(()=>processingChecks.assertCrossStepFreshRecovery(bad)); }
});

test('cross-step failure protection rejects healthy-world replacement and requires the current failed operation',()=>{
  const before=crossStepState(),after=clearCrossStepLocals(structuredClone(before));
  after.operation={sequence:before.operation.sequence+1,name:'load',status:'failed',message:'操作未完成，请重试',errorMessage:'controlled-read',slotId:'web_probe',worldMinute:null};
  after.displayedOperation=after.operation.message;
  const valid=farmingClick(before,after),expected={name:'load',status:'failed',timeLabel:before.timeLabel,errorMessage:'controlled-read'};
  assert.doesNotThrow(()=>processingChecks.assertCrossStepFailureObservation(valid,expected));
  for(const mutate of [x=>x.after.inventory.lotOptions=[],x=>x.after.processing.taskOptions=[],x=>x.after.orders.money=0,x=>x.after.orders.orderOptions=[],x=>x.after.operation.status='completed']){
    const bad=structuredClone(valid);mutate(bad);assert.throws(()=>processingChecks.assertCrossStepFailureObservation(bad,expected));
  }
});

function recoveryRaw(state=crossStepState()) {
  return {
    world_time:{absolute_minute:timeInMinutes(state.timeLabel)-1440},player_state:{money:state.orders.money},story_flags:{historical_id:'retired_lot_000099'},
    inventory:state.inventory.lotOptions.map(item=>({...structuredClone(item),lot_id:item.id})),
    processing_tasks:state.processing.taskOptions.map(item=>({...structuredClone(item),task_id:item.id})),
    dish_lots:state.cooking.dishOptions.map(item=>({...structuredClone(item),dish_lot_id:item.id})),
    orders:state.orders.orderOptions.map(item=>({...structuredClone(item),order_id:item.id})),reservations:[],
    fields:[{field_plot_id:'field',occupied_tiles:1,active_crop_ids:['crop_original']}],
    crop_instances:[{crop_id:'crop_original',lifecycle_status:'active'}],
    storage_containers:state.inventory.targetOptions.map(item=>({...structuredClone(item),container_id:item.id}))
  };
}
const recoveryStored = raw => ({origin:'http://127.0.0.1:1234',key:'qinglan.simulation-game.cocos-probe.save.web_probe',raw:JSON.stringify(raw)});

test('cross-step complete serialization rejects partial saves, different bytes and duplicate entity identities',()=>{
  const valid=recoveryStored(recoveryRaw());
  assert.doesNotThrow(()=>processingChecks.assertCrossStepSerialization(valid,{...valid}));
  for(const mutate of [x=>x.raw=JSON.stringify({world_time:{absolute_minute:360}}),x=>x.key='another-slot',x=>x.origin='http://127.0.0.1:99']) {
    const bad=structuredClone(valid);mutate(bad);assert.throws(()=>processingChecks.assertCrossStepSerialization(valid,bad));
  }
  for(const mutate of [x=>delete x.crop_instances,x=>x.inventory.push(structuredClone(x.inventory[0])),x=>x.crop_instances[0].crop_id=x.inventory[0].lot_id,x=>delete x.player_state]){
    const raw=recoveryRaw();mutate(raw);const bad=recoveryStored(raw);assert.throws(()=>processingChecks.assertCrossStepSerialization(bad,{...bad}));
  }
});

test('cross-step checkpoint evidence requires the actual saved phase and matching complete public entities',()=>{
  const states={growing:crossStepState(),processing:crossStepState(),ready:crossStepState(),dish:crossStepState(),completed:crossStepState()};
  states.growing.farming.fieldOptions[0].occupied_tiles=1;
  states.ready.processing.taskOptions[0].status='ready_to_collect';
  states.completed.orders=structuredClone(settledOrderObservation().after.orders);states.completed.orders.result=null;
  states.completed.cooking.dishOptions=structuredClone(states.completed.orders.dishOptions);
  for(const [point,state] of Object.entries(states)){
    const raw=recoveryRaw(state),stored=recoveryStored(raw);
    assert.doesNotThrow(()=>processingChecks.assertCrossStepCheckpoint(point,state,stored),point);
    const changed=structuredClone(raw);changed.player_state.money++;
    assert.throws(()=>processingChecks.assertCrossStepCheckpoint(point,state,recoveryStored(changed)),point+' must match real saved economy');
  }
  for(const [point,mutate] of [
    ['growing',x=>x.crop_instances=[]],['processing',x=>x.processing_tasks[0].status='completed'],
    ['ready',x=>x.processing_tasks[0].status='active'],['dish',x=>x.dish_lots=[]],['completed',x=>x.orders[0].status='available']
  ]) {const state=states[point],raw=recoveryRaw(state);mutate(raw);assert.throws(()=>processingChecks.assertCrossStepCheckpoint(point,state,recoveryStored(raw)));}
});

test('cross-step new identities cannot reuse saved history or overwrite entities after recovery',()=>{
  const raw=recoveryRaw(),saved=recoveryStored(raw),after=structuredClone(raw);
  after.crop_instances.push({crop_id:'crop_new',lifecycle_status:'active'});
  after.inventory.push({...structuredClone(raw.inventory[0]),lot_id:'material_new'});
  const created=[{kind:'MaterialLot',id:'material_new'}];
  assert.doesNotThrow(()=>processingChecks.assertCrossStepObservedIds(saved,created));
  assert.throws(()=>processingChecks.assertCrossStepObservedIds(saved,[{kind:'MaterialLot',id:'retired_lot_000099'}]));
  assert.doesNotThrow(()=>processingChecks.assertCrossStepCreatedIds(saved,recoveryStored(after),created));
  for(const identity of ['retired_lot_000099',raw.inventory[0].lot_id]) {
    const bad=structuredClone(after);bad.inventory.at(-1).lot_id=identity;
    assert.throws(()=>processingChecks.assertCrossStepCreatedIds(saved,recoveryStored(bad),[{kind:'MaterialLot',id:identity}]));
  }
  assert.throws(()=>processingChecks.assertCrossStepCreatedIds(saved,saved,[]));
});

function completedContinuationEvidence() {
  const saved=splitState();saved.processing=structuredClone(processingState().processing);saved.cooking=structuredClone(cookingState().cooking);
  saved.orders=structuredClone(settledOrderObservation().after.orders);saved.orders.result=null;
  const before=structuredClone(saved),after=structuredClone(saved),planted=plantedState();
  for(const key of ['fieldOptions','seedOptions','selectedFieldId','canPlant'])after.farming[key]=structuredClone(planted.farming[key]);
  after.operation=structuredClone(planted.operation);after.displayedOperation=after.operation.message;
  const plant=farmingClick(before,after);plant.buttonName='PlantCrop';
  const splitBefore=structuredClone(after),splitAfter=structuredClone(after),ready=splitReadyState(),done=splitCompletedState();
  splitBefore.panel=splitAfter.panel='inventory';splitBefore.inventory=structuredClone(ready.inventory);splitAfter.inventory=structuredClone(done.inventory);
  splitBefore.displayedSplit=structuredClone(ready.displayedSplit);splitAfter.displayedSplit=structuredClone(done.displayedSplit);splitAfter.displayedInventory=structuredClone(done.displayedInventory);
  splitAfter.farming.materialOptions=structuredClone(done.farming.materialOptions);
  splitAfter.operation={...done.operation,sequence:splitBefore.operation.sequence+1};splitAfter.displayedOperation=splitAfter.operation.message;
  const split=farmingClick(splitBefore,splitAfter);split.buttonName='SplitConfirm';
  return{saved,actions:[{actionType:'plant_crop',observation:plant},{actionType:'split_lot',observation:split}],finalState:splitAfter};
}

test('cross-step continuation requires actual player actions, creation and unchanged completed-order rewards',()=>{
  const valid=completedContinuationEvidence();
  assert.doesNotThrow(()=>processingChecks.assertCrossStepContinuation('completed',valid.saved,valid.actions,valid.finalState));
  for(const mutate of [
    x=>x.actions=[],x=>x.actions[0].actionType='submit_order',x=>x.actions[0].observation.eventCount=0,
    x=>x.actions[0].observation.after.farming.seedOptions[0].quantity.amount++,
    x=>{x.actions.at(-1).observation.after.inventory.splitResult.newLotId='material';},
    x=>{x.finalState.orders.money++;},x=>{x.actions.at(-1).observation.after.orders.money++;x.finalState.orders.money++;},
    x=>{x.actions.at(-1).observation.after.orders.reputation.west_market_tavern++;x.finalState.orders.reputation.west_market_tavern++;}
  ]){const bad=structuredClone(valid);mutate(bad);assert.throws(()=>processingChecks.assertCrossStepContinuation('completed',bad.saved,bad.actions,bad.finalState));}
  assert.throws(()=>processingChecks.assertCrossStepContinuation('growing',valid.saved,valid.actions,valid.finalState));
});


test('cross-step action records exclude verified disabled repeats but reject actual failed or duplicate dispatches',()=>{
  const {actions}=completedContinuationEvidence(),plant=actions[0].observation;
  const completed=settledOrderObservation().after;completed.processing=structuredClone(processingState().processing);
  const disabled=farmingClick(completed,structuredClone(completed));disabled.buttonName='SubmitOrder';disabled.eventCount=0;disabled.layout.buttonInteractable=false;
  assert.equal(processingChecks.crossStepActionObservations([plant,disabled]).length,1);
  for(const mutate of [x=>x.eventCount=2,x=>x.after.operation.status='failed',x=>x.after.operation.sequence=x.before.operation.sequence,x=>x.after.operation.name='load']){
    const bad=structuredClone(plant);mutate(bad);assert.throws(()=>processingChecks.crossStepActionObservations([bad]));
  }
  for(const mutate of [x=>x.layout.buttonInteractable=true,x=>x.after.orders.money++,x=>x.after.operation.sequence++]){
    const bad=structuredClone(disabled);mutate(bad);assert.throws(()=>processingChecks.crossStepActionObservations([bad]));
  }
});


test('cross-step created identities must really survive as saved entities or retained historical references',()=>{
  const saved=recoveryStored(recoveryRaw()),after=JSON.parse(saved.raw);
  after.crop_instances.push({crop_id:'crop_new',lifecycle_status:'active'});
  assert.throws(()=>processingChecks.assertCrossStepCreatedIds(saved,recoveryStored(after),[{kind:'MaterialLot',id:'phantom_lot'}]));
  after.processing_tasks[0].input_lot_refs=[{lot_id:'consumed_split'}];
  after.orders[0].submitted_object_refs=[{object_type:'DishLot',object_id:'consumed_dish'}];
  assert.doesNotThrow(()=>processingChecks.assertCrossStepCreatedIds(saved,recoveryStored(after),[{kind:'MaterialLot',id:'consumed_split'},{kind:'DishLot',id:'consumed_dish'}]));
  const missing=structuredClone(after);missing.orders[0].submitted_object_refs=[];
  assert.throws(()=>processingChecks.assertCrossStepCreatedIds(saved,recoveryStored(missing),[{kind:'DishLot',id:'consumed_dish'}]));
});
