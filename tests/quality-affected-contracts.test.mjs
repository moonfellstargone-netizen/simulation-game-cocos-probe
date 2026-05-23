import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveAffectedModules } from '../tools/quality/affected/resolveAffectedModules.mjs';
import { resolveAffectedTasks } from '../tools/quality/affected/resolveAffectedTasks.mjs';

const root = process.cwd();
const readJson = (rel) => JSON.parse(readFileSync(join(root, rel), 'utf8'));
const packageJson = readJson('package.json');
const moduleGraph = readJson('tools/quality/module-graph.json');
const registry = readJson('tools/quality/test-registry.json');
const policy = readJson('tools/quality/gate-policy.json');

test('q:affected script and gate are active development feedback only', () => {
  assert.equal(packageJson.scripts['q:affected'], 'node tools/quality/run-quality-gate.mjs --gate affected');
  assert.ok(packageJson.scripts['test:quality-affected-contracts']);
  assert.ok(packageJson.scripts['test:quality-cache-contracts']);
  const affected = policy.gates.affected;
  assert.equal(affected.mode, 'affected');
  assert.equal(affected.releaseGate, false);
  assert.equal(affected.neverReleaseAuthority, true);
  assert.equal(affected.allowCache, true);
  assert.equal(affected.fallbackGate, 'fast');
  assert.equal(policy.gates.release.allowCache, false);
  assert.equal(policy.gates.full.allowCache, false);
  assert.equal((policy.gates.release.includeGates ?? []).includes('affected'), false);
});

test('affected helper files and fixtures exist', () => {
  for (const rel of [
    'tools/quality/affected/resolveChangedFiles.mjs',
    'tools/quality/affected/resolveAffectedModules.mjs',
    'tools/quality/affected/resolveAffectedTasks.mjs',
    'tools/quality/affected/affectedPolicy.mjs',
    'tools/quality/affected/writeAffectedReport.mjs',
    'tests/fixtures/quality-affected/changed-files-game-core.txt',
    'tests/fixtures/quality-affected/changed-files-docs.txt',
    'tests/fixtures/quality-affected/changed-files-quality.txt',
    'tests/fixtures/quality-affected/changed-files-unknown.txt'
  ]) {
    assert.equal(existsSync(join(root, rel)), true, `${rel} must exist`);
  }
});

test('game-core changes map to reverse dependency closure and conservative tasks', () => {
  const modules = resolveAffectedModules(['src/game-core/index.ts'], moduleGraph);
  assert.deepEqual(modules.owningModules['src/game-core/index.ts'].includes('game-core'), true);
  for (const moduleId of ['game-core', 'cocos-app', 'cocos-creator-adapter']) {
    assert.ok(modules.affectedModules.includes(moduleId), `${moduleId} must be affected`);
  }
  const tasks = resolveAffectedTasks({
    changedFiles: ['src/game-core/index.ts'],
    affectedModules: modules.affectedModules,
    fallback: modules.fallback,
    gatePolicy: policy,
    testRegistry: registry
  }).selectedTasks.map((task) => task.id);
  for (const required of ['static.typecheck', 'quality.versionConsistency', 'quality.configIntegrity', 'quality.testRegistryIntegrity', 'test.stage1a-baseline', 'test.cocos-ui-readiness']) {
    assert.ok(tasks.includes(required), `affected tasks must include ${required}`);
  }
  assert.equal(tasks.includes('release.build'), false);
  assert.equal(tasks.includes('release.check'), false);
});

test('quality and docs changes select quality/context tasks without selecting release tasks', () => {
  const qualityModules = resolveAffectedModules(['tools/quality/gate-policy.json'], moduleGraph);
  const qualityTasks = resolveAffectedTasks({
    changedFiles: ['tools/quality/gate-policy.json'],
    affectedModules: qualityModules.affectedModules,
    fallback: qualityModules.fallback,
    gatePolicy: policy,
    testRegistry: registry
  }).selectedTasks.map((task) => task.id);
  for (const required of ['quality.configIntegrity', 'quality.testRegistryIntegrity', 'test.quality-affected-contracts', 'test.quality-cache-contracts']) {
    assert.ok(qualityTasks.includes(required), `quality change must include ${required}`);
  }
  assert.equal(qualityTasks.includes('release.build'), false);

  const docModules = resolveAffectedModules(['docs/CHECK_ARCHITECTURE.md'], moduleGraph);
  const docTasks = resolveAffectedTasks({
    changedFiles: ['docs/CHECK_ARCHITECTURE.md'],
    affectedModules: docModules.affectedModules,
    fallback: docModules.fallback,
    gatePolicy: policy,
    testRegistry: registry
  }).selectedTasks.map((task) => task.id);
  for (const required of ['test.context-governance', 'test.package-hygiene', 'quality.contextDocSurface']) {
    assert.ok(docTasks.includes(required), `docs change must include ${required}`);
  }
});

test('unknown changed files trigger fallback and affected report contract is documented', () => {
  const modules = resolveAffectedModules(['unknown/path/outside-known-modules.txt'], moduleGraph);
  assert.equal(modules.fallback, true);
  assert.match(modules.fallbackReason, /unmatched/);
  const tasks = resolveAffectedTasks({
    changedFiles: ['unknown/path/outside-known-modules.txt'],
    affectedModules: modules.affectedModules,
    fallback: modules.fallback,
    gatePolicy: policy,
    testRegistry: registry
  });
  assert.ok(tasks.fallbackReasons.join('\n').includes('fallback'));
  const reportWriter = readFileSync(join(root, 'tools/quality/affected/writeAffectedReport.mjs'), 'utf8');
  for (const required of ['changedFiles', 'affectedModules', 'selectedTasks', 'fallback', 'q:affected is for local development feedback only']) {
    assert.ok(reportWriter.includes(required), `affected report writer must include ${required}`);
  }
});
