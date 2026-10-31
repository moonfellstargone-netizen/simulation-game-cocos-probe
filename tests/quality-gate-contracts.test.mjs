import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCommandTask } from '../tools/quality/lib/runQualityTask.mjs';
import { resolveGateTasks } from '../tools/quality/lib/resolveGateTasks.mjs';
import { normalizeReport } from '../tools/quality/lib/writeQualityReport.mjs';

const root = process.cwd();
const readJson = (rel) => JSON.parse(readFileSync(join(root, rel), 'utf8'));

const config = readJson('tools/quality/quality.config.json');
const moduleGraph = readJson('tools/quality/module-graph.json');
const registry = readJson('tools/quality/test-registry.json');
const policy = readJson('tools/quality/gate-policy.json');
const packageJson = readJson('package.json');

test('quality gate config and core files exist and parse', () => {
  for (const rel of [
    'tools/quality/quality.config.json',
    config.moduleGraph,
    config.testRegistry,
    config.gatePolicy,
    'tools/quality/run-quality-gate.mjs',
    'tools/quality/lib/loadQualityConfig.mjs',
    'tools/quality/lib/resolveGateTasks.mjs',
    'tools/quality/lib/runQualityTask.mjs',
    'tools/quality/lib/writeQualityReport.mjs',
    'tools/quality/plugins/legacy-architecture-validator.mjs',
    'tools/quality/plugins/version-consistency-check.mjs',
    'tools/quality/plugins/quality-config-integrity-check.mjs',
    'tools/quality/plugins/test-registry-integrity-check.mjs',
    'tools/quality/plugins/release-surface-check.mjs',
    'tools/quality/plugins/context-doc-surface-check.mjs',
    'tools/quality/plugins/architecture-boundary-check.mjs',
    'tools/quality/plugins/plugin-result.mjs',
    'tools/quality/rules/project-target.json',
    'tools/quality/rules/context-doc-surface.rules.json',
    'tools/quality/rules/architecture-boundary.rules.json',
    'tools/quality/rules/traceability-map.json',
    'tools/quality/plugin-runtime/loadQualityRules.mjs',
    'tools/quality/plugin-runtime/createFinding.mjs',
    'tools/quality/plugin-runtime/createPluginResult.mjs',
    'tools/quality/plugin-runtime/readTextFile.mjs',
    'tools/quality/plugin-runtime/readJsonFile.mjs',
    'tools/quality/plugin-runtime/scanTextRules.mjs',
    'tools/quality/plugin-runtime/pluginCliMain.mjs',
    'tests/quality-plugin-contracts.test.mjs',
    'tests/quality-rule-authority-contracts.test.mjs',
    'tests/architecture-boundary-plugin-contracts.test.mjs',
    'docs/CHECK_ARCHITECTURE.md'
  ]) {
    assert.equal(existsSync(join(root, rel)), true, `${rel} must exist`);
  }
  assert.equal(config.version, '0.0.2.37');
  assert.equal(config.rules?.traceabilityMap, 'tools/quality/rules/traceability-map.json');
  assert.equal(packageJson.scripts['test:quality-gate-contracts'], 'node --test tests/quality-gate-contracts.test.mjs');
});

test('module graph registers project layers and roots', () => {
  const requiredModules = ['game-core', 'cocos-app', 'cocos-creator-adapter', 'scripts', 'tools', 'tests', 'docs', 'release-tools'];
  assert.deepEqual(new Set(Object.keys(moduleGraph.modules)).size, Object.keys(moduleGraph.modules).length);
  for (const moduleId of requiredModules) {
    const module = moduleGraph.modules[moduleId];
    assert.ok(module, `${moduleId} must be registered`);
    assert.ok(Array.isArray(module.roots) && module.roots.length > 0, `${moduleId} must declare roots`);
    assert.ok(Array.isArray(module.tags), `${moduleId} must declare tags`);
  }
  assert.ok(moduleGraph.modules['game-core'].forbiddenDeps.includes('cc'));
  assert.ok(moduleGraph.modules['game-core'].forbiddenDeps.includes('wx'));
  assert.ok(moduleGraph.modules['cocos-creator-adapter'].description.includes('纯 TypeScript'));
});

test('test registry ids are unique and reference existing scripts or files', () => {
  const entries = Object.entries(registry.tests);
  assert.deepEqual(new Set(entries.map(([id]) => id)).size, entries.length);
  for (const [id, task] of entries) {
    assert.ok(task.command, `${id} must declare command`);
    assert.ok(Array.isArray(task.covers) && task.covers.length > 0, `${id} must declare covers`);
    assert.ok(Array.isArray(task.tags) && task.tags.length > 0, `${id} must declare tags`);
    assert.ok(task.type, `${id} must declare type`);
    assert.ok(task.group, `${id} must declare group`);
    assert.ok(task.stability, `${id} must declare stability`);
    assert.equal(typeof task.timeoutSeconds, 'number', `${id} must declare timeoutSeconds`);
    if (task.command === 'npm') {
      const scriptName = task.args?.[1];
      assert.ok(packageJson.scripts[scriptName], `${id} references missing npm script ${scriptName}`);
    }
    if (task.command === 'python3') {
      assert.equal(existsSync(join(root, task.args?.[0] ?? '')), true, `${id} python target must exist`);
    }
  }
  assert.deepEqual(registry.tests['quality.self-test'].args, ['run', 'test:quality-gate-contracts']);
  assert.equal(registry.tests['quality.self-test'].group, 'quality');
});

