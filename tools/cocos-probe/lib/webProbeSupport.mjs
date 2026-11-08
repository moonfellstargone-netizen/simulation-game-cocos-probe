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

function assertInputObservation(observation, expectedEventCount = 1) {
  const { before, after, eventCount, scrollBefore, scrollDown, scrollAfter, layout } = observation;
  assert.equal(before.phase, 'ready', 'input must begin in a ready session');
  assert.equal(after.phase, 'ready', 'session must remain ready');
  assert.equal(after.hasSession, true, 'session must remain alive');
  assert.equal(eventCount, expectedEventCount, expectedEventCount === 1
    ? 'one physical click must emit exactly one Cocos Button event' : 'a disabled control must emit no Cocos Button event');
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
  const menuCommand = expected.name === 'menu_confirm' || expected.name === 'menu_preview' || expected.name === 'menu_confirm_split_direct';
  assert.equal(after.operation.slotId, menuCommand ? null : 'web_probe');
  if (expected.errorMessagePrefix !== undefined) {
    assert.equal(expected.status, 'failed', 'a variable rejection detail is only valid for a failed command');
    assert.ok(typeof expected.errorMessagePrefix === 'string' && expected.errorMessagePrefix.length > 0);
    assert.ok(typeof after.operation.errorMessage === 'string'
      && after.operation.errorMessage.startsWith(expected.errorMessagePrefix), 'failure must retain its expected rejection boundary');
  } else {
    assert.equal(after.operation.errorMessage, expected.errorMessage ?? null, 'old errors must not contaminate the current command');
  }
  // Public labels use day 1 for absolute minute 0; save/load summaries use absolute minutes.
  const worldMinute = expected.status === 'completed' && !menuCommand
    ? timeInMinutes(expected.timeLabel) - 1440 : null;
  assert.equal(after.operation.worldMinute, worldMinute, 'save/load summary must match the resulting public time without stale success data');
}

