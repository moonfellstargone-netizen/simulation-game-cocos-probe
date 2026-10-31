import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createReadStream, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const within = (parent, child) => {
  const rel = relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel));
};

export function parseWebProbeArgs(args) {
  const names = { '--project': 'project', '--browser': 'browser', '--report-dir': 'reportDir', '--build-record': 'buildRecord', '--preview-url': 'previewUrl' };
  const result = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = names[args[i]];
    if (!key || !args[i + 1] || Object.hasOwn(result, key)) throw new Error('ERR_WEB_PROBE_ARGUMENTS');
    result[key] = args[i + 1];
  }
  for (const key of ['project', 'browser', 'reportDir', 'buildRecord']) {
    if (!isAbsolute(result[key] ?? '')) throw new Error('ERR_WEB_PROBE_ABSOLUTE_REQUIRED:' + key);
  }
  if (result.previewUrl) {
    const url = new URL(result.previewUrl);
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password) {
      throw new Error('ERR_WEB_PROBE_PREVIEW_LOOPBACK_REQUIRED');
    }
  }
  return result;
}

export function createWebReportDirectory(rootDir, reportDir, projectDir) {
  if (!isAbsolute(reportDir)) throw new Error('ERR_WEB_PROBE_REPORT_ABSOLUTE_REQUIRED');
  let ancestor = resolve(reportDir);
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  for (let current = ancestor; ; current = dirname(current)) {
    if (lstatSync(current).isSymbolicLink()) throw new Error('ERR_WEB_PROBE_REPORT_LINK');
    if (dirname(current) === current) break;
  }
  const canonical = resolve(realpathSync(ancestor), relative(ancestor, resolve(reportDir)));
  if (within(rootDir, canonical) || within(projectDir, canonical)) throw new Error('ERR_WEB_PROBE_REPORT_OVERLAP');
  mkdirSync(canonical, { recursive: true });
  return mkdtempSync(join(canonical, 'web-probe-'));
}

export function readWebProbeSource({ rootDir, project, buildRecord }) {
  const projectDir = realpathSync(project);
  if (within(rootDir, projectDir) || within(projectDir, rootDir)) throw new Error('ERR_WEB_PROBE_PROJECT_OVERLAP');
  const bytes = readFileSync(join(projectDir, 'probe-source-manifest.json'));
  const manifest = JSON.parse(bytes);
  if (manifest.format !== 'cocos-probe-source/v1' || !/^[a-f\d]{40}$/i.test(manifest.sourceCommit) || typeof manifest.sourceDirty !== 'boolean') {
    throw new Error('ERR_WEB_PROBE_SOURCE_MANIFEST');
  }
  if (!manifest.outputs || typeof manifest.outputs !== 'object') throw new Error('ERR_WEB_PROBE_SOURCE_OUTPUTS');
  const buildBytes = readFileSync(buildRecord);
  const built = JSON.parse(buildBytes);
  if (!built.passed || built.creatorExitCode !== 36 || built.preparedManifestSha256 !== sha256(bytes)
      || realpathSync(built.projectDir) !== projectDir || built.sourceCommit !== manifest.sourceCommit
      || built.sourceDirty !== manifest.sourceDirty || built.creatorVersion !== manifest.creatorVersion) {
    throw new Error('ERR_WEB_PROBE_BUILD_RECORD_MISMATCH');
  }
  const preparedSurfaceAfter = capturePreparedSurface(projectDir, manifest);
  const creatorNormalizations = checkPreparedSurfaceAfterBuild(manifest, preparedSurfaceAfter);
  if (JSON.stringify(built.preparedSurfaceAfter) !== JSON.stringify(preparedSurfaceAfter)
      || JSON.stringify(built.creatorNormalizations) !== JSON.stringify(creatorNormalizations)) {
    throw new Error('ERR_WEB_PROBE_PREPARED_OUTPUT_CHANGED:post-build-surface');
  }
  const webBuild = webTreeDigest(join(projectDir, 'build/web-desktop'));
  if (JSON.stringify(built.webBuild) !== JSON.stringify(webBuild)) throw new Error('ERR_WEB_PROBE_BUILD_CONTENT_CHANGED');
  return { projectDir, manifest, webBuild, preparedManifestSha256: sha256(bytes), buildRecordSha256: sha256(buildBytes), creatorVersion: built.creatorVersion };
}