test('gate policy uses explicit tag semantics and release is uncached', () => {
  const allTags = new Set(Object.values(registry.tests).flatMap((task) => task.tags ?? []));
  for (const [gateId, gate] of Object.entries(policy.gates)) {
    assert.equal('includeTags' in gate, false, `${gateId} must not use deprecated includeTags in current policy`);
    for (const id of gate.includeTests ?? []) assert.ok(registry.tests[id], `${gateId} references missing ${id}`);
    for (const tag of gate.includeTagsAny ?? []) assert.ok(allTags.has(tag), `${gateId} references missing includeTagsAny tag ${tag}`);
    for (const tag of gate.includeTagsAll ?? []) assert.ok(allTags.has(tag), `${gateId} references missing includeTagsAll tag ${tag}`);
    for (const tag of gate.excludeTags ?? []) assert.ok(['release', 'nightly', 'experimental', 'quarantine', ...allTags].includes(tag), `${gateId} references unknown exclude tag ${tag}`);
    for (const included of gate.includeGates ?? []) assert.ok(policy.gates[included], `${gateId} references missing gate ${included}`);
  }
  assert.ok(policy.deprecatedFields?.includeTags.includes('deprecated') || policy.deprecatedFields?.includeTags.includes('兼容'));
  assert.equal(policy.gates.release.allowCache, false);
  assert.equal(policy.gates.release.maxConcurrency, 1);
  assert.equal(policy.groupConcurrency.release, 1);
  assert.equal(policy.gates.full.allowCache, false);
  assert.equal(policy.gates.full.blockOnFailure, true);
  assert.equal(policy.gates.affected.mode, 'affected');
  assert.equal(policy.gates.affected.releaseGate, false);
  assert.equal(policy.gates.affected.neverReleaseAuthority, true);
  assert.equal(packageJson.scripts['q:affected'], 'node tools/quality/run-quality-gate.mjs --gate affected');
});

test('full and release gates cover required surfaces without selecting reserved tags', () => {
  const full = policy.gates.full;
  assert.ok(full.includeTagsAny.includes('blocker'));
  assert.ok(full.includeTagsAny.includes('full'));
  for (const excluded of ['nightly', 'experimental', 'quarantine', 'release']) {
    assert.ok(full.excludeTags.includes(excluded));
  }
  const fullTasks = resolveGateTasks('full', policy, registry).map((task) => task.id);
  for (const required of [
    'architecture.legacy',
    'test.context-governance',
    'test.package-hygiene',
    'test.stage1a-baseline',
    'test.cocos-adapter',
    'test.cocos-ui-readiness',
    'test.cocos-component-node-binding',
    'quality.self-test',
    'quality.versionConsistency',
    'quality.configIntegrity',
    'quality.testRegistryIntegrity',
    'quality.releaseSurface',
    'quality.contextDocSurface',
    'quality.architectureBoundary',
    'test.quality-plugin-contracts',
    'test.quality-rule-authority-contracts',
    'test.architecture-boundary-plugin-contracts',
    'test.architecture-boundary-authority-contracts',
    'test.quality-affected-contracts',
    'test.quality-cache-contracts'
  ]) {
    assert.ok(fullTasks.includes(required), `full gate must include ${required}`);
  }
  assert.ok(policy.gates.release.includeGates.includes('full'));
  assert.ok(policy.gates.release.includeTagsAny.includes('release'));
  const releaseTasks = resolveGateTasks('release', policy, registry);
  assert.ok(releaseTasks.some((task) => task.id === 'release.build'));
  assert.ok(releaseTasks.some((task) => task.id === 'release.check'));
  for (const task of releaseTasks.filter((task) => task.id.startsWith('release.'))) {
    assert.equal(task.group, 'release');
    assert.equal(task.type, 'release');
  }
});