const FARMING_COLLECTIONS = ['fieldOptions', 'seedOptions', 'harvestableOptions', 'materialOptions', 'cropStatusOptions'];

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
  assert.ok(Number.isSafeInteger(farming.plantingTiles) && farming.plantingTiles >= 1);
  assert.ok(Number.isSafeInteger(farming.seedsPerTile) && farming.seedsPerTile >= 1 && farming.seedsPerTile <= 3);
  assert.equal(farming.seedAmount, farming.plantingTiles * farming.seedsPerTile, 'total seeds and planting positions must remain distinct');
  for (const crop of farming.cropStatusOptions) assert.deepEqual(Object.keys(crop).sort(), ['field_plot_id', 'growth_stage', 'id', 'lifecycle_status'], 'public crops must not leak hidden germination outcomes');
  for (const key of ['field', 'seed', 'crop', 'inventory', 'amount', 'planting']) {
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
    assert.equal(updatedField?.occupied_tiles, field.occupied_tiles + before.plantingTiles, 'each planting position must occupy one tile');
    assert.equal(updatedField?.active_crop_count, field.active_crop_count + before.plantingTiles, 'each planting position must create one crop');
    assert.equal(updatedField.capacity_tiles, field.capacity_tiles);
    assert.equal(updatedField.available_tiles, field.available_tiles - before.plantingTiles);
    assert.equal(updatedField.enabled, updatedField.available_tiles > 0);
    if (remaining) assert.equal(remaining.unit, seed.unit, 'planting must retain the seed quantity unit');
    assert.equal(remaining?.amount ?? 0, seed.amount - before.seedAmount, 'planting must consume exactly the selected seed quantity');
    assert.equal(after.selectedFieldId, updatedField.enabled ? field.id : null, 'only a full field selection must be cleared');
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

const INVENTORY_COLLECTIONS = ['lotOptions', 'targetOptions'];
const STORAGE_LABELS = { room_temp: '常温储存', cellar: '菜窖', pickling_jar: '腌菜缸' };
const VISIBLE_UNITS = { count: '粒', g: '克', ml: '毫升', bundle: '捆' };
const escapePattern = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const visibleNumber = (label, amount, suffix = '') => new RegExp('(^|[^\\d.])' + escapePattern(amount) + '\\s*' + escapePattern(suffix) + '(?![\\d.])').test(label);

export function assertInventoryProjection(state) {
  assert.ok(['farming', 'inventory', 'processing', 'cooking', 'orders'].includes(state.panel), 'the active local panel must be explicit');
  const inventory = state.inventory;
  assert.ok(inventory && typeof inventory === 'object', 'the public inventory projection must exist');
  for (const key of INVENTORY_COLLECTIONS) assert.ok(Array.isArray(inventory[key]), key + ' must be a public option list');
  for (const [selected, options] of [['selectedLotId', 'lotOptions'], ['selectedTargetId', 'targetOptions']]) {
    assert.ok(inventory[selected] === null || typeof inventory[selected] === 'string', 'selection must be explicit or empty');
    if (inventory[selected] !== null) assert.ok(inventory[options].some((item) => item.id === inventory[selected]), 'a browsed selection must still exist, even when disabled');
  }
  for (const lot of inventory.lotOptions) {
    assert.ok(Number.isFinite(lot.quantity?.amount) && lot.quantity.amount > 0 && typeof lot.quantity.unit === 'string');
    for (const key of ['location_id', 'storage_type', 'container_id']) assert.ok(typeof lot.storage_ref?.[key] === 'string' && lot.storage_ref[key]);
    assert.ok(typeof lot.current_form === 'string' && lot.current_form);
  }
  for (const target of inventory.targetOptions) {
    assert.ok(Number.isFinite(target.capacity?.amount) && target.capacity.amount > 0 && target.capacity.unit === 'slot_weight', 'ordinary storage capacity remains slot_weight, never material g/ml/count');
    assert.ok(Number.isFinite(target.used_capacity) && target.used_capacity >= 0);
    if (target.capacity_limits || target.used_capacity_limits) {
      assert.ok(target.capacity_limits && target.used_capacity_limits, 'physical limits and used values must both be available');
      for (const dimension of ['mass_g', 'volume_ml']) {
        assert.ok(Number.isFinite(target.capacity_limits[dimension]) && target.capacity_limits[dimension] > 0);
        assert.ok(Number.isFinite(target.used_capacity_limits[dimension]) && target.used_capacity_limits[dimension] >= 0 && target.used_capacity_limits[dimension] <= target.capacity_limits[dimension]);
      }
    } else assert.ok(target.used_capacity <= target.capacity.amount, 'legacy slot capacity remains enforced');
  }
  if (state.panel === 'inventory') {
    for (const key of ['lot', 'form', 'quantity', 'location', 'target', 'capacity', 'hint']) {
      assert.ok(typeof state.displayedInventory?.[key] === 'string' && state.displayedInventory[key].trim(), key + ' must have visible inventory feedback');
    }
    const lot = inventory.lotOptions.find((item) => item.id === inventory.selectedLotId);
    if (lot) {
      assert.ok(visibleNumber(state.displayedInventory.quantity, lot.quantity.amount, VISIBLE_UNITS[lot.quantity.unit] ?? lot.quantity.unit), 'the selected lot Label must show its actual quantity and unit');
      const name = STORAGE_LABELS[lot.storage_ref.storage_type];
      if (name) assert.ok(state.displayedInventory.location.includes(name), 'the location Label must describe the selected lot current storage type');
    }
    const target = inventory.targetOptions.find((item) => item.id === inventory.selectedTargetId);
    if (target) {
      assert.equal(state.displayedInventory.capacity, '目标空间将在操作时校验');
      assert.doesNotMatch(state.displayedInventory.capacity, /升|千克|容量点/);
      const name = STORAGE_LABELS[target.storage_type];
      if (name) assert.ok(state.displayedInventory.target.includes(name), 'the target Label must describe the selected storage type');
    }
  }
  return inventory;
}

function assertInventoryWorldUnchanged(before, after) {
  assert.equal(after.timeLabel, before.timeLabel, 'inventory interaction must not advance world time');
  for (const key of INVENTORY_COLLECTIONS) assert.deepEqual(after.inventory[key], before.inventory[key], 'public inventory and capacity data must be preserved');
  assert.deepEqual(after.farming, before.farming, 'local inventory interaction or refusal must not change farming state');
}

export function assertLocalInventoryObservation(observation, expected) {
  assertInputObservation(observation);
  assertInventoryProjection(observation.before); assertInventoryProjection(observation.after);
  assert.equal(observation.before.busy, false); assert.equal(observation.after.busy, false);
  assert.deepEqual(observation.after.operation, observation.before.operation, 'panel or selection clicks must not submit commands');
  assertInventoryWorldUnchanged(observation.before, observation.after);
  if (expected.panel !== undefined) assert.equal(observation.after.panel, expected.panel);
  else {
    assert.equal(observation.after.panel, 'inventory');
    assert.equal(observation.after.inventory[expected.key], expected.value, 'physical selection must choose the current public option');
  }
}

export function assertDisabledInventoryObservation(observation) {
  assertInputObservation(observation, 0);
  const before = assertInventoryProjection(observation.before);
  assertInventoryProjection(observation.after);
  assert.equal(observation.layout.buttonInteractable, false);
  assert.equal(observation.before.panel, 'inventory'); assert.equal(observation.after.panel, 'inventory');
  assert.equal(before.canMove, false);
  const lot = before.lotOptions.find((item) => item.id === before.selectedLotId);
  assert.ok(lot && before.selectedTargetId === lot.storage_ref.container_id, 'this disabled case must be the same selected container');
  assert.equal(observation.before.busy, false); assert.equal(observation.after.busy, false);
  assert.deepEqual(observation.after.operation, observation.before.operation, 'clicking the disabled same-target action must submit no command');
  assertInventoryWorldUnchanged(observation.before, observation.after);
}

export function assertInventoryCommandObservation(observation, expected) {
  assertUiCommandObservation(observation, { ...expected, name: 'menu_confirm' });
  const before = assertInventoryProjection(observation.before);
  const after = assertInventoryProjection(observation.after);
  assert.equal(observation.before.panel, 'inventory'); assert.equal(observation.after.panel, 'inventory');
  assert.equal(observation.after.timeLabel, observation.before.timeLabel, 'moving a batch does not advance time');
  if (expected.status === 'failed') { assertInventoryWorldUnchanged(observation.before, observation.after); return; }
  const lot = before.lotOptions.find((item) => item.id === before.selectedLotId);
  const target = before.targetOptions.find((item) => item.id === before.selectedTargetId);
  assert.ok(lot?.enabled && target?.enabled && lot.storage_ref.container_id !== target.id);
  assert.deepEqual(after.lotOptions.map((item) => item.id), before.lotOptions.map((item) => item.id), 'whole-batch moves neither create nor delete lots');
  const moved = after.lotOptions.find((item) => item.id === lot.id);
  assert.deepEqual(moved, { ...lot, storage_ref: { location_id: target.location_id, storage_type: target.storage_type, container_id: target.id } }, 'only the selected lot storage_ref may change; identity, form, quantity and unit stay exact');
  for (const other of before.lotOptions.filter((item) => item.id !== lot.id)) assert.deepEqual(after.lotOptions.find((item) => item.id === other.id), other);
  const source = before.targetOptions.find((item) => item.id === lot.storage_ref.container_id);
  const sourceAfter = after.targetOptions.find((item) => item.id === source?.id);
  const targetAfter = after.targetOptions.find((item) => item.id === target.id);
  assert.ok(source && sourceAfter && targetAfter);
  const transferredCapacity = source.used_capacity - sourceAfter.used_capacity;
  assert.ok(transferredCapacity > 0, 'moving an active lot must release positive source capacity');
  assert.equal(targetAfter.used_capacity - target.used_capacity, transferredCapacity, 'the same slot_weight must be added to the destination without deriving it from material units');
  assert.equal(after.targetOptions.reduce((sum, item) => sum + item.used_capacity, 0), before.targetOptions.reduce((sum, item) => sum + item.used_capacity, 0), 'total used storage capacity is conserved');
  if (source.used_capacity_limits || target.used_capacity_limits) {
    assert.ok(source.used_capacity_limits && target.used_capacity_limits && sourceAfter.used_capacity_limits && targetAfter.used_capacity_limits);
    for (const dimension of ['mass_g', 'volume_ml']) {
      const removed = Math.round((source.used_capacity_limits[dimension] - sourceAfter.used_capacity_limits[dimension]) * 1000);
      const added = Math.round((targetAfter.used_capacity_limits[dimension] - target.used_capacity_limits[dimension]) * 1000);
      assert.ok(removed > 0 && removed === added, 'whole-batch transfer conserves physical ' + dimension);
    }
  }
  assert.equal(after.selectedLotId, lot.id); assert.equal(after.selectedTargetId, target.id); assert.equal(after.canMove, false);
  assert.match(observation.after.displayedOperation, /转移成功/);
}

export function assertInventoryLoadRecovery(saved, loaded) {
  assertUiCommandObservation(loaded, { name: 'load', status: 'completed', timeLabel: saved.timeLabel });
  const restored = assertInventoryProjection(loaded.after);
  assert.notDeepEqual(loaded.before.inventory.lotOptions, saved.inventory.lotOptions, 'the case must move the batch after saving before it loads');
  for (const key of INVENTORY_COLLECTIONS) assert.deepEqual(restored[key], saved.inventory[key], 'manual load must restore saved public locations, quantities and capacity');
  assert.equal(restored.selectedLotId, loaded.before.inventory.selectedLotId, 'a still-existing selected lot is retained with restored data');
  assert.match(loaded.after.displayedOperation, /已恢复本地存档/);
}

export function assertSplitProjection(state) {
  const inventory = assertInventoryProjection(state);
  const ids = inventory.lotOptions.map((lot) => lot.id);
  assert.equal(new Set(ids).size, ids.length, 'all current material lot IDs must remain unique');
  assert.equal(typeof inventory.splitQuantityText, 'string');
  assert.ok(inventory.splitUnit === null || typeof inventory.splitUnit === 'string');
  assert.ok(inventory.splitInputError === null || typeof inventory.splitInputError === 'string');
  assert.equal(typeof inventory.canPreviewSplit, 'boolean');
  assert.equal(typeof inventory.canConfirmSplit, 'boolean');
  for (const key of ['quantityText', 'unit', 'selection', 'preview', 'result']) {
    assert.equal(typeof state.displayedSplit?.[key], 'string', key + ' must have a public split Label');
  }
  assert.equal(state.displayedSplit.quantityText, inventory.splitQuantityText, 'EditBox text must match the current local draft');
  const selected = inventory.lotOptions.find((lot) => lot.id === inventory.selectedLotId);
  if (selected) {
    const inputUnit = selected.cabbage_pieces?.kind === 'whole' ? 'count' : selected.quantity.unit;
    assert.equal(inventory.splitUnit, inputUnit, 'split units come from the selected material state');
    assert.equal(state.displayedSplit.unit, selected.cabbage_pieces?.kind === 'whole' ? '颗' : VISIBLE_UNITS[inputUnit] ?? inputUnit, 'the visible input unit must match its source');
  }
  if (inventory.canConfirmSplit) {
    assert.ok(selected?.enabled);
    assert.equal(inventory.splitNeedsReview, false, 'uncertain results block new confirmation');
    assert.equal(inventory.splitInputError, null, 'confirmation requires a locally valid quantity');
  }
  return inventory;
}

export function assertSplitQuantityObservation(observation, text) {
  assertInputObservation(observation, 0);
  const input = observation.layout.button;
  const epsilon = 1e-6;
  for (const name of ['text', 'placeholder']) {
    const label = observation.layout.inputLabels?.[name];
    assert.ok(label && ['left', 'top', 'right', 'bottom', 'width', 'height'].every((key) => Number.isFinite(label[key])), name + ' Label must expose finite UITransform bounds');
    assert.ok(label.width > 0 && label.height > 0 && label.left >= input.left - epsilon && label.top >= input.top - epsilon
      && label.right <= input.right + epsilon && label.bottom <= input.bottom + epsilon,
    name + ' Label must fit inside the actual EditBox input rectangle');
  }
  const { before, after } = observation;
  assertSplitProjection(before); assertSplitProjection(after);
  assert.equal(before.panel, 'inventory'); assert.equal(after.panel, 'inventory');
  assert.equal(before.busy, false); assert.equal(after.busy, false);
  assert.deepEqual(after.operation, before.operation, 'typing must not dispatch a menu or save command');
  assertInventoryWorldUnchanged(before, after);
  assert.equal(observation.focused?.className, 'cocosEditBox', 'physical focus must reach the real Creator DOM input');
  assert.equal(observation.focused?.value, text, 'keyboard input must reach the focused native input');
  assert.ok(observation.editEvents.began >= 1 && observation.editEvents.changed >= 1 && observation.editEvents.ended >= 1,
    'actual Cocos editing and text change events must be observed');
  assert.equal(after.inventory.splitQuantityText, text);
  assert.equal(after.inventory.splitPreview, null, 'editing invalidates the previous preview');
  assert.equal(after.inventory.splitResult, null, 'editing clears the old split result');
  assert.equal(after.inventory.canConfirmSplit, after.inventory.splitInputError === null && !after.inventory.splitNeedsReview);
}

export function assertSplitDisabledObservation(observation, buttonName) {
  assertInputObservation(observation, 0);
  assertSplitProjection(observation.before); assertSplitProjection(observation.after);
  assert.equal(observation.layout.buttonInteractable, false);
  assert.equal(observation.before.inventory[buttonName === 'SplitPreview' ? 'canPreviewSplit' : 'canConfirmSplit'], false);
  assert.deepEqual(observation.after.operation, observation.before.operation, 'a disabled split button submits no command');
  assertInventoryWorldUnchanged(observation.before, observation.after);
}

export function assertSplitPreviewObservation(observation, expected) {
  assertUiCommandObservation(observation, { ...expected, name: 'menu_preview', timeLabel: observation.before.timeLabel });
  assertSplitProjection(observation.before); const after = assertSplitProjection(observation.after);
  assertInventoryWorldUnchanged(observation.before, observation.after);
  assert.deepEqual(after.splitPreview, { success: expected.status === 'completed', statusCode: expected.statusCode });
  assert.equal(after.canConfirmSplit, after.splitInputError === null && !after.splitNeedsReview);
  assert.equal(after.splitResult, null);
  assert.ok(observation.after.displayedSplit.preview.trim(), 'the explicit preview must have visible feedback');
}

export function assertSplitDirectRejectionObservation(observation, { statusCode }) {
  assertUiCommandObservation(observation, { name: 'menu_confirm_split_direct', status: 'failed', timeLabel: observation.before.timeLabel, errorMessage: statusCode });
  const before = assertSplitProjection(observation.before); const after = assertSplitProjection(observation.after);
  assert.equal(before.canConfirmSplit, true);
  assertInventoryWorldUnchanged(observation.before, observation.after);
  assert.equal(after.splitResult, null);
  assert.equal(after.splitNeedsReview, false, 'an explicit validation refusal is a known outcome');
}

export function assertSplitConfirmObservation(observation, { amount }) {
  assertUiCommandObservation(observation, { name: 'menu_confirm_split_direct', status: 'completed', timeLabel: observation.before.timeLabel });
  const before = assertSplitProjection(observation.before); const after = assertSplitProjection(observation.after);
  assert.equal(before.canConfirmSplit, true);
  const source = before.lotOptions.find((lot) => lot.id === before.selectedLotId);
  const pieces = source?.cabbage_pieces?.kind === 'whole' ? source.cabbage_pieces.pieces : null;
  assert.ok(source?.enabled && Number.isFinite(amount) && amount > 0 && amount <= (pieces ? pieces.length : source.quantity.amount));
  if (pieces) assert.ok(Number.isInteger(amount), 'whole cabbage uses integer piece counts');
  assert.equal(Number(before.splitQuantityText), amount);
  const result = after.splitResult;
  assert.ok(result && result.sourceLotId === source.id);
  assert.ok(typeof result.newLotId === 'string' && !before.lotOptions.some((lot) => lot.id === result.newLotId),
    'a split must allocate a new ID absent from the current world, including after load');
  const created = after.lotOptions.find((lot) => lot.id === result.newLotId);
  assert.ok(created, 'the result must name a real publicly observable child lot');
  for (const key of ['base_id', 'category', 'current_form', 'storage_ref']) assert.deepEqual(created[key], source[key]);
  const splitAmount = pieces ? pieces.slice(0, amount).reduce((sum, item) => sum + item.weight_g, 0) : amount;
  assert.deepEqual(created.quantity, { amount: splitAmount, unit: source.quantity.unit });
  if (pieces) assert.deepEqual(created.cabbage_pieces, { kind: 'whole', pieces: pieces.slice(0, amount) });
  assert.deepEqual(result.quantity, created.quantity);
  const remainder = after.lotOptions.find((lot) => lot.id === source.id);
  const remainingAmount = source.quantity.amount - splitAmount;
  if (remainingAmount === 0) {
    assert.equal(remainder, undefined, 'a full split removes the exhausted source');
    assert.equal(result.remainingQuantity, null);
    assert.equal(after.selectedLotId, null, 'an exhausted source selection must be cleared');
  } else {
    assert.deepEqual(remainder, { ...source, quantity: { amount: remainingAmount, unit: source.quantity.unit },
      ...(pieces ? { cabbage_pieces: { kind: 'whole', pieces: pieces.slice(amount) } } : {}) });
    assert.deepEqual(result.remainingQuantity, remainder.quantity);
  }
  assert.equal(after.lotOptions.length, before.lotOptions.length + (remainingAmount === 0 ? 0 : 1));
  for (const other of before.lotOptions.filter((lot) => lot.id !== source.id)) {
    assert.deepEqual(after.lotOptions.find((lot) => lot.id === other.id), other, 'unrelated lots must remain unchanged');
  }
  for (const target of before.targetOptions.filter((item) => item.id !== source.storage_ref.container_id)) {
    assert.deepEqual(after.targetOptions.find((item) => item.id === target.id), target, 'unrelated storage targets stay unchanged');
  }
  for (const key of ['fieldOptions', 'harvestableOptions']) assert.deepEqual(observation.after.farming[key], observation.before.farming[key]);
  assert.deepEqual(observation.after.farming.materialOptions, after.lotOptions, 'both public panels must observe the same current material batches');
  assert.equal(after.canConfirmSplit, false, 'a completed split cannot reuse the old preview');
  assert.ok(visibleNumber(observation.after.displayedSplit.result, splitAmount, VISIBLE_UNITS[source.quantity.unit] ?? source.quantity.unit), 'the result Label must show the actual split weight and unit');
  if (remainingAmount === 0) assert.match(observation.after.displayedSplit.result, /来源已全部拆出/);
  else assert.ok(visibleNumber(observation.after.displayedSplit.result, remainingAmount, VISIBLE_UNITS[source.quantity.unit] ?? source.quantity.unit), 'the result must show the actual remaining quantity');
  assert.match(observation.after.displayedOperation, /拆分成功/);
  return result;
}

export function assertSplitLoadRecovery(savedState, loaded) {
  assertUiCommandObservation(loaded, { name: 'load', status: 'completed', timeLabel: savedState.timeLabel });
  const restored = assertSplitProjection(loaded.after);
  for (const key of INVENTORY_COLLECTIONS) assert.deepEqual(restored[key], savedState.inventory[key]);
  assert.equal(restored.splitPreview, null, 'manual load invalidates any old preview');
  assert.equal(restored.splitResult, null, 'manual load cannot present an old split as its own result');
  assert.equal(restored.canConfirmSplit, false);
  assert.match(loaded.after.displayedOperation, /已恢复本地存档/);
}

const PROCESSING_COLLECTIONS = ['methodOptions', 'lotOptions', 'facilityOptions', 'taskOptions'];

const COOKING_COLLECTIONS = ['recipeOptions', 'lotOptions', 'targetOptions', 'dishOptions'];
export function assertCookingProjection(state) {
  assertInventoryProjection(state);
  const cooking = state.cooking;
  assert.ok(cooking && typeof cooking === 'object');
  for (const key of COOKING_COLLECTIONS) {
    assert.ok(Array.isArray(cooking[key]));
    const ids = cooking[key].map(item => item.id);
    assert.equal(new Set(ids).size, ids.length, 'cooking identities must remain unique');
  }
  for (const [key, options] of [['selectedRecipeId', 'recipeOptions'], ['selectedTargetId', 'targetOptions']]) {
    assert.ok(cooking[key] === null || cooking[options].some(item => item.id === cooking[key]));
  }
  assert.ok(Array.isArray(cooking.inputSelections));
  for (const key of ['canPreview', 'canCook']) assert.equal(typeof cooking[key], 'boolean');
  if (cooking.canCook) assert.equal(cooking.preview?.success, true);
  if (state.panel === 'cooking') {
    for (const key of ['recipe', 'role', 'lot', 'selection', 'operation', 'target', 'fuel', 'preview', 'result', 'dishes']) assert.ok(typeof state.displayedCooking?.[key] === 'string' && state.displayedCooking[key].trim(), key + ' must have visible cooking feedback');
    assert.equal(state.displayedCooking.quantityText, cooking.currentInputQuantityText);
    assert.equal(state.displayedCooking.minutesText, cooking.activeMinutesText);
    assert.equal(state.displayedCooking.unit, cooking.currentInputUnit === null ? '—' : VISIBLE_UNITS[cooking.currentInputUnit] ?? cooking.currentInputUnit);
    const fuel = cooking.recipeOptions.find(item => item.id === cooking.selectedRecipeId)?.fuel;
    if (fuel) assert.ok(visibleNumber(state.displayedCooking.fuel, fuel.current_quantity.amount, VISIBLE_UNITS[fuel.current_quantity.unit] ?? fuel.current_quantity.unit), 'fuel Label must show the actual current quantity and unit');
  }
  return cooking;
}

function assertCookingWorldUnchanged(before, after) {
  assertInventoryWorldUnchanged(before, after);
  for (const key of COOKING_COLLECTIONS) assert.deepEqual(after.cooking[key], before.cooking[key], 'local edit, refusal and preview preserve ' + key);
}

export function assertLocalCookingObservation(observation, expected) {
  assertInputObservation(observation);
  assertCookingProjection(observation.before); const after = assertCookingProjection(observation.after);
  assert.deepEqual(observation.after.operation, observation.before.operation);
  assertCookingWorldUnchanged(observation.before, observation.after);
  if (expected.panel !== undefined) assert.equal(observation.after.panel, expected.panel);
  else if (expected.lotId !== undefined) assert.equal(after.inputSelections.find(item => item.role === after.selectedRole)?.lotId, expected.lotId);
  else if (expected.key) assert.equal(after[expected.key], expected.value);
  assert.equal(after.preview, null); assert.equal(after.canCook, false);
}

export function assertCookingInputObservation(observation, text) {
  assertInputObservation(observation, 0);
  assertCookingProjection(observation.before); const after = assertCookingProjection(observation.after);
  assert.equal(observation.before.panel, 'cooking'); assert.equal(observation.after.panel, 'cooking');
  assert.deepEqual(observation.after.operation, observation.before.operation);
  assertCookingWorldUnchanged(observation.before, observation.after);
  assert.equal(observation.focused?.className, 'cocosEditBox'); assert.equal(observation.focused?.value, text);
  assert.ok(['began', 'changed', 'ended'].every(key => observation.editEvents[key] >= 1));
  const bounds = observation.layout.button;
  for (const key of ['text', 'placeholder']) {
    const label = observation.layout.inputLabels?.[key];
    assert.ok(label && label.width > 0 && label.height > 0 && label.left >= bounds.left - 1e-6 && label.right <= bounds.right + 1e-6 && label.top >= bounds.top - 1e-6 && label.bottom <= bounds.bottom + 1e-6);
  }
  assert.equal(observation.inputName === 'CookingMinutes' ? after.activeMinutesText : after.currentInputQuantityText, text);
  assert.equal(after.preview, null); assert.equal(after.canCook, false); assert.equal(after.result, null);
}

export function assertCookingDisabledObservation(observation, button) {
  assertInputObservation(observation, 0);
  const before = assertCookingProjection(observation.before); assertCookingProjection(observation.after);
  assert.equal(before[button === 'CookingPreview' ? 'canPreview' : 'canCook'], false);
  assert.equal(observation.layout.buttonInteractable, false);
  assert.deepEqual(observation.after.operation, observation.before.operation);
  assertCookingWorldUnchanged(observation.before, observation.after);
}

export function assertCookingPreviewObservation(observation, { statusCode = 'OK' } = {}) {
  const success = statusCode === 'OK';
  assertUiCommandObservation(observation, { name: 'menu_preview', status: success ? 'completed' : 'failed', timeLabel: observation.before.timeLabel, errorMessage: success ? null : statusCode });
  const before = assertCookingProjection(observation.before); const after = assertCookingProjection(observation.after);
  assert.equal(before.canPreview, true); assertCookingWorldUnchanged(observation.before, observation.after);
  assert.deepEqual(after.preview, { success, statusCode }); assert.equal(after.canCook, success); assert.equal(after.result, null);
}

export function assertCookingConfirmObservation(observation) {
  assertUiCommandObservation(observation, { name: 'menu_confirm', status: 'completed', timeLabel: observation.before.timeLabel });
  const before = assertCookingProjection(observation.before); const after = assertCookingProjection(observation.after);
  assert.equal(before.canCook, true);
  const result = after.result; assert.ok(result && typeof result.dishLotId === 'string');
  const dish = after.dishOptions.find(item => item.id === result.dishLotId);
  assert.ok(dish && !before.dishOptions.some(item => item.id === dish.id));
  assert.equal(after.dishOptions.length, before.dishOptions.length + 1);
  assert.equal(dish.serving_count, result.servingCount); assert.equal(dish.recognized_dish_id, result.recognizedDishId); assert.deepEqual(dish.storage_ref, result.storageRef);
  assert.equal(dish.storage_ref.container_id, before.selectedTargetId);
  for (const old of before.dishOptions) assert.deepEqual(after.dishOptions.find(item => item.id === old.id), old);
  const used = new Map();
  for (const selected of before.inputSelections.filter(item => item.lotId !== null)) used.set(selected.lotId, (used.get(selected.lotId) ?? 0) + Number(selected.quantityText));
  for (const lot of observation.before.inventory.lotOptions) {
    const current = observation.after.inventory.lotOptions.find(item => item.id === lot.id); const amount = used.get(lot.id) ?? 0;
    if (lot.quantity.amount === amount) assert.equal(current, undefined);
    else { assert.ok(current); assert.deepEqual(current.quantity, { amount: lot.quantity.amount - amount, unit: lot.quantity.unit }); for (const key of ['base_id', 'current_form', 'storage_ref']) assert.deepEqual(current[key], lot[key]); }
  }
  const recipe = before.recipeOptions.find(item => item.id === before.selectedRecipeId);
  const fuelBefore = recipe.fuel; const fuelAfter = after.recipeOptions.find(item => item.id === recipe.id).fuel;
  if (fuelBefore?.enabled) {
    assert.deepEqual(fuelAfter.current_quantity, { amount: fuelBefore.current_quantity.amount - fuelBefore.cost.amount, unit: fuelBefore.current_quantity.unit });
  } else assert.deepEqual(fuelAfter, fuelBefore);
  assert.deepEqual(after.lotOptions, observation.after.inventory.lotOptions);
  assert.deepEqual(observation.after.farming.materialOptions, observation.after.inventory.lotOptions);
  assert.equal(after.preview, null); assert.equal(after.canCook, false);
  assert.match(observation.after.displayedOperation, /烹饪成功/);
  assert.ok(visibleNumber(observation.after.displayedCooking.result, dish.serving_count, '份'));
  return dish;
}

export function assertCookingLoadRecovery(saved, loaded) {
  assertUiCommandObservation(loaded, { name: 'load', status: 'completed', timeLabel: saved.timeLabel });
  const after = assertCookingProjection(loaded.after);
  for (const key of COOKING_COLLECTIONS) assert.deepEqual(after[key], saved.cooking[key], 'load must restore cooking ' + key);
  for (const key of INVENTORY_COLLECTIONS) assert.deepEqual(loaded.after.inventory[key], saved.inventory[key]);
  assert.equal(after.preview, null); assert.equal(after.canCook, false); assert.equal(after.result, null);
}

export function assertProcessingProjection(state) {
  assertInventoryProjection(state);
  const processing = state.processing;
  assert.ok(processing && typeof processing === 'object', 'the detached public processing projection must exist');
  for (const key of PROCESSING_COLLECTIONS) assert.ok(Array.isArray(processing[key]), key + ' must be a public processing list');
  for (const key of ['methodOptions', 'lotOptions', 'facilityOptions', 'taskOptions']) {
    const ids = processing[key].map((item) => item.id);
    assert.equal(new Set(ids).size, ids.length, key + ' IDs must remain unique, including after manual load');
  }
  for (const [selected, options] of [['selectedMethodId', 'methodOptions'], ['selectedFacilityId', 'facilityOptions'], ['selectedTaskId', 'taskOptions']]) {
    assert.ok(processing[selected] === null || typeof processing[selected] === 'string');
    if (processing[selected] !== null) assert.ok(processing[options].some((item) => item.id === processing[selected]), 'local selection must name a current public processing option');
  }
  const method = processing.methodOptions.find((item) => item.id === processing.selectedMethodId);
  assert.ok(processing.selectedRequirementIndex === null || (Number.isSafeInteger(processing.selectedRequirementIndex)
    && method?.input_requirements.some((item) => item.requirement_index === processing.selectedRequirementIndex)));
  assert.ok(Array.isArray(processing.inputSelections) && Array.isArray(processing.currentInputLotOptions));
  assert.equal(typeof processing.currentInputQuantityText, 'string');
  assert.ok(processing.currentInputUnit === null || typeof processing.currentInputUnit === 'string');
  assert.ok(processing.inputError === null || typeof processing.inputError === 'string');
  for (const key of ['canPreview', 'canStart', 'canCollect']) assert.equal(typeof processing[key], 'boolean');
  if (processing.canStart) assert.equal(processing.preview?.success, true, 'start requires the current successful preview');
  if (processing.canCollect) assert.equal(processing.taskOptions.find((task) => task.id === processing.selectedTaskId)?.status, 'ready_to_collect');
  if (state.panel === 'processing') {
    for (const key of ['method', 'facility', 'requirement', 'lot', 'quantityText', 'unit', 'selection', 'preview', 'task', 'result']) {
      assert.equal(typeof state.displayedProcessing?.[key], 'string', key + ' must have observable processing feedback');
      if (!['quantityText', 'unit'].includes(key)) assert.ok(state.displayedProcessing[key].trim());
    }
    assert.equal(state.displayedProcessing.quantityText, processing.currentInputQuantityText);
    assert.equal(state.displayedProcessing.unit, processing.currentInputUnit === null ? '—' : VISIBLE_UNITS[processing.currentInputUnit] ?? processing.currentInputUnit);
  }
  return processing;
}

function assertProcessingWorldUnchanged(before, after) {
  assertInventoryWorldUnchanged(before, after);
  for (const key of PROCESSING_COLLECTIONS) assert.deepEqual(after.processing[key], before.processing[key], 'local processing input or preview must preserve ' + key);
}

export function assertLocalProcessingObservation(observation, expected) {
  assertInputObservation(observation);
  assertProcessingProjection(observation.before); const after = assertProcessingProjection(observation.after);
  assert.equal(observation.before.busy, false); assert.equal(observation.after.busy, false);
  assert.deepEqual(observation.after.operation, observation.before.operation, 'local processing navigation must not submit a command');
  assertProcessingWorldUnchanged(observation.before, observation.after);
  if (expected.panel !== undefined) assert.equal(observation.after.panel, expected.panel);
  else if (expected.lotId !== undefined) {
    assert.equal(observation.after.panel, 'processing');
    assert.equal(after.selectedRequirementIndex, expected.requirementIndex);
    assert.equal(after.inputSelections.find((item) => item.requirementIndex === expected.requirementIndex)?.lotId, expected.lotId);
  }
  else { assert.equal(observation.after.panel, 'processing'); assert.equal(after[expected.key], expected.value); }
}

export function assertProcessingQuantityObservation(observation, text) {
  assertInputObservation(observation, 0);
  const before = assertProcessingProjection(observation.before); const after = assertProcessingProjection(observation.after);
  assert.equal(observation.before.panel, 'processing'); assert.equal(observation.after.panel, 'processing');
  assert.equal(observation.before.busy, false); assert.equal(observation.after.busy, false);
  assert.deepEqual(observation.after.operation, observation.before.operation, 'typing must not dispatch a command');
  assertProcessingWorldUnchanged(observation.before, observation.after);
  assert.equal(after.selectedRequirementIndex, before.selectedRequirementIndex);
  assert.equal(after.selectedMethodId, before.selectedMethodId);
  assert.equal(observation.focused?.className, 'cocosEditBox'); assert.equal(observation.focused?.value, text);
  assert.ok(observation.editEvents.began >= 1 && observation.editEvents.changed >= 1 && observation.editEvents.ended >= 1, 'real Creator edit events are required');
  const input = observation.layout.button; const epsilon = 1e-6;
  for (const name of ['text', 'placeholder']) {
    const label = observation.layout.inputLabels?.[name];
    assert.ok(label && ['left', 'top', 'right', 'bottom', 'width', 'height'].every((key) => Number.isFinite(label[key])));
    assert.ok(label.width > 0 && label.height > 0 && label.left >= input.left - epsilon && label.top >= input.top - epsilon
      && label.right <= input.right + epsilon && label.bottom <= input.bottom + epsilon, name + ' Label must fit inside the real processing EditBox');
  }
  assert.equal(after.currentInputQuantityText, text);
  assert.equal(after.inputSelections.find((item) => item.requirementIndex === after.selectedRequirementIndex)?.quantityText, text);
  assert.equal(after.preview, null); assert.equal(after.canStart, false);
  assert.equal(after.startResult, null); assert.equal(after.collectResult, null);
}

export function assertProcessingDisabledObservation(observation, buttonName) {
  assertInputObservation(observation, 0);
  const before = assertProcessingProjection(observation.before); assertProcessingProjection(observation.after);
  const capability = { ProcessingPreview: 'canPreview', StartProcessing: 'canStart', CollectProcessing: 'canCollect' }[buttonName];
  assert.ok(capability); assert.equal(before[capability], false);
  assert.equal(observation.layout.buttonInteractable, false);
  assert.equal(observation.before.panel, 'processing'); assert.equal(observation.after.panel, 'processing');
  assert.deepEqual(observation.after.operation, observation.before.operation, 'a disabled processing action submits no command');
  assertProcessingWorldUnchanged(observation.before, observation.after);
}

export function assertProcessingPreviewObservation(observation, { statusCode = 'OK' } = {}) {
  const success = statusCode === 'OK';
  assertUiCommandObservation(observation, { name: 'menu_preview', status: success ? 'completed' : 'failed', timeLabel: observation.before.timeLabel, errorMessage: success ? null : statusCode });
  const before = assertProcessingProjection(observation.before); const after = assertProcessingProjection(observation.after);
  assert.equal(before.canPreview, true);
  assertProcessingWorldUnchanged(observation.before, observation.after);
  assert.deepEqual(after.preview, { success, statusCode }); assert.equal(after.canStart, success);
  assert.equal(after.startResult, null); assert.equal(after.collectResult, null);
}

export function assertProcessingStartObservation(observation) {
  assertUiCommandObservation(observation, { name: 'menu_confirm', status: 'completed', timeLabel: observation.before.timeLabel });
  const before = assertProcessingProjection(observation.before); const after = assertProcessingProjection(observation.after);
  assert.equal(before.canStart, true);
  const method = before.methodOptions.find((item) => item.id === before.selectedMethodId);
  const result = after.startResult;
  assert.ok(result && result.methodId === method.id && typeof result.taskId === 'string');
  assert.equal(before.taskOptions.some((task) => task.id === result.taskId), false, 'start must allocate a new task ID');
  assert.equal(after.taskOptions.length, before.taskOptions.length + 1);
  const task = after.taskOptions.find((item) => item.id === result.taskId);
  assert.ok(task); assert.equal(task.method_id, method.id); assert.equal(task.status, 'active'); assert.equal(task.current_stage, 'fermenting');
  assert.equal(task.start_world_minute, timeInMinutes(observation.before.timeLabel) - 1440);
  assert.equal(task.expected_finish_minute - task.start_world_minute, method.process_duration_minutes, 'formal duration, never time_cost_minutes, determines readiness');
  assert.deepEqual(task.facility_ref, before.facilityOptions.find((item) => item.id === before.selectedFacilityId)?.facility_ref);
  const primarySelection = before.inputSelections[0];
  const primaryLot = observation.before.inventory.lotOptions.find((lot) => lot.id === primarySelection?.lotId);
  assert.ok(primaryLot);
  assert.deepEqual(task.expected_output, { base_id: primaryLot.base_id, quantity: { amount: Number(primarySelection.quantityText), unit: primaryLot.quantity.unit } }, 'the new task must retain the actual primary input quantity as its explicitly expected output');
  for (const previous of before.taskOptions) assert.deepEqual(after.taskOptions.find((item) => item.id === previous.id), previous);
  const used = new Map();
  for (const selection of before.inputSelections) {
    assert.ok(selection.lotId && Number.isFinite(Number(selection.quantityText)) && Number(selection.quantityText) > 0);
    used.set(selection.lotId, (used.get(selection.lotId) ?? 0) + Number(selection.quantityText));
  }
  for (const lot of observation.before.inventory.lotOptions) {
    const remaining = observation.after.inventory.lotOptions.find((item) => item.id === lot.id);
    const consumed = used.get(lot.id) ?? 0;
    if (consumed === 0) assert.deepEqual(remaining, lot, 'start must preserve unrelated material batches');
    else if (consumed === lot.quantity.amount) assert.equal(remaining, undefined, 'exhausted input must disappear');
    else {
      assert.ok(remaining); assert.deepEqual(remaining.quantity, { amount: lot.quantity.amount - consumed, unit: lot.quantity.unit });
      for (const key of ['base_id', 'category', 'current_form', 'storage_ref']) assert.deepEqual(remaining[key], lot[key]);
    }
  }
  assert.equal(observation.after.inventory.lotOptions.length, observation.before.inventory.lotOptions.length
    - observation.before.inventory.lotOptions.filter((lot) => used.get(lot.id) === lot.quantity.amount).length, 'start must not create an output batch');
  for (const key of ['fieldOptions', 'harvestableOptions', 'seedOptions']) assert.deepEqual(observation.after.farming[key], observation.before.farming[key]);
  assert.deepEqual(observation.after.farming.materialOptions, observation.after.inventory.lotOptions);
  assert.equal(after.preview, null); assert.equal(after.canStart, false); assert.equal(after.collectResult, null);
  assert.match(observation.after.displayedOperation, /加工开工成功/);
  return task;
}

export function assertProcessingCollectObservation(observation) {
  assertUiCommandObservation(observation, { name: 'menu_confirm', status: 'completed', timeLabel: observation.before.timeLabel });
  const before = assertProcessingProjection(observation.before); const after = assertProcessingProjection(observation.after);
  assert.equal(before.canCollect, true);
  const task = before.taskOptions.find((item) => item.id === before.selectedTaskId);
  assert.equal(task?.status, 'ready_to_collect');
  const result = after.collectResult;
  assert.ok(result && result.taskId === task.id && typeof result.lotId === 'string');
  assert.equal(observation.before.inventory.lotOptions.some((lot) => lot.id === result.lotId), false, 'collection output ID must be new, including after load');
  const created = observation.after.inventory.lotOptions.find((lot) => lot.id === result.lotId);
  assert.ok(created && created.quantity.amount > 0);
  assert.deepEqual(created.quantity, result.quantity); assert.deepEqual(created.quantity, task.expected_output?.quantity);
  assert.equal(created.base_id, task.expected_output?.base_id);
  assert.equal(observation.after.inventory.lotOptions.length, observation.before.inventory.lotOptions.length + 1);
  for (const previous of observation.before.inventory.lotOptions) assert.deepEqual(observation.after.inventory.lotOptions.find((lot) => lot.id === previous.id), previous, 'collection preserves all existing material batches');
  assert.equal(after.taskOptions.length, before.taskOptions.length);
  for (const previous of before.taskOptions) assert.deepEqual(after.taskOptions.find((item) => item.id === previous.id), previous.id === task.id
    ? { ...previous, status: 'completed', enabled: false, reason_key: 'ui.reason.processing_not_ready' } : previous);
  assert.equal(after.canCollect, false);
  for (const key of ['fieldOptions', 'harvestableOptions', 'seedOptions']) assert.deepEqual(observation.after.farming[key], observation.before.farming[key]);
  assert.deepEqual(observation.after.farming.materialOptions, observation.after.inventory.lotOptions);
  assert.ok(visibleNumber(observation.after.displayedProcessing.result, created.quantity.amount, VISIBLE_UNITS[created.quantity.unit] ?? created.quantity.unit), 'collection feedback must show the actual output quantity and unit');
  assert.match(observation.after.displayedOperation, /加工产物领取成功/);
  return created;
}

export function assertProcessingLoadRecovery(saved, loaded) {
  assertUiCommandObservation(loaded, { name: 'load', status: 'completed', timeLabel: saved.timeLabel });
  const after = assertProcessingProjection(loaded.after);
  for (const key of PROCESSING_COLLECTIONS) assert.deepEqual(after[key], saved.processing[key], 'manual load must restore saved public ' + key);
  for (const key of INVENTORY_COLLECTIONS) assert.deepEqual(loaded.after.inventory[key], saved.inventory[key]);
  for (const key of FARMING_COLLECTIONS) assert.deepEqual(loaded.after.farming[key], saved.farming[key]);
  assert.equal(after.preview, null); assert.equal(after.canStart, false);
  assert.equal(after.startResult, null); assert.equal(after.collectResult, null);
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


const ORDER_COLLECTIONS = ['orderOptions', 'dishOptions'];
const ORDER_STATUS_LABELS = { available:'可提交', accepted:'已接受', submitted:'结算中', completed:'已完成', failed:'失败', expired:'已超时', cancelled:'已取消' };
export function assertOrdersProjection(state) {
  assertCookingProjection(state);
  const orders = state.orders; assert.ok(orders && typeof orders === 'object');
  for (const key of ORDER_COLLECTIONS) { assert.ok(Array.isArray(orders[key])); assert.equal(new Set(orders[key].map(item => item.id)).size, orders[key].length); }
  for (const [key, collection] of [['selectedOrderId','orderOptions'],['selectedDishId','dishOptions']]) assert.ok(orders[key] === null || orders[collection].some(item => item.id === orders[key]));
  assert.ok(Number.isFinite(orders.money)); assert.ok(orders.reputation && typeof orders.reputation === 'object');
  assert.equal(typeof orders.canPreview,'boolean'); assert.equal(typeof orders.canSubmit,'boolean');
  if (orders.canSubmit) assert.equal(orders.preview?.success,true);
  if (orders.canPreview) { assert.ok(orders.orderOptions.find(item => item.id === orders.selectedOrderId)?.enabled); assert.ok(orders.dishOptions.find(item => item.id === orders.selectedDishId)?.enabled); }
  assert.deepEqual(orders.dishOptions,state.cooking.dishOptions,'orders and cooking must observe the same real dishes');
  if (state.panel === 'orders') {
    for (const key of ['order','state','deadline','quantity','demand','history','dish','detail','money','reputation','preview','result']) assert.ok(typeof state.displayedOrders?.[key] === 'string' && state.displayedOrders[key].trim(),key+' visible order feedback');
    assert.ok(visibleNumber(state.displayedOrders.money,orders.money),'money Label must show actual current money');
    for (const value of Object.values(orders.reputation)) if (typeof value === 'number') assert.ok(visibleNumber(state.displayedOrders.reputation,value),'reputation Label must show actual current values');
    const order=orders.orderOptions.find(item=>item.id===orders.selectedOrderId);
    if(order){
      assert.equal(state.displayedOrders.state,'状态：'+(ORDER_STATUS_LABELS[order.status]??order.status),'visible order state must match actual public status');
      assert.ok(visibleNumber(state.displayedOrders.quantity,order.quantity_required.amount));assert.ok(visibleNumber(state.displayedOrders.quantity,order.base_reward));assert.match(state.displayedOrders.quantity,/仅参考/);
      if(order.minutes_until_deadline!==null){assert.ok(visibleNumber(state.displayedOrders.deadline,Math.abs(order.minutes_until_deadline),'分钟'));assert.match(state.displayedOrders.deadline,order.minutes_until_deadline<0?/已超时/:/剩余/,'deadline wording must agree with signed actual remaining time');assert.doesNotMatch(state.displayedOrders.deadline,order.minutes_until_deadline<0?/剩余/:/已超时/);}
      if(order.demand){assert.match(state.displayedOrders.demand,/硬要求/);assert.match(state.displayedOrders.demand,/偏好（非硬门槛）/);assert.ok(visibleNumber(state.displayedOrders.demand,order.demand.match_threshold));}
      if(order.result_summary)assert.ok(visibleNumber(state.displayedOrders.history,order.result_summary.reward_final));
    }
  }
  return orders;
}
function assertOrdersWorldUnchanged(before,after){
  assertCookingWorldUnchanged(before,after);
  for(const key of [...ORDER_COLLECTIONS,'money','reputation'])assert.deepEqual(after.orders[key],before.orders[key],'order local/preview/refusal preserves '+key);
}
export function assertLocalOrderObservation(observation,expected={}){
  assertInputObservation(observation);assertOrdersProjection(observation.before);const after=assertOrdersProjection(observation.after);
  assert.deepEqual(observation.after.operation,observation.before.operation);assertOrdersWorldUnchanged(observation.before,observation.after);
  if(expected.panel!==undefined)assert.equal(observation.after.panel,expected.panel);else assert.equal(after[expected.key],expected.value);
  assert.equal(after.preview,null);assert.equal(after.result,null);assert.equal(after.canSubmit,false);
}
export function assertOrderDisabledObservation(observation,button){
  assertInputObservation(observation,0);const before=assertOrdersProjection(observation.before);assertOrdersProjection(observation.after);
  assert.equal(before[button==='OrderPreview'?'canPreview':'canSubmit'],false);assert.equal(observation.layout.buttonInteractable,false);
  assert.deepEqual(observation.after.operation,observation.before.operation);assertOrdersWorldUnchanged(observation.before,observation.after);
}
export function assertOrderPreviewObservation(observation,{statusCode='OK_DEMAND_ACCEPTED'}={}){
  const success=statusCode==='OK_DEMAND_ACCEPTED';
  assertUiCommandObservation(observation,{name:'menu_preview',status:success?'completed':'failed',timeLabel:observation.before.timeLabel,errorMessage:success?null:statusCode});
  assertOrdersProjection(observation.before);const after=assertOrdersProjection(observation.after);assertOrdersWorldUnchanged(observation.before,observation.after);
  assert.deepEqual(after.preview,{success,statusCode});assert.equal(after.canSubmit,success);assert.equal(after.result,null);
}
export function assertOrderConfirmObservation(observation,expected={}){
  assertUiCommandObservation(observation,{name:'menu_confirm',status:'completed',timeLabel:observation.before.timeLabel});
  const before=assertOrdersProjection(observation.before),after=assertOrdersProjection(observation.after),result=after.result;
  assert.equal(before.canSubmit,true);assert.ok(result);assert.equal(result.orderId,before.selectedOrderId);assert.equal(result.dishLotId,before.selectedDishId);
  const oldOrder=before.orderOptions.find(item=>item.id===result.orderId),order=after.orderOptions.find(item=>item.id===result.orderId),dish=before.dishOptions.find(item=>item.id===result.dishLotId);
  assert.ok(oldOrder?.enabled && oldOrder.status==='available' && oldOrder.minutes_until_deadline>=0 && dish);assert.equal(order.status,'completed');assert.equal(order.enabled,false);
  assert.deepEqual(order.submitted_object_refs,[{object_type:'DishLot',object_id:dish.id}]);assert.equal(order.result_summary.result_key,'OK_DEMAND_ACCEPTED');
  assert.equal(order.result_summary.submitted_count,dish.serving_count);assert.equal(result.servingCount,dish.serving_count);assert.equal(result.matchScore,order.result_summary.match_score);
  assert.equal(result.rewardMoney,order.result_summary.reward_final);assert.equal(after.money-before.money,result.rewardMoney);assert.equal(result.moneyAfter,after.money);
  assert.deepEqual(after.dishOptions,before.dishOptions.filter(item=>item.id!==dish.id),'only the selected whole DishLot is removed');
  for(const item of before.orderOptions.filter(item=>item.id!==order.id))assert.deepEqual(after.orderOptions.find(next=>next.id===item.id),item);
  const changes={};for(const key of new Set([...Object.keys(before.reputation),...Object.keys(after.reputation)])){const a=Number(before.reputation[key]??0),b=Number(after.reputation[key]??0);if(a!==b)changes[key]=b-a;}
  assert.deepEqual(result.reputationDelta,changes);
  if(expected.rewardMoney!==undefined)assert.equal(result.rewardMoney,expected.rewardMoney,'canonical real-dish settlement reward');
  if(expected.reputationDelta!==undefined)assert.deepEqual(changes,expected.reputationDelta,'canonical actual reputation change');
  assert.deepEqual(observation.after.inventory.lotOptions,observation.before.inventory.lotOptions);assert.deepEqual(observation.after.farming.materialOptions,observation.before.farming.materialOptions);
  for(const target of observation.before.inventory.targetOptions){const current=observation.after.inventory.targetOptions.find(item=>item.id===target.id);assert.ok(current);if(target.id===dish.storage_ref.container_id)assert.ok(current.used_capacity<target.used_capacity);else assert.deepEqual(current,target);}
  assert.equal(after.preview,null);assert.equal(after.canSubmit,false);assert.equal(after.selectedDishId,null);assert.match(observation.after.displayedOperation,/订单.*完成/);
  const visibleResult=observation.after.displayedOrders.result;
  assert.ok(visibleNumber(visibleResult,result.rewardMoney));assert.ok(visibleNumber(visibleResult,result.servingCount,'份'));
  assert.match(visibleResult,new RegExp('匹配\\s*'+escapePattern(result.matchScore)+'(?![\\d.])'),'visible match score must equal this actual settlement');
  const visibleReputation=visibleResult.match(/声望(?:变化)?[：:]?\s*([+-]?\d+(?:\.\d+)?(?:\/[+-]?\d+(?:\.\d+)?)*)/);
  const actualReputation=Object.values(result.reputationDelta).map(value=>(value>=0?'+':'')+value).join('/')||'0';
  assert.ok(visibleReputation,'visible settlement must include this actual reputation change');
  assert.equal(visibleReputation[1],actualReputation,'visible reputation change must equal this actual settlement');
  return result;
}
export function assertOrderLoadRecovery(saved,loaded){
  assertUiCommandObservation(loaded,{name:'load',status:'completed',timeLabel:saved.timeLabel});const after=assertOrdersProjection(loaded.after);
  for(const key of [...ORDER_COLLECTIONS,'money','reputation'])assert.deepEqual(after[key],saved.orders[key]);
  for(const key of INVENTORY_COLLECTIONS)assert.deepEqual(loaded.after.inventory[key],saved.inventory[key]);
  assert.equal(after.preview,null);assert.equal(after.result,null);assert.equal(after.canSubmit,false);
}
export function assertOrderSerializedSettlement(beforeRaw,afterRaw,selected,physicalPolicies=null){
  const before=JSON.parse(beforeRaw),after=JSON.parse(afterRaw);const dish=before.dish_lots.find(item=>item.dish_lot_id===selected.dishLotId);assert.ok(dish);
  assert.deepEqual(after.dish_lots,before.dish_lots.filter(item=>item.dish_lot_id!==dish.dish_lot_id));
  assert.equal(after.storage_containers.some(container=>container.active_object_refs.some(ref=>ref.object_type==='DishLot'&&ref.object_id===dish.dish_lot_id)),false);
  let physicalDelta=null;
  if(before.physical_capacity_policy_id!==undefined){
    assert.equal(after.physical_capacity_policy_id,before.physical_capacity_policy_id);
    const policy=physicalPolicies?.policies?.find(item=>item.id===before.physical_capacity_policy_id);assert.ok(policy,'physical settlement requires the verified candidate policy');
    const rule=policy.rules.find(item=>item.kind==='DishLot'&&item.definition_id===dish.recognized_dish_id&&item.form===dish.storage_form&&item.quantity_unit===dish.total_quantity.unit);assert.ok(rule,'selected dish requires an exact physical rule');
    const amount=dish.total_quantity.amount;
    const mass=amount*rule.mass_mg_per_unit.numerator/rule.mass_mg_per_unit.denominator;
    const volume=amount*rule.volume_ul_per_unit.numerator/rule.volume_ul_per_unit.denominator;
    assert.ok(Number.isSafeInteger(mass)&&mass>0&&Number.isSafeInteger(volume)&&volume>0,'this settlement case must have exact integer milligram/microlitre contributions');
    physicalDelta={mass_g:mass,volume_ml:volume};
  }
  assert.deepEqual(after.storage_containers,before.storage_containers.map(old=>{
    if(old.container_id!==dish.storage_ref.container_id)return old;
    const expected={...old,used_capacity:old.used_capacity-dish.storage_footprint.amount,active_object_refs:old.active_object_refs.filter(ref=>ref.object_type!=='DishLot'||ref.object_id!==dish.dish_lot_id)};
    if(physicalDelta){assert.ok(old.used_capacity_limits);expected.used_capacity_limits=Object.fromEntries(Object.entries(physicalDelta).map(([key,delta])=>{
      const beforeMilli=old.used_capacity_limits[key]*1000;assert.ok(Number.isFinite(beforeMilli)&&Math.abs(beforeMilli-Math.round(beforeMilli))<1e-6);
      return [key,(Math.round(beforeMilli)-delta)/1000];
    }));}
    return expected;
  }),'serialized settlement changes exactly the selected dish storage reference, slot and physical footprints');
  assert.equal(after.orders.find(item=>item.order_id===selected.orderId).status,'completed');assert.equal(after.player_state.money-before.player_state.money,selected.rewardMoney);
}

// Cross-step recovery checks consume detached observations and opaque saved bytes only.
const RECOVERY_COLLECTIONS = {
  farming: FARMING_COLLECTIONS, inventory: INVENTORY_COLLECTIONS, processing: PROCESSING_COLLECTIONS,
  cooking: COOKING_COLLECTIONS, orders: [...ORDER_COLLECTIONS, 'money', 'reputation']
};
const RECOVERY_ENTITY_ARRAYS = {
  inventory: ['lot_id', 'MaterialLot'], crop_instances: ['crop_id', 'CropInstance'], processing_tasks: ['task_id', 'ProcessingTask'],
  dish_lots: ['dish_lot_id', 'DishLot'], orders: ['order_id', 'Order'], reservations: ['reservation_id', 'Reservation'],
  fields: ['field_plot_id', 'FieldPlot'], storage_containers: ['container_id', 'StorageContainer']
};
export const CROSS_STEP_POINTS = ['growing', 'processing', 'ready', 'dish', 'completed'];
export const CROSS_STEP_REQUIRED_ACTIONS = {
  growing: ['advance_time', 'harvest_crop', 'store_item', 'split_lot', 'start_processing', 'collect_processing_result', 'cook_dish', 'submit_order', 'plant_crop'],
  processing: ['advance_time', 'collect_processing_result', 'start_processing'], ready: ['collect_processing_result', 'start_processing'],
  dish: ['submit_order', 'plant_crop'], completed: ['plant_crop', 'split_lot']
};

export function crossStepWorld(state) {
  const world = { timeLabel: state.timeLabel };
  for (const [section, keys] of Object.entries(RECOVERY_COLLECTIONS)) {
    assert.ok(state[section] && typeof state[section] === 'object', 'recovery needs the public ' + section + ' projection');
    world[section] = {};
    for (const key of keys) {
      const value = state[section][key];
      if (!['money', 'reputation'].includes(key)) assert.ok(Array.isArray(value), section + '.' + key + ' must be a public list');
      else assert.ok(value !== undefined, 'recovery needs actual ' + key);
      world[section][key] = structuredClone(value);
    }
  }
  return world;
}

export function assertCrossStepFreshRecovery(evidence) {
  assertLocalSaveRecovery(evidence);
  assert.equal(evidence.documentFresh, true, 'recovery must create a new document/session');
  assert.deepEqual(crossStepWorld(evidence.loaded.after), crossStepWorld(evidence.savedState), 'fresh load must restore every public world collection and the actual economy');
  const after = evidence.loaded.after;
  for (const [section, keys] of Object.entries({
    farming: ['selectedFieldId','selectedSeedId','selectedCropId'], inventory: ['selectedLotId','selectedTargetId','splitPreview','splitResult'],
    processing: ['selectedMethodId','selectedRequirementIndex','selectedFacilityId','selectedTaskId','preview','startResult','collectResult'],
    cooking: ['selectedRecipeId','selectedRole','selectedTargetId','heatLevel','preview','result'], orders: ['selectedOrderId','selectedDishId','preview','result']
  })) for (const key of keys) assert.equal(after[section][key], null, 'fresh load must not import old local ' + section + '.' + key);
  for (const section of ['processing', 'cooking']) assert.deepEqual(after[section].inputSelections, [], 'fresh load must not resurrect local material selections');
  for (const [section, keys] of Object.entries({ farming:['canPlant','canHarvest'], inventory:['canMove','canConfirmSplit'], processing:['canPreview','canStart','canCollect'], cooking:['canPreview','canCook'], orders:['canPreview','canSubmit'] }))
    for (const key of keys) assert.equal(after[section][key], false, 'fresh load must require explicit current selections before ' + key);
  assert.match(after.displayedOperation, /已恢复本地存档/);
}

function recoverySave(raw) {
  assert.ok(typeof raw === 'string' && raw.length > 0, 'a complete opaque SaveFile is required');
  const save = JSON.parse(raw);
  assert.ok(save && typeof save === 'object' && !Array.isArray(save));
  assert.ok(Number.isFinite(save.world_time?.absolute_minute), 'the complete save must include actual world time');
  assert.ok(save.player_state && typeof save.player_state === 'object');
  const seen = new Set();
  for (const [key, [identity]] of Object.entries(RECOVERY_ENTITY_ARRAYS)) {
    assert.ok(Array.isArray(save[key]), 'complete recovery evidence must include ' + key);
    for (const entity of save[key]) {
      const id = entity[identity];
      assert.ok(typeof id === 'string' && id.length > 0, key + ' must retain its actual identity');
      assert.ok(!seen.has(id), 'full save must not contain duplicate entity identities: ' + id);
      seen.add(id);
    }
  }
  return save;
}

export function assertCrossStepSerialization(saved, reserialized) {
  assertStoredSaveUnchanged(saved, reserialized);
  recoverySave(saved.raw); recoverySave(reserialized.raw);
}

export function assertCrossStepCheckpoint(point, state, stored) {
  assert.ok(CROSS_STEP_POINTS.includes(point));
  const save = recoverySave(stored.raw);
  assert.equal(timeInMinutes(state.timeLabel) - 1440, save.world_time.absolute_minute);
  assert.equal(state.orders.money, save.player_state.money);
  for (const [rawKey, section, optionKey, identity] of [
    ['inventory','inventory','lotOptions','lot_id'], ['processing_tasks','processing','taskOptions','task_id'],
    ['dish_lots','cooking','dishOptions','dish_lot_id'], ['orders','orders','orderOptions','order_id']
  ]) {
    const actual = state[section][optionKey];
    assert.deepEqual(actual.map(item => item.id).sort(), save[rawKey].map(item => item[identity]).sort(), 'saved and public ' + rawKey + ' identities must agree');
    for (const item of actual) {
      const entity = save[rawKey].find(value => value[identity] === item.id);
      for (const key of ['quantity','current_form','storage_ref','status','serving_count','result_summary','submitted_object_refs'])
        if (key in item && key in entity) assert.deepEqual(item[key], entity[key], 'saved and public ' + rawKey + ' must agree on ' + key);
    }
  }
  if (point === 'growing') {
    assert.ok(save.crop_instances.some(crop => crop.lifecycle_status === 'active'));
    assert.equal(state.farming.harvestableOptions.length, 0);
    assert.ok(state.farming.fieldOptions.some(field => field.occupied_tiles > 0));
  } else if (point === 'processing' || point === 'ready') {
    const expected = point === 'processing' ? 'active' : 'ready_to_collect';
    assert.ok(save.processing_tasks.some(task => task.status === expected), 'checkpoint must contain a real ' + expected + ' task');
  } else if (point === 'dish') {
    assert.ok(save.dish_lots.length > 0, 'dish checkpoint requires an actual saved dish');
    assert.ok(state.orders.orderOptions.some(order => order.enabled && order.minutes_until_deadline >= 0));
  } else {
    assert.ok(save.orders.some(order => order.status === 'completed' && Number.isFinite(order.result_summary?.reward_final)), 'completed checkpoint requires actual settlement history');
    assert.equal(state.orders.result, null, 'a saved history must not retain a current UI settlement');
  }
  return save;
}

export function assertCrossStepFailureObservation(observation, expected) {
  assert.equal(expected.status, 'failed');
  assertUiCommandObservation(observation, expected);
  assert.deepEqual(crossStepWorld(observation.after), crossStepWorld(observation.before), 'failed storage/load must preserve the entire healthy public world');
  assert.equal(observation.after.hasSession, true);
  assert.match(observation.after.displayedOperation, /操作未完成/);
  for (const [section, keys] of Object.entries({inventory:['splitPreview','splitResult'],processing:['preview','startResult','collectResult'],cooking:['preview','result'],orders:['preview','result']}))
    for (const key of keys) assert.equal(observation.after[section][key], null, 'a failed load cannot publish stale success: ' + section + '.' + key);
}

const RECOVERY_BUTTON_ACTIONS = {
  AdvanceOneHour:'advance_time', AdvanceOneDay:'advance_time', PlantCrop:'plant_crop', HarvestCrop:'harvest_crop', MoveInventoryLot:'store_item',
  SplitConfirm:'split_lot', StartProcessing:'start_processing', CollectProcessing:'collect_processing_result', CookDish:'cook_dish', SubmitOrder:'submit_order'
};
export function assertCrossStepContinuation(point, savedState, actions, finalState) {
  assert.ok(CROSS_STEP_POINTS.includes(point));
  assert.ok(Array.isArray(actions) && actions.length > 0, 'recovery must actually continue through player actions');
  let previous = savedState;
  const created = [];
  for (const { actionType, observation } of actions) {
    assert.equal(RECOVERY_BUTTON_ACTIONS[observation.buttonName], actionType, 'recorded action must belong to its actual physical control');
    assert.deepEqual(crossStepWorld(observation.before), crossStepWorld(previous), 'actual continuation must not skip a world mutation or healthy reload');
    const expected = { actionType, status:'completed', timeLabel:observation.after.timeLabel };
    if (['plant_crop','harvest_crop'].includes(actionType) || observation.buttonName === 'AdvanceOneDay') assertFarmingCommandObservation(observation, expected);
    else if (actionType === 'advance_time') { assertClickObservation(observation); assertUiCommandObservation(observation,{name:'menu_confirm',status:'completed',timeLabel:observation.after.timeLabel}); }
    else if (actionType === 'store_item') assertInventoryCommandObservation(observation, {status:'completed',timeLabel:observation.before.timeLabel});
    else if (actionType === 'split_lot') assertSplitConfirmObservation(observation, {amount:Number(observation.before.inventory.splitQuantityText)});
    else if (actionType === 'start_processing') assertProcessingStartObservation(observation);
    else if (actionType === 'collect_processing_result') assertProcessingCollectObservation(observation);
    else if (actionType === 'cook_dish') assertCookingConfirmObservation(observation);
    else if (actionType === 'submit_order') assertOrderConfirmObservation(observation, {rewardMoney:37,reputationDelta:{west_market_tavern:1}});
    for (const [section, key, kind] of [['inventory','lotOptions','MaterialLot'],['processing','taskOptions','ProcessingTask'],['cooking','dishOptions','DishLot']]) {
      const oldIds = new Set(observation.before[section][key].map(item => item.id));
      for (const item of observation.after[section][key].filter(item => !oldIds.has(item.id))) created.push({kind,id:item.id});
    }
    previous = observation.after;
  }
  assert.deepEqual(crossStepWorld(finalState), crossStepWorld(previous), 'the final world must be the actual last continuation result');
  const performed = new Set(actions.map(item => item.actionType));
  for (const action of CROSS_STEP_REQUIRED_ACTIONS[point]) assert.ok(performed.has(action), point + ' must actually continue ' + action);
  if (point === 'processing' || point === 'ready') {
    const collect = actions.findIndex(item => item.actionType === 'collect_processing_result');
    const start = actions.findIndex(item => item.actionType === 'start_processing');
    assert.ok(collect >= 0 && start > collect, 'restored processing must be collected before a new task is started');
  }
  if (point === 'completed') {
    assert.equal(finalState.orders.money, savedState.orders.money, 'completed history must not reward again');
    assert.deepEqual(finalState.orders.reputation, savedState.orders.reputation);
    assert.deepEqual(finalState.orders.orderOptions, savedState.orders.orderOptions);
  }
  assert.equal(new Set(created.map(item => item.id)).size, created.length, 'newly created identities must not be reused within continuation');
  return {performedActions:[...performed],created};
}

function recoverySavedStrings(save) {
  const strings = new Set();
  const visit = value => {
    if (typeof value === 'string') strings.add(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') for (const [key,item] of Object.entries(value)) { strings.add(key); visit(item); }
  };
  visit(save); return strings;
}

export function assertCrossStepObservedIds(saved, created) {
  const oldStrings = recoverySavedStrings(recoverySave(saved.raw));
  assert.ok(Array.isArray(created));
  assert.equal(new Set(created.map(item=>item.id)).size,created.length,'observed creation IDs cannot be duplicated');
  for (const item of created) {
    assert.ok(['MaterialLot','ProcessingTask','DishLot'].includes(item.kind));
    assert.ok(typeof item.id==='string'&&item.id.length>0);
    assert.ok(!oldStrings.has(item.id),'public creation must not reuse any saved identity or historical reference: '+item.id);
  }
  return structuredClone(created);
}

export function assertCrossStepCreatedIds(saved, finalStored, created) {
  const before = recoverySave(saved.raw), after = recoverySave(finalStored.raw);
  assertCrossStepObservedIds(saved,created);
  const oldStrings = recoverySavedStrings(before), afterStrings = recoverySavedStrings(after), actualKinds = new Map();
  for (const [key,[identity,kind]] of Object.entries(RECOVERY_ENTITY_ARRAYS)) for (const item of after[key]) actualKinds.set(item[identity],kind);
  for (const item of created) {
    assert.ok(afterStrings.has(item.id),'claimed creation must survive in the full save as an entity or retained historical reference: '+item.id);
    if(actualKinds.has(item.id))assert.equal(item.kind,actualKinds.get(item.id),'current saved entity must match its observed creation kind');
  }
  const allNew = new Map(created.map(item => [item.id,item.kind]));
  for (const [key,[identity,kind]] of Object.entries(RECOVERY_ENTITY_ARRAYS)) {
    const oldIds = new Set(before[key].map(item => item[identity]));
    for (const item of after[key]) if (!oldIds.has(item[identity])) allNew.set(item[identity],kind);
  }
  assert.ok(allNew.size > 0, 'a recovered session must really create new identities');
  for (const id of allNew.keys()) assert.ok(!oldStrings.has(id), 'new identity must not reuse any saved identity or historical reference: ' + id);
  assert.ok([...allNew.values()].includes('CropInstance') || [...allNew.values()].includes('ProcessingTask'), 'recovered continuation must allocate a crop or processing task');
  return [...allNew].map(([id,kind]) => ({kind,id}));
}

export function crossStepActionObservations(clicks) {
  const actions = [];
  for (const observation of clicks) {
    const actionType = RECOVERY_BUTTON_ACTIONS[observation.buttonName];
    if (!actionType) {
      if (observation.after.operation.sequence !== observation.before.operation.sequence)
        assert.equal(observation.after.operation.name, 'menu_preview', 'continuation must not hide a save, load or unrecorded formal command');
      continue;
    }
    if (observation.eventCount === 0) {
      assertInputObservation(observation, 0);
      assert.equal(observation.layout.buttonInteractable, false, 'only a verified disabled control may be omitted from actual Action records');
      assert.deepEqual(observation.after.operation, observation.before.operation, 'disabled attempts must not dispatch commands');
      assert.deepEqual(crossStepWorld(observation.after), crossStepWorld(observation.before), 'disabled attempts must preserve the world');
      continue;
    }
    assert.equal(observation.eventCount, 1, 'actual actions must emit exactly one physical event');
    assert.equal(observation.after.operation.sequence, observation.before.operation.sequence + 1);
    assert.equal(observation.after.operation.name, 'menu_confirm');
    assert.equal(observation.after.operation.status, 'completed', 'a real failed Action must fail verification rather than be silently filtered');
    actions.push({actionType,observation});
  }
  return actions;
}

// Dedicated touch evidence never weakens the mouse geometry/scroll assertions above.
export function assertTouchSpatialLayout(layout) {
  const { viewport, canvas, button, clip, target, fontSizes, overlappingButtons } = layout;
  const inside = (a, b) => a.left >= b.left - 1e-4 && a.top >= b.top - 1e-4
    && a.right <= b.right + 1e-4 && a.bottom <= b.bottom + 1e-4;
  const screen = { left: 0, top: 0, right: viewport.width, bottom: viewport.height };
  for (const rectangle of [canvas, button, clip]) {
    for (const key of ['left','top','right','bottom','width','height']) assert.ok(Number.isFinite(rectangle[key]), 'touch geometry must be finite');
    assert.ok(rectangle.width > 0 && rectangle.height > 0);
    assert.ok(Math.abs(rectangle.width-(rectangle.right-rectangle.left)) < 1e-4
      && Math.abs(rectangle.height-(rectangle.bottom-rectangle.top)) < 1e-4, 'CSS dimensions must match actual edges');
  }
  assert.ok(inside(canvas, screen), 'actual touch Canvas must fit the browser viewport');
  assert.ok(inside(clip, canvas), 'actual ancestor Mask clip must fit the Canvas');
  assert.ok(inside(button, clip), 'touch target must be completely revealed inside its actual Mask');
  assert.ok(button.width >= 44-1e-4 && button.height >= 44-1e-4, 'touch hit area must be at least 44 CSS pixels');
  assert.ok(target.x > button.left && target.x < button.right && target.y > button.top && target.y < button.bottom);
  assert.ok(Array.isArray(fontSizes) && fontSizes.length > 0 && fontSizes.every(size => Number.isFinite(size) && size >= 14-1e-4), 'visible control text must be at least 14 CSS pixels');
  assert.deepEqual(overlappingButtons, [], 'another active Button must not cover the physical target');
}

function assertTrustedTouchPath(observation, finalType) {
  assert.equal(observation.pointerSource, 'cdp-touch');
  const events = observation.nativeEvents;
  assert.ok(Array.isArray(events) && events.length >= 2, 'actual native touch events must be observed');
  assert.equal(events[0].type, 'touchstart');
  assert.equal(events.at(-1).type, finalType);
  assert.equal(events.filter(event => event.type === 'touchstart').length, 1);
  assert.equal(events.filter(event => event.type === finalType).length, 1);
  assert.ok(events.every(event => event.isTrusted === true && event.target === 'GameCanvas'), 'touch proof must come from trusted Canvas input');
  assert.ok(events.every(event => ['touchstart','touchmove','touchend','touchcancel'].includes(event.type)), 'only actual touch event types may prove a gesture');
  assert.ok(events.every(event => Number.isFinite(event.x) && Number.isFinite(event.y)));
  assert.ok(Number.isSafeInteger(events[0].identifier) && events.every(event => event.identifier === events[0].identifier), 'a single-finger gesture must retain its native identifier');
  assert.ok(events.every(event => event.activeTouches === (event.type === 'touchend' || event.type === 'touchcancel' ? 0 : 1)), 'native touch counts must describe one finger and a released final state');
  const origin = observation.path?.from ?? observation.layout?.target;
  assert.ok(origin && Math.abs(events[0].x-origin.x)<=1 && Math.abs(events[0].y-origin.y)<=1, 'native touch start must match the actual physical target');
  const endpoint = observation.path?.to ?? origin;
  assert.ok(Math.abs(events.at(-1).x-endpoint.x)<=1 && Math.abs(events.at(-1).y-endpoint.y)<=1, 'native touch end must match its physical path');
  assert.deepEqual(observation.scrollDown, observation.scrollBefore, 'native touch must not scroll the document');
  assert.deepEqual(observation.scrollAfter, observation.scrollBefore, 'native touch must leave document origin fixed');
  assert.equal(observation.pressEventCount, 0, 'touch down alone must not click');
  assert.deepEqual(observation.pressed.operation, observation.before.operation, 'touch down must not submit');
  assert.deepEqual(crossStepWorld(observation.pressed), crossStepWorld(observation.before), 'touch down must preserve the complete public world');
}

export function assertTouchTapObservation(observation, { disabled = false, input = false, command = false, editingOpen = false } = {}) {
  assertTrustedTouchPath(observation, 'touchend');
  assert.equal(observation.nativeEvents.some(event => event.type === 'touchcancel' || event.type === 'touchmove'), false, 'a tap must not be a cancelled or dragged gesture');
  assertTouchSpatialLayout(observation.layout);
  assertInputObservation(observation, disabled || input ? 0 : 1);
  if (!disabled && !input) {
    assert.equal(observation.before.busy, false);
    assert.equal(observation.after.busy, false);
    assert.equal(observation.after.operation.sequence, observation.before.operation.sequence + (command ? 1 : 0), 'a touch must admit exactly its own command, or none for local selection');
    if (!command) {
      assert.deepEqual(observation.after.operation, observation.before.operation);
      assert.deepEqual(crossStepWorld(observation.after), crossStepWorld(observation.before));
    }
  }
  if (disabled) {
    assert.equal(observation.layout.buttonInteractable, false);
    assert.deepEqual(observation.after.operation, observation.before.operation);
    assert.deepEqual(crossStepWorld(observation.after), crossStepWorld(observation.before));
  }
  if (input) {
    assert.deepEqual(observation.after.operation, observation.before.operation);
    assert.deepEqual(crossStepWorld(observation.after), crossStepWorld(observation.before));
    assert.ok(observation.editEvents.began > 0 && observation.editEvents.changed > 0);
    assert.ok(editingOpen ? observation.editEvents.ended === 0 : observation.editEvents.ended > 0, 'focus/blur evidence must match the actually tested editing phase');
    assert.equal(observation.focused.className, 'cocosEditBox');
    assert.equal(observation.focused.value, observation.text);
  }
}

export function assertTouchCancelObservation(observation, { scrolled = false, destroyed = false } = {}) {
  assert.ok(['cancel','dragout','scroll','destroy'].includes(observation.gesture));
  assertTrustedTouchPath(observation, observation.gesture === 'cancel' ? 'touchcancel' : 'touchend');
  assert.equal(observation.eventCount, 0, 'cancelled or scrolling touch must never emit Button CLICK');
  assert.deepEqual(observation.after.operation, observation.before.operation, 'cancelled touch must never submit a UI command');
  if (observation.gesture === 'dragout') {
    const rectangle = observation.layout?.button, first = observation.nativeEvents[0], last = observation.nativeEvents.at(-1);
    assert.ok(rectangle && first.x>rectangle.left && first.x<rectangle.right && first.y>rectangle.top && first.y<rectangle.bottom, 'drag out must start inside the actual original Button');
    assert.ok(observation.nativeEvents.some(event => event.type === 'touchmove'), 'drag out needs actual native motion');
    assert.ok(last.x<rectangle.left || last.x>rectangle.right || last.y<rectangle.top || last.y>rectangle.bottom, 'drag out must actually release outside the original Button');
  }
  if (destroyed) {
    assert.equal(observation.after.phase, 'closed');
    assert.equal(observation.after.hasSession, false);
  } else {
    assert.equal(observation.after.phase, 'ready');
    assert.equal(observation.after.busy, false);
    assert.deepEqual(crossStepWorld(observation.after), crossStepWorld(observation.before));
    assert.deepEqual(observation.after.errors, []);
  }
  if (scrolled) {
    assert.ok(observation.nativeEvents.some(event => event.type === 'touchmove'));
    const first=observation.nativeEvents[0];
    assert.ok(observation.nativeEvents.some(event => event.type==='touchmove' && Math.hypot(event.x-first.x,event.y-first.y)>1), 'a ScrollView gesture needs actual native displacement');
    assert.ok(Math.abs(observation.offsetAfter.y - observation.offsetBefore.y) > 1, 'a claimed ScrollView gesture must really move content');
    if (observation.buttonName) assert.ok(observation.cocosEvents.some(event => event.buttonName === observation.buttonName && event.type === 'cancel'), 'ScrollView drag from a Button must cancel that child in the actual engine');
  }
}

export function assertTouchResizeObservation(observation) {
  assert.equal(observation.identityVerified, true, 'resize must retain observer and Button identities');
  assert.deepEqual(crossStepWorld(observation.after), crossStepWorld(observation.before), 'resize must preserve the complete business world');
  assert.deepEqual(observation.after.operation, observation.before.operation);
  for (const [section,keys] of Object.entries({
    farming:['selectedFieldId','selectedSeedId','selectedCropId','seedAmount','plantingTiles','seedsPerTile','successProbability'],
    inventory:['selectedLotId','selectedTargetId','splitQuantityText'],
    processing:['selectedMethodId','selectedRequirementIndex','selectedFacilityId','selectedTaskId','inputSelections'],
    cooking:['selectedRecipeId','selectedRole','selectedTargetId','heatLevel','activeMinutesText','inputSelections'],
    orders:['selectedOrderId','selectedDishId']
  })) for (const key of keys) assert.deepEqual(observation.after[section][key],observation.before[section][key],'resize must retain public choice/input '+section+'.'+key);
  assert.equal(observation.after.phase, 'ready');
  assert.deepEqual(observation.after.errors, []);
  assert.equal(observation.after.layout.mode, 'compact');
  assert.ok(observation.canvas.width > 0 && observation.canvas.height > 0);
  assert.ok(Math.abs(observation.canvas.left)<=1e-4 && Math.abs(observation.canvas.top)<=1e-4, 'small-screen Canvas must retain the actual frame origin');
  assert.ok(Math.abs(observation.canvas.width - observation.viewport.width) <= 1
    && Math.abs(observation.canvas.height - observation.viewport.height) <= 1, 'resize proof needs actual frame-sized Canvas geometry');
}

export function assertTouchEditDomVisibility(evidence, { focused = false, text } = {}) {
  assert.ok(Array.isArray(evidence.elements), 'actual DOM EditBox elements must be recorded');
  if (focused) {
    assert.equal(evidence.active, true, 'the focused-input scenario must really focus a DOM EditBox');
    assert.equal(evidence.value, text);
    assert.ok(evidence.elements.some(element => element.active && element.visible), 'focused DOM editor must really be visible');
  }
  for (const element of evidence.elements.filter(item => item.visible)) {
    const rectangle = element.rect;
    for (const key of ['left','top','right','bottom','width','height']) assert.ok(Number.isFinite(rectangle[key]));
    // Creator 3.8.8's HTML EditBox applies fixed LEFT_PADDING=2 via style.left;
    // setSize still uses the complete root width/height. This is an SDK model, not a tolerance.
    assert.equal(element.styleLeft,'2px','DOM editor must retain the installed Creator SDK left padding');
    const expected={...evidence.input,left:evidence.input.left+2,right:evidence.input.right+2};
    for(const key of ['left','top','right','bottom','width','height']) assert.ok(Math.abs(rectangle[key]-expected[key])<=1e-4,'DOM editor must exactly match the fixed SDK input geometry: '+key);
    const outer=evidence.clip;
    assert.ok(rectangle.left >= outer.left-1e-4 && rectangle.top >= outer.top-1e-4
      && rectangle.right <= outer.right+1e-4 && rectangle.bottom <= outer.bottom+1e-4, 'visible DOM editing overlay must remain inside its actual Mask, clear of fixed controls');
  }
}

export function assertTouchDomFrameStable(before, after) {
  for (const key of ['x','y','width','height']) assert.equal(after.window[key],before.window[key], 'ordinary desktop keyboard editing must not alter the browser viewport');
  for (const name of ['document','body',...Object.keys(before.elements)]) {
    const a=name==='document'?before.document:name==='body'?before.body:before.elements[name];
    const b=name==='document'?after.document:name==='body'?after.body:after.elements[name];
    for (const key of ['left','top','width','height','scrollLeft','scrollTop']) {
      assert.ok(Number.isFinite(a[key])&&Number.isFinite(b[key]));
      assert.ok(Math.abs(a[key]-b[key])<=1e-4, 'ordinary input must not move or scroll actual DOM frame: '+name+'.'+key);
    }
  }
}

export const NATIVE_CANCEL_DIAGNOSTIC = 'Ignored attempt to cancel a touchcancel event with cancelable=false, for example because scrolling is in progress and cannot be interrupted.';

export function assertTouchBrowserDiagnostics(logs, touch) {
  // Keep the old unexpected-error predicate. Only the deliberately exercised native
  // cancel has one fixed SDK/Chrome diagnostic, backed by actual healthy recovery.
  const unexpected=logs.filter(entry=>entry.type==='pageerror'||(entry.type==='error'&&entry.caseName!=='missing-resource'));
  const expected=logs.filter(entry=>entry.type==='error'&&entry.text===NATIVE_CANCEL_DIAGNOSTIC);
  assert.equal(expected.length,1,'controlled native cancel must have exactly its one observed SDK diagnostic');
  assert.equal(expected[0].caseName,'touch-native-cancel','the SDK cancel diagnostic is forbidden in ordinary input or another case');
  assert.ok(touch?.cancelled);assert.equal(touch.cancelled.caseName,'touch-native-cancel');
  assertTouchCancelObservation(touch.cancelled);
  assert.equal(touch.cancelled.nativeEvents.at(-1).cancelable,false,'the diagnostic needs an actual trusted non-cancelable native cancel');
  const one=suffix=>{const matches=touch.clicks.filter(item=>item.caseName.endsWith(suffix));assert.equal(matches.length,1,'one actual recovery observation '+suffix);return matches[0];};
  const saved=one('-cancel-baseline-save'),advance=one('-cancel-recovery-advance'),loaded=one('-cancel-recovery-load');
  for(const observation of [saved,advance,loaded])assertTouchTapObservation(observation,{command:true});
  assertUiCommandObservation(saved,{name:'save',status:'completed',timeLabel:saved.before.timeLabel});
  assertClickObservation(advance);assertUiCommandObservation(advance,{name:'menu_confirm',status:'completed',timeLabel:advance.after.timeLabel});
  assertUiCommandObservation(loaded,{name:'load',status:'completed',timeLabel:saved.after.timeLabel});
  assert.deepEqual(crossStepWorld(saved.before),crossStepWorld(touch.cancelled.after),'recovery must continue the cancelled gesture\'s healthy world');
  assert.deepEqual(saved.before.operation,touch.cancelled.after.operation);
  assert.deepEqual(crossStepWorld(advance.before),crossStepWorld(saved.after));
  assert.deepEqual(crossStepWorld(loaded.after),crossStepWorld(saved.after),'actual save/load recovery must restore the complete healthy world');
  assert.deepEqual(unexpected.filter(entry=>!expected.includes(entry)),[],'every other browser error remains unexpected');
  return expected;
}