export function capturePreparedSurface(projectDir, manifest) {
  return Object.fromEntries(Object.keys(manifest.outputs).map((file) => {
    const target = resolve(projectDir, file);
    if (!within(projectDir, target) || !within(projectDir, realpathSync(target))) throw new Error('ERR_WEB_PROBE_PREPARED_OUTPUT_CHANGED:' + file);
    const bytes = readFileSync(target);
    return [file, { bytes: bytes.length, sha256: sha256(bytes) }];
  }));
}

export function checkPreparedSurfaceAfterBuild(manifest, actual) {
  const normalizations = [];
  for (const [file, expected] of Object.entries(manifest.outputs)) {
    if (actual[file]?.sha256 === expected.sha256) continue;
    // Creator 3.8.8 migrates its own engine profile v1.0.11 -> v1.0.12 and sorts module entries.
    // This allowance is limited to the trusted build interval; verification still requires its exact recorded post-image.
    if (file !== 'settings/v2/packages/engine.json' || !actual[file]) throw new Error('ERR_WEB_PROBE_PREPARED_OUTPUT_CHANGED:' + file);
    normalizations.push({ path: file, reason: 'Creator engine profile normalization', beforeSha256: expected.sha256, afterSha256: actual[file].sha256 });
  }
  return normalizations;
}

export function webTreeDigest(directory) {
  const root = realpathSync(directory);
  const files = {};
  function visit(dir, prefix = '') {
    for (const item of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const file = join(dir, item.name);
      if (item.isSymbolicLink()) throw new Error('ERR_WEB_PROBE_BUILD_LINK');
      const name = prefix + item.name;
      if (item.isDirectory()) visit(file, name + '/');
      else if (item.isFile()) { const bytes = readFileSync(file); files[name] = { bytes: bytes.length, sha256: sha256(bytes) }; }
    }
  }
  visit(root);
  if (!files['index.html']) throw new Error('ERR_WEB_PROBE_BUILD_INDEX_MISSING');
  return { sha256: sha256(JSON.stringify(files)), fileCount: Object.keys(files).length, files };
}

export async function serveWebProbe(directory, { port = 0 } = {}) {
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error('ERR_WEB_PROBE_PORT_INVALID');
  const root = realpathSync(directory);
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
  const server = createServer((request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405); response.end(); return; }
    try {
      let pathname = decodeURIComponent((request.url ?? '/').split('?')[0]);
      if (pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
      if (pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').includes('..')) throw new Error('path');
      if (pathname.endsWith('/')) pathname += 'index.html';
      const file = resolve(root, '.' + pathname);
      if (!within(root, file) || !within(root, realpathSync(file)) || !statSync(file).isFile()) throw new Error('path');
      response.setHeader('Content-Type', mime[extname(file)] ?? 'application/octet-stream');
      response.setHeader('Cache-Control', 'no-store');
      if (request.method === 'HEAD') response.end();
      else { const stream = createReadStream(file); stream.on('error', () => response.destroy()); stream.pipe(response); }
    } catch { response.writeHead(404); response.end('not found'); }
  });
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', accept); });
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise((accept, reject) => server.close((error) => error ? reject(error) : accept())) };
}

// Preview's default 960x640 device simulator is scoped to the two supported editor window sizes.
// The deployed Web build retains the full small-window resize matrix.
export function resizeViewports(previewMode = false) {
  return previewMode
    ? [{ width: 960, height: 640 }, { width: 1440, height: 1200 }, { width: 960, height: 640 }]
    : [{ width: 960, height: 640 }, { width: 1440, height: 1200 }, { width: 800, height: 600 }, { width: 960, height: 640 }];
}

export function timeInMinutes(label) {
  const match = /^day (\d+) minute (\d+)$/.exec(label ?? '');
  if (!match || Number(match[2]) >= 1440) throw new Error('ERR_WEB_PROBE_TIME_LABEL:' + label);
  return Number(match[1]) * 1440 + Number(match[2]);
}

