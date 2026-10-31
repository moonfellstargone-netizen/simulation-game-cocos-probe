import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { assertClickObservation, assertFarmingCommandObservation, assertFarmingLoadRecovery, assertFarmingProjection, assertLocalSaveRecovery, assertLocalSelectionObservation, assertStoredSaveUnchanged, assertUiCommandObservation, capturePreparedSurface, checkPreparedSurfaceAfterBuild, createWebReportDirectory, parseWebProbeArgs, readWebProbeSource, resizeViewports, serveWebProbe, sha256, timeInMinutes, webTreeDigest, within } from '../tools/cocos-probe/lib/webProbeSupport.mjs';
import { verifyWebProbe } from '../tools/cocos-probe/verify-web.mjs';

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
