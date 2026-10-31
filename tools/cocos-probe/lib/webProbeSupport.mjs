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

export async function serveWebProbe(directory) {
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
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
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
  assert.equal(after.operation.errorMessage, expected.errorMessage ?? null, 'old errors must not contaminate the current command');
  // Public labels use day 1 for absolute minute 0; save/load summaries use absolute minutes.
  const worldMinute = expected.status === 'completed' && expected.name !== 'menu_confirm'
    ? timeInMinutes(expected.timeLabel) - 1440 : null;
  assert.equal(after.operation.worldMinute, worldMinute, 'save/load summary must match the resulting public time without stale success data');
}