function assertInputObservation(observation) {
  const { before, after, eventCount, scrollBefore, scrollDown, scrollAfter, layout } = observation;
  assert.equal(before.phase, 'ready', 'input must begin in a ready session');
  assert.equal(after.phase, 'ready', 'session must remain ready');
  assert.equal(after.hasSession, true, 'session must remain alive');
  assert.equal(eventCount, 1, 'one physical click must emit exactly one Cocos Button event');
  assert.equal(after.displayedTime, after.timeLabel, 'Label must match public state');
  assert.deepEqual(scrollDown, scrollBefore, 'mouse down must not scroll the page');
  assert.deepEqual(scrollAfter, scrollBefore, 'mouse up must not scroll the page');
  for (const [name, rectangle] of Object.entries({ canvas: layout.canvas, button: layout.button })) {
    assert.ok(rectangle.left >= -1 && rectangle.top >= -1 && rectangle.right <= layout.viewport.width + 1
      && rectangle.bottom <= layout.viewport.height + 1 && rectangle.width > 0 && rectangle.height > 0, name + ' must fit inside the viewport');
  }
  assert.deepEqual(after.errors, [], 'probe must not report a runtime error');
}

export function assertClickObservation(observation) {
  assertInputObservation(observation);
  assert.equal(timeInMinutes(observation.after.timeLabel) - timeInMinutes(observation.before.timeLabel), 60, 'one physical click must advance exactly 60 minutes');
}

// These checks consume observations only; they never execute a game command or repair the page.
export function assertUiCommandObservation(observation, expected) {
  assertInputObservation(observation);
  const { before, after } = observation;
  assert.equal(before.busy, false, 'physical input must begin when the UI is idle');
  assert.equal(after.busy, false, 'command must settle before its result is assessed');
  assert.ok(Number.isSafeInteger(before.operation?.sequence), 'UI must expose a command sequence');
  assert.equal(after.operation?.sequence, before.operation.sequence + 1, 'one physical click must submit exactly one UI command');
  assert.equal(after.operation.name, expected.name, 'result must belong to the clicked command');
  assert.equal(after.operation.status, expected.status, 'current command must report its actual outcome');
  assert.equal(after.timeLabel, expected.timeLabel, 'command must produce exactly the expected time');
  assert.ok(typeof after.operation.message === 'string' && after.operation.message.trim(), 'operation must have visible feedback');
  assert.equal(after.displayedOperation, after.operation.message, 'operation Label must match the current result');
  assert.ok(!after.displayedOperation.startsWith('启动失败'), 'an operation failure must not be presented as a startup failure');
  assert.equal(after.operation.slotId, expected.name === 'menu_confirm' ? null : 'web_probe');
  if (expected.errorMessagePrefix !== undefined) {
    assert.equal(expected.status, 'failed', 'a variable rejection detail is only valid for a failed command');
    assert.ok(typeof expected.errorMessagePrefix === 'string' && expected.errorMessagePrefix.length > 0);
    assert.ok(typeof after.operation.errorMessage === 'string'
      && after.operation.errorMessage.startsWith(expected.errorMessagePrefix), 'failure must retain its expected rejection boundary');
  } else {
    assert.equal(after.operation.errorMessage, expected.errorMessage ?? null, 'old errors must not contaminate the current command');
  }
  // Public labels use day 1 for absolute minute 0; save/load summaries use absolute minutes.
  const worldMinute = expected.status === 'completed' && expected.name !== 'menu_confirm'
    ? timeInMinutes(expected.timeLabel) - 1440 : null;
  assert.equal(after.operation.worldMinute, worldMinute, 'save/load summary must match the resulting public time without stale success data');
}

const FARMING_COLLECTIONS = ['fieldOptions', 'seedOptions', 'harvestableOptions', 'materialOptions'];

