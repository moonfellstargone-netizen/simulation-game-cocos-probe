import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { assertClickObservation, capturePreparedSurface, checkPreparedSurfaceAfterBuild, createWebReportDirectory, parseWebProbeArgs, readWebProbeSource, resizeViewports, serveWebProbe, sha256, timeInMinutes, webTreeDigest, within } from '../tools/cocos-probe/lib/webProbeSupport.mjs';
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
