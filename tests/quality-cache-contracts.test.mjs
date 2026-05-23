import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createQualityCacheKey, isCacheAllowedForGate, QUALITY_CACHE_DIR } from '../tools/quality/cache/qualityCache.mjs';

const root = process.cwd();
const readJson = (rel) => JSON.parse(readFileSync(join(root, rel), 'utf8'));
const policy = readJson('tools/quality/gate-policy.json');
const registry = readJson('tools/quality/test-registry.json');

test('cache probe is local, temporary, and excluded from release', () => {
  assert.equal(QUALITY_CACHE_DIR, '.cache/quality');
  assert.equal(existsSync(join(root, 'tools/quality/cache/qualityCache.mjs')), true);
  const gitignore = readFileSync(join(root, '.gitignore'), 'utf8');
  assert.ok(gitignore.includes('.cache/'));
  const builder = readFileSync(join(root, 'tools/build_release_package.py'), 'utf8');
  const checker = readFileSync(join(root, 'tools/check_release_zip.py'), 'utf8');
  assert.ok(builder.includes('.cache'));
  assert.ok(checker.includes('.cache'));
});

test('release and full gates never allow cache while affected can use probe cache', () => {
  assert.equal(isCacheAllowedForGate('release', policy.gates.release), false);
  assert.equal(isCacheAllowedForGate('full', policy.gates.full), false);
  assert.equal(policy.gates.release.allowCache, false);
  assert.equal(policy.gates.full.allowCache, false);
  assert.equal(isCacheAllowedForGate('affected', policy.gates.affected), true);
});

test('cache key includes task command, changed files, and core config hashes', async () => {
  const task = { id: 'quality.cache-probe', command: 'node', args: ['--test'], timeoutSeconds: 10 };
  const keyA = await createQualityCacheKey(root, task, ['src/game-core/index.ts']);
  const keyB = await createQualityCacheKey(root, task, ['docs/CHECK_ARCHITECTURE.md']);
  assert.match(keyA, /^[a-f0-9]{64}$/);
  assert.match(keyB, /^[a-f0-9]{64}$/);
  assert.notEqual(keyA, keyB);
  const cacheText = readFileSync(join(root, 'tools/quality/cache/qualityCache.mjs'), 'utf8');
  for (const required of ['package-lock.json', 'test-registry.json', 'gate-policy.json', 'module-graph.json', 'project-target.json', 'architecture-boundary.rules.json']) {
    assert.ok(cacheText.includes(required), `cache key must include ${required}`);
  }
});

test('cache probe does not read logs or alter task failure semantics', () => {
  const runnerText = readFileSync(join(root, 'tools/quality/run-quality-gate.mjs'), 'utf8');
  const cacheText = readFileSync(join(root, 'tools/quality/cache/qualityCache.mjs'), 'utf8');
  assert.equal(/_logs|开发日志包/.test(cacheText), false);
  assert.equal(/cache[\s\S]{0,160}process\.exit\(0\)/.test(runnerText), false);
  assert.ok(runnerText.includes('report-only'));
  assert.ok(runnerText.includes('storeTaskCacheResult'));
  assert.ok(cacheText.includes('result.status !=='));
  assert.ok(registry.tests['test.quality-cache-contracts']);
});