// Assess only public, detached menu projections. The verifier must not inspect or repair SaveFile.
export function assertFarmingProjection(state) {
  const farming = state.farming;
  assert.ok(farming && typeof farming === 'object', 'the public farming projection must exist');
  for (const key of FARMING_COLLECTIONS) assert.ok(Array.isArray(farming[key]), key + ' must be a public option list');
  for (const [selected, options] of [['selectedFieldId', 'fieldOptions'], ['selectedSeedId', 'seedOptions'], ['selectedCropId', 'harvestableOptions']]) {
    assert.ok(farming[selected] === null || typeof farming[selected] === 'string', 'selection must be explicit or empty');
    if (farming[selected] !== null) assert.ok(farming[options].some((item) => item.id === farming[selected] && item.enabled), 'selection must refer to a current enabled option');
  }
  assert.ok(Number.isSafeInteger(farming.seedAmount) && farming.seedAmount >= 1, 'seed quantity must be a positive safe integer');
  for (const key of ['field', 'seed', 'crop', 'inventory', 'amount']) {
    assert.ok(typeof state.displayedFarming?.[key] === 'string' && state.displayedFarming[key].trim(), key + ' must have visible feedback');
  }
  return farming;
}

export function assertLocalSelectionObservation(observation, { key, value }) {
  assertInputObservation(observation);
  const { before, after } = observation;
  const previous = assertFarmingProjection(before);
  const current = assertFarmingProjection(after);
  assert.equal(before.busy, false);
  assert.equal(after.busy, false);
  assert.ok(Number.isSafeInteger(before.operation?.sequence), 'local input must retain an observable command sequence');
  assert.equal(after.timeLabel, before.timeLabel, 'local selection must not advance the world');
  assert.deepEqual(after.operation, before.operation, 'a selection click must not submit a command or publish an old result');
  for (const name of FARMING_COLLECTIONS) assert.deepEqual(current[name], previous[name], 'a selection click must not mutate public world data');
  assert.equal(current[key], value, 'the physical control must select its expected value');
}

const lotQuantity = (options, id) => options.find((item) => item.id === id)?.quantity;

export function assertFarmingCommandObservation(observation, expected) {
  assertUiCommandObservation(observation, { ...expected, name: 'menu_confirm' });
  const before = assertFarmingProjection(observation.before);
  const after = assertFarmingProjection(observation.after);
  if (expected.status === 'failed') {
    for (const name of FARMING_COLLECTIONS) assert.deepEqual(after[name], before[name], 'a rejected action must preserve all public farming data');
    assert.equal(observation.after.timeLabel, observation.before.timeLabel, 'a rejected action must preserve world time');
    return;
  }
  if (expected.actionType === 'plant_crop') {
    const field = before.fieldOptions.find((item) => item.id === before.selectedFieldId);
    const updatedField = after.fieldOptions.find((item) => item.id === before.selectedFieldId);
    const seed = lotQuantity(before.seedOptions, before.selectedSeedId);
    const remaining = lotQuantity(after.seedOptions, before.selectedSeedId);
    assert.ok(field?.enabled && seed, 'planting requires the explicitly selected public field and seed');
    assert.equal(updatedField?.occupied_tiles, field.occupied_tiles + 1, 'planting must occupy the selected field');
    assert.equal(updatedField?.active_crop_count, field.active_crop_count + 1);
    assert.equal(updatedField.enabled, false);
    if (remaining) assert.equal(remaining.unit, seed.unit, 'planting must retain the seed quantity unit');
    assert.equal(remaining?.amount ?? 0, seed.amount - before.seedAmount, 'planting must consume exactly the selected seed quantity');
    assert.equal(after.selectedFieldId, null, 'an occupied field selection must be cleared');
    assert.match(observation.after.displayedOperation, /播种成功/);
  } else if (expected.actionType === 'harvest_crop') {
    const crop = before.harvestableOptions.find((item) => item.id === before.selectedCropId);
    assert.ok(crop?.enabled, 'harvesting requires the explicitly selected public crop');
    const field = before.fieldOptions.find((item) => item.id === crop.field_plot_id);
    const updatedField = after.fieldOptions.find((item) => item.id === crop.field_plot_id);
    assert.equal(updatedField?.occupied_tiles, field.occupied_tiles - 1, 'harvesting must release the occupied field');
    assert.equal(updatedField?.active_crop_count, field.active_crop_count - 1);
    assert.equal(updatedField.enabled, true);
    assert.equal(after.harvestableOptions.some((item) => item.id === crop.id), false, 'a harvested crop must leave the public harvest list');
    assert.equal(after.selectedCropId, null, 'a harvested crop selection must be cleared');
    const gains = after.materialOptions.filter((lot) => {
      const previous = lotQuantity(before.materialOptions, lot.id);
      if (previous) assert.equal(lot.quantity.unit, previous.unit);
      return lot.quantity.amount > (previous?.amount ?? 0);
    });
    assert.ok(gains.length > 0, 'harvesting must produce a positive public material quantity, not only increase a lot count');
    assert.match(observation.after.displayedOperation, /收获成功/);
    for (const lot of gains) {
      assert.ok(observation.after.displayedFarming.inventory.includes(String(lot.quantity.amount)), 'the inventory Label must show the actual resulting quantity');
      const visibleUnit = ({ count: '粒', g: '克', ml: '毫升' })[lot.quantity.unit] ?? lot.quantity.unit;
      assert.ok(observation.after.displayedFarming.inventory.includes(visibleUnit), 'the inventory Label must show the public quantity unit in the UI format');
    }
  } else {
    assert.equal(expected.actionType, 'advance_time');
    assert.equal(timeInMinutes(observation.after.timeLabel) - timeInMinutes(observation.before.timeLabel), 1440, 'one day must advance exactly 1440 normal world minutes');
    assert.match(observation.after.displayedOperation, /已推进一天/);
  }
}

