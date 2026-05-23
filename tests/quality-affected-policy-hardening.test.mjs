import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveAffectedModules } from '../tools/quality/affected/resolveAffectedModules.mjs';
import { resolveAffectedTasks } from '../tools/quality/affected/resolveAffectedTasks.mjs';

const root = process.cwd();
const readJson = (rel) => JSON.parse(readFileSync(join(root, rel), 'utf8'));
const moduleGraph = readJson('tools/quality/module-graph.json');
const registry = readJson('tools/quality/test-registry.json');
const policy = readJson('tools/quality/gate-policy.json');

function resolveFor(file, overrides = {}) {
  const modules = resolveAffectedModules([file], moduleGraph);
  return resolveAffectedTasks({
    changedFiles: [file],
    affectedModules: modules.affectedModules,
    fallback: modules.fallback,
    fallbackReason: modules.fallbackReason,
    moduleFallback: modules.fallback,
    moduleFallbackReason: modules.fallbackReason,
    gatePolicy: policy,
    testRegistry: overrides.registry ?? registry
  });
}

function selectedIds(result) {
  return result.selectedTasks.map((task) => task.id);
}

function assertHasCoverageEvidence(result, file) {
  assert.ok(result.riskClassification[file], `${file} must have riskClassification`);
  assert.ok(result.fallbackLevel, `${file} must have fallbackLevel`);
  assert.deepEqual(result.missingMinimumTasks, [], `${file} must satisfy minimum required tasks`);
  for (const taskId of selectedIds(result)) {
    assert.ok(result.taskSelectionReasons[taskId]?.length > 0, `${taskId} must have taskSelectionReasons`);
  }
  assert.ok(Object.keys(result.skippedTaskReasons).length > 0, `${file} must explain skipped tasks`);
}

test('game-core changes are source-risky and include Stage 1A/runtime/architecture coverage', () => {
  const file = 'src/game-core/index.ts';
  const result = resolveFor(file);
  const ids = selectedIds(result);
  assert.equal(result.riskClassification[file], 'source-risky');
  assert.equal(result.fallbackLevel, 'conservative');
  for (const required of ['static.typecheck', 'architecture.legacy', 'quality.architectureBoundary', 'test.stage1a-baseline', 'test.api-boundary']) {
    assert.ok(ids.includes(required), `source-risky change must include ${required}`);
  }
  assertHasCoverageEvidence(result, file);
});

test('cocos-creator-adapter changes are source-risky and include adapter/component coverage', () => {
  const file = 'src/cocos-creator-adapter/CocosSessionHost.ts';
  const result = resolveFor(file);
  const ids = selectedIds(result);
  assert.equal(result.riskClassification[file], 'source-risky');
  assert.equal(result.fallbackLevel, 'conservative');
  for (const required of ['test.cocos-ui-readiness', 'test.cocos-component-node-binding', 'quality.architectureBoundary']) {
    assert.ok(ids.includes(required), `adapter change must include ${required}`);
  }
  assertHasCoverageEvidence(result, file);
});

test('quality changes are quality-high and include affected/cache/quality policy checks', () => {
  const file = 'tools/quality/affected/affectedPolicy.mjs';
  const result = resolveFor(file);
  const ids = selectedIds(result);
  assert.equal(result.riskClassification[file], 'quality-high');
  assert.equal(result.fallbackLevel, 'conservative');
  for (const required of ['quality.configIntegrity', 'quality.testRegistryIntegrity', 'test.quality-affected-contracts', 'test.quality-affected-policy-hardening', 'test.quality-cache-contracts']) {
    assert.ok(ids.includes(required), `quality-high change must include ${required}`);
  }
  assertHasCoverageEvidence(result, file);
});

test('docs changes are docs-low and include context/package evidence tasks', () => {
  const file = 'docs/CHECK_ARCHITECTURE.md';
  const result = resolveFor(file);
  const ids = selectedIds(result);
  assert.equal(result.riskClassification[file], 'docs-low');
  assert.equal(result.fallbackLevel, 'fast');
  for (const required of ['test.context-governance', 'test.package-hygiene', 'quality.contextDocSurface']) {
    assert.ok(ids.includes(required), `docs-low change must include ${required}`);
  }
  assertHasCoverageEvidence(result, file);
});

test('package metadata changes are config-high and full-recommended', () => {
  const file = 'package.json';
  const result = resolveFor(file);
  const ids = selectedIds(result);
  assert.equal(result.riskClassification[file], 'config-high');
  assert.equal(result.fallbackLevel, 'full-recommended');
  assert.ok(result.warnings.some((warning) => warning.includes('q:full')));
  for (const required of ['static.typecheck', 'quality.self-test', 'test.package-hygiene']) {
    assert.ok(ids.includes(required), `config-high change must include ${required}`);
  }
  assertHasCoverageEvidence(result, file);
});

test('gate-policy and test-registry changes are quality-high with registry integrity', () => {
  for (const file of ['tools/quality/gate-policy.json', 'tools/quality/test-registry.json']) {
    const result = resolveFor(file);
    const ids = selectedIds(result);
    assert.equal(result.riskClassification[file], 'quality-high');
    assert.ok(ids.includes('quality.testRegistryIntegrity'));
    assert.ok(ids.includes('quality.configIntegrity'));
    assertHasCoverageEvidence(result, file);
  }
});

test('release script changes are release-high and do not run release tasks inside affected', () => {
  const file = 'tools/build_release_package.py';
  const result = resolveFor(file);
  const ids = selectedIds(result);
  assert.equal(result.riskClassification[file], 'release-high');
  assert.equal(result.fallbackLevel, 'release-surface');
  assert.ok(ids.includes('quality.releaseSurface'));
  assert.equal(ids.includes('release.build'), false);
  assert.equal(ids.includes('release.check'), false);
  assert.ok(result.warnings.some((warning) => warning.includes('q:release')));
  assertHasCoverageEvidence(result, file);
});

test('unknown paths are unknown-risky and never use fast-only fallback', () => {
  const file = 'unknown/path/outside-known-modules.txt';
  const result = resolveFor(file);
  const ids = selectedIds(result);
  assert.equal(result.riskClassification[file], 'unknown-risky');
  assert.equal(result.fallbackLevel, 'conservative');
  for (const required of ['static.typecheck', 'architecture.legacy', 'quality.architectureBoundary', 'test.package-hygiene', 'test.quality-affected-contracts', 'test.quality-cache-contracts']) {
    assert.ok(ids.includes(required), `unknown-risky change must include ${required}`);
  }
  assertHasCoverageEvidence(result, file);
});

test('missing minimum required tasks are surfaced so q:affected can fail before running a misleading task set', () => {
  const brokenRegistry = structuredClone(registry);
  delete brokenRegistry.tests['quality.architectureBoundary'];
  assert.throws(() => resolveFor('unknown/path/outside-known-modules.txt', { registry: brokenRegistry }), /affected policy references unknown task: quality\.architectureBoundary/);
});

test('report writer includes full/release warning and coverage evidence fields', () => {
  const reportWriter = readFileSync(join(root, 'tools/quality/affected/writeAffectedReport.mjs'), 'utf8');
  for (const required of [
    'riskClassification',
    'fallbackLevel',
    'minimumRequiredTasks',
    'missingMinimumTasks',
    'taskSelectionReasons',
    'skippedTaskReasons',
    'moduleToTaskMap',
    'q:affected is for local development feedback only'
  ]) {
    assert.ok(reportWriter.includes(required), `affected report writer must include ${required}`);
  }
});