test('quality plugins are registered, covered by full gate, and stay outside game runtime', () => {
  const fullTasks = resolveGateTasks('full', policy, registry).map((task) => task.id);
  const pluginTasks = [
    'quality.versionConsistency',
    'quality.configIntegrity',
    'quality.testRegistryIntegrity',
    'quality.releaseSurface',
    'quality.contextDocSurface',
    'quality.architectureBoundary'
  ];
  for (const id of pluginTasks) {
    const task = registry.tests[id];
    assert.ok(task, `${id} must be registered`);
    assert.equal(task.type, 'quality-plugin');
    assert.equal(task.group, 'quality');
    assert.equal(typeof task.timeoutSeconds, 'number');
    assert.ok(task.tags.includes('full'), `${id} must be full-gate covered`);
    assert.ok(task.tags.includes('blocker'), `${id} must be blocker`);
    assert.ok(fullTasks.includes(id), `${id} must be selected by full gate`);
    const pluginPath = task.args.find((arg) => typeof arg === 'string' && arg.startsWith('tools/quality/plugins/'));
    const pluginText = readFileSync(join(root, pluginPath), 'utf8');
    assert.equal(/src\/game-core|game-core\/|from ['"]\.\.\/\.\.\/src/.test(pluginText), false, `${id} must not import game runtime code`);
    assert.equal(/writeFileSync|appendFileSync|rmSync|unlinkSync/.test(pluginText), false, `${id} must not mutate source files`);
  }
  assert.ok(fullTasks.includes('architecture.legacy'), 'legacy validator must still run in full gate');
  assert.ok(fullTasks.includes('test.stage1a-baseline'), 'Stage 1A baseline must still run in full gate');
  assert.ok(fullTasks.includes('test.cocos-component-node-binding'), 'Cocos adapter checks must still run in full gate');
  assert.equal(packageJson.scripts['test:quality-plugin-contracts'], 'node --test tests/quality-plugin-contracts.test.mjs');
  assert.equal(packageJson.scripts['test:quality-rule-authority-contracts'], 'node --test tests/quality-rule-authority-contracts.test.mjs');
  assert.equal(packageJson.scripts['quality:architecture-boundary'], 'node tools/quality/plugins/architecture-boundary-check.mjs');
  assert.equal(packageJson.scripts['test:architecture-boundary-plugin-contracts'], 'node --test tests/architecture-boundary-plugin-contracts.test.mjs');
});

test('runner stays generic and supports timeout, timed_out, incremental report, and slow-task summary', () => {
  const runner = readFileSync(join(root, 'tools/quality/run-quality-gate.mjs'), 'utf8');
  const taskRunner = readFileSync(join(root, 'tools/quality/lib/runQualityTask.mjs'), 'utf8');
  const reportWriter = readFileSync(join(root, 'tools/quality/lib/writeQualityReport.mjs'), 'utf8');
  assert.equal(/tests\/(stage1a|cocos|package-hygiene)/.test(runner), false, 'runner must not hardcode business test files');
  assert.equal(runner.includes('resolveGateTasks'), true);
  assert.equal(runner.includes('writeQualityReport'), true);
  assert.equal(runner.includes("status: 'running'") || runner.includes('running'), true);
  assert.equal(taskRunner.includes('timeoutSeconds'), true);
  assert.equal(taskRunner.includes('timed_out'), true);
  assert.equal(taskRunner.includes('settled'), true);
  assert.match(taskRunner, /win32.*npm|npm.*win32/s);
  assert.match(taskRunner, /shell:\s*true/);
  assert.equal(reportWriter.includes('timed_out'), true);
  assert.equal(reportWriter.includes('slowTasks'), true);
  assert.equal(reportWriter.includes('Timed Out Tasks'), true);

  const releaseBuilder = readFileSync(join(root, 'tools/build_release_package.py'), 'utf8');
  const releaseChecker = readFileSync(join(root, 'tools/check_release_zip.py'), 'utf8');
  assert.equal(releaseBuilder.includes('reports/quality'), true);
  assert.equal(releaseChecker.includes('reports'), true);
  assert.equal(releaseChecker.includes('quality'), true);
});

test('runCommandTask marks timed_out and avoids reporting it as ordinary failed', async () => {
  const result = await runCommandTask({
    id: 'quality.timeout-probe',
    command: process.execPath,
    args: ['-e', 'setTimeout(() => {}, 500)'],
    type: 'test',
    group: 'quality',
    stability: 'blocker',
    timeoutSeconds: 0.05,
    tags: ['quality']
  }, { cwd: root });
  assert.equal(result.status, 'timed_out');
  assert.equal(result.exitCode, null);
  assert.equal(result.blocker, true);
  assert.equal(result.timeoutSeconds, 0.05);
  assert.match(result.stderrTail, /timed out/);
});

test('report normalizer counts timed_out and blocker failures', () => {
  const normalized = normalizeReport({
    version: '0.0.2.37',
    gate: 'unit',
    status: 'failed',
    tasks: [
      { id: 'a', group: 'quality', status: 'passed', durationMs: 5, blocker: true, command: 'true' },
      { id: 'b', group: 'quality', status: 'timed_out', durationMs: 1000, timeoutSeconds: 0.05, blocker: true, command: 'sleep' },
      { id: 'c', group: 'quality', status: 'skipped', durationMs: 0, blocker: true, command: 'skip' }
    ]
  });
  assert.equal(normalized.summary.passed, 1);
  assert.equal(normalized.summary.timed_out, 1);
  assert.equal(normalized.summary.skipped, 1);
  assert.equal(normalized.summary.blockerFailures, 1);
  assert.equal(normalized.timedOutTasks[0].id, 'b');
  assert.equal(normalized.slowTasks[0].id, 'b');
});