export function assertFarmingLoadRecovery(saved, loaded) {
  assertUiCommandObservation(loaded, { name: 'load', status: 'completed', timeLabel: saved.timeLabel });
  const restored = assertFarmingProjection(loaded.after);
  for (const name of FARMING_COLLECTIONS) assert.deepEqual(restored[name], saved.farming[name], 'manual load must restore the saved public farming data');
  assert.ok(loaded.before.farming.selectedCropId, 'the recovery case must first select a crop from the later world');
  assert.equal(restored.harvestableOptions.length, 0, 'the saved planted state must not be ready to harvest');
  assert.equal(restored.selectedCropId, null, 'load must clear the no-longer-harvestable crop selection');
  assert.match(loaded.after.displayedOperation, /已恢复本地存档/);
}

export function assertStoredSaveUnchanged(before, after) {
  assert.ok(typeof before.origin === 'string' && before.origin !== 'null' && before.origin.length > 0);
  assert.ok(typeof before.key === 'string' && before.key.length > 0);
  assert.ok(before.raw === null || typeof before.raw === 'string');
  assert.equal(after.origin, before.origin, 'storage evidence must use the same origin');
  assert.equal(after.key, before.key, 'storage evidence must address the same project slot');
  assert.equal(after.raw, before.raw, 'startup, load and cleanup must not rewrite the saved bytes');
}

// A fresh page deliberately starts a new game. Only the physical load click may restore the saved state.
export function assertLocalSaveRecovery({ saved, initial, afterStartup, loaded, afterLoad }) {
  assert.ok(typeof saved.raw === 'string' && saved.raw.length > 0, 'recovery requires an actual saved string');
  assertStoredSaveUnchanged(saved, afterStartup);
  assert.equal(initial.phase, 'ready');
  assert.equal(initial.hasSession, true);
  assert.equal(initial.timeLabel, 'day 1 minute 360', 'startup must keep the existing new-game behavior');
  assert.equal(initial.displayedTime, initial.timeLabel);
  assert.equal(initial.operation.sequence, 0, 'startup must not automatically save or load');
  assert.equal(initial.operation.status, 'idle');
  assert.equal(initial.busy, false);
  assert.deepEqual(initial.errors, []);
  assert.equal(loaded.before.timeLabel, initial.timeLabel);
  assert.equal(loaded.before.operation.sequence, initial.operation.sequence, 'manual load must be the first command after startup');
  assertUiCommandObservation(loaded, { name: 'load', status: 'completed', timeLabel: saved.timeLabel });
  assertStoredSaveUnchanged(saved, afterLoad);
}
