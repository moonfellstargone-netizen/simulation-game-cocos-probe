import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseServeArgs, startWebProbeServer } from '../tools/cocos-probe/serve.mjs';
import { capturePreparedSurface, serveWebProbe, sha256, webTreeDigest, within } from '../tools/cocos-probe/lib/webProbeSupport.mjs';

function fixture(t) {
  const temporary = mkdtempSync(join(tmpdir(), 'cocos-web-serve-'));
  t.after(() => {
    assert.ok(within(realpathSync(tmpdir()), realpathSync(temporary)));
    rmSync(temporary, { recursive: true, force: true });
  });
  const project = join(temporary, 'project');
  mkdirSync(join(project, 'build/web-desktop'), { recursive: true });
  writeFileSync(join(project, 'source.txt'), 'prepared');
  writeFileSync(join(project, 'build/web-desktop/index.html'), '<html>fixed origin</html>');
  const manifest = { format: 'cocos-probe-source/v1', sourceCommit: 'b'.repeat(40), sourceDirty: false, creatorVersion: '3.8.8', outputs: { 'source.txt': { sha256: sha256('prepared') } } };
  const bytes = JSON.stringify(manifest);
  writeFileSync(join(project, 'probe-source-manifest.json'), bytes);
  const buildRecord = join(temporary, 'build.json');
  writeFileSync(buildRecord, JSON.stringify({ passed: true, creatorExitCode: 36, preparedManifestSha256: sha256(bytes), projectDir: project, sourceCommit: manifest.sourceCommit, sourceDirty: false, creatorVersion: manifest.creatorVersion, preparedSurfaceAfter: capturePreparedSurface(project, manifest), creatorNormalizations: [], webBuild: webTreeDigest(join(project, 'build/web-desktop')) }));
  return { project, buildRecord };
}

async function unusedPort() {
  const server = createServer();
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
  const port = server.address().port;
  await new Promise((accept, reject) => server.close((error) => error ? reject(error) : accept()));
  return port;
}

test('manual Web server requires explicit absolute source paths and a fixed port', () => {
  const valid = ['--project', resolve('project'), '--build-record', resolve('build.json'), '--port', '8088'];
  assert.equal(parseServeArgs(valid).port, 8088);
  for (const args of [[], valid.slice(0, -2), [...valid, '--port', '8089'], [...valid, '--host', '0.0.0.0'], ['--project', 'relative', ...valid.slice(2)]]) {
    assert.throws(() => parseServeArgs(args), /ERR_WEB_SERVE_/);
  }
  for (const port of ['0', '-1', '65536', '8088.1', '8e3', 'NaN']) {
    assert.throws(() => parseServeArgs([...valid.slice(0, -1), port]), /ERR_WEB_SERVE_FIXED_PORT_REQUIRED/);
  }
  const result = spawnSync(process.execPath, ['tools/cocos-probe/serve.mjs'], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ERR_WEB_SERVE_/);
});

test('manual server restarts at the same origin and rejects occupied ports without fallback', async (t) => {
  const input = { ...fixture(t), port: await unusedPort() };
  let first = await startWebProbeServer(input);
  try {
    assert.equal(first.url, `http://127.0.0.1:${input.port}/`);
    const response = await fetch(first.url);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(await response.text(), '<html>fixed origin</html>');
    await assert.rejects(startWebProbeServer(input), { code: 'EADDRINUSE' });
  } finally { await first.close(); }
  first = await startWebProbeServer(input);
  try { assert.equal(first.url, `http://127.0.0.1:${input.port}/`); }
  finally { await first.close(); }
});

test('manual server rejects changed build bytes before listening', async (t) => {
  const input = { ...fixture(t), port: await unusedPort() };
  writeFileSync(join(input.project, 'build/web-desktop/index.html'), '<html>changed</html>');
  await assert.rejects(startWebProbeServer(input), /ERR_WEB_PROBE_BUILD_CONTENT_CHANGED/);
});

test('shared HTTP helper rejects invalid ports while preserving random-port verification', async (t) => {
  const input = fixture(t);
  for (const port of [-1, 65536, 2.5, '8088', NaN]) {
    await assert.rejects(serveWebProbe(join(input.project, 'build/web-desktop'), { port }), /ERR_WEB_PROBE_PORT/);
  }
  const server = await serveWebProbe(join(input.project, 'build/web-desktop'));
  try { assert.match(server.url, /^http:\/\/127\.0\.0\.1:[1-9]\d*\/$/); }
  finally { await server.close(); }
});
