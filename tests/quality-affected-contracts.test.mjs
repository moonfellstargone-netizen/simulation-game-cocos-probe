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

test('Cocos Web template, preparation and regression changes select the registered probe tasks', () => {
  const cases = [
    ['apps/cocos-probe/template/assets/scripts/CocosWebProbe.ts', ['test.cocos-probe-preparation', 'test.cocos-engine-probe-lifecycle', 'test.cocos-web-verification-contracts', 'quality.architectureBoundary']],
    ['apps/cocos-probe/template/assets/scripts/ProbeLifetime.ts', ['test.cocos-probe-preparation', 'test.cocos-engine-probe-lifecycle']],
    ['apps/cocos-probe/template/assets/scripts/ProbeInteraction.ts', ['test.cocos-probe-preparation', 'test.cocos-engine-probe-lifecycle', 'test.cocos-web-verification-contracts']],
    ['apps/cocos-probe/template/assets/scripts/BrowserSaveStoragePort.ts', ['test.cocos-probe-preparation', 'test.cocos-engine-probe-lifecycle', 'test.cocos-web-verification-contracts']],
    ['tests/cocos-browser-storage.test.ts', ['test.cocos-probe-preparation', 'test.cocos-engine-probe-lifecycle']],
    ['tools/cocos-probe/serve.mjs', ['test.cocos-web-verification-contracts']],
    ['tests/cocos-web-serve-contracts.test.mjs', ['test.cocos-web-verification-contracts']],
    ['tests/cocos-web-interaction.test.ts', ['test.cocos-probe-preparation', 'test.cocos-engine-probe-lifecycle']],
    ['apps/cocos-probe/template/settings/v2/packages/project.json', ['test.cocos-probe-preparation', 'test.cocos-engine-probe-lifecycle']],
    ['apps/cocos-probe/template/assets/Probe.scene.meta', ['test.cocos-probe-preparation', 'test.cocos-engine-probe-lifecycle']],
    ['tools/cocos-probe/prepare.mjs', ['test.cocos-probe-preparation']],
    ['tools/cocos-probe/build.mjs', ['test.cocos-probe-preparation', 'test.cocos-web-verification-contracts']],
    ['apps/cocos-probe/template/build-templates/web-desktop/index.ejs', ['test.cocos-probe-preparation', 'test.cocos-web-verification-contracts']],
    ['apps/cocos-probe/template/build-templates/web-desktop/probe-viewport.css', ['test.cocos-probe-preparation', 'test.cocos-web-verification-contracts']],
    ['apps/cocos-probe/template/build-templates/web-desktop/probe-viewport.js', ['test.cocos-probe-preparation', 'test.cocos-web-verification-contracts']],
    ['tools/cocos-probe/verify-web.mjs', ['test.cocos-web-verification-contracts']],
    ['tools/cocos-probe/lib/webProbeSupport.mjs', ['test.cocos-web-verification-contracts']],
    ['tests/cocos-web-verification-contracts.test.mjs', ['test.cocos-web-verification-contracts']],
    ['tests/cocos-probe-preparation.test.mjs', ['test.cocos-probe-preparation', 'test.cocos-engine-probe-lifecycle']],
    ['tests/cocos-engine-probe-lifecycle.test.ts', ['test.cocos-probe-preparation', 'test.cocos-engine-probe-lifecycle']]
  ];
  for (const [file, required] of cases) {
    const changedFiles = [file];
    const modules = resolveAffectedModules(changedFiles, moduleGraph);
    const result = resolveAffectedTasks({ changedFiles, affectedModules: modules.affectedModules, fallback: modules.fallback, gatePolicy: policy, testRegistry: registry });
    const ids = result.selectedTasks.map((task) => task.id);
    for (const id of required) assert.ok(ids.includes(id), file + ' alone must select ' + id);
    assert.equal(ids.includes('release.build'), false);
    assert.equal(ids.includes('release.check'), false);
  }
});

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

test('a menu-test-only change selects the menu task that actually executes it', () => {
  const file = 'tests/cocos-minimal-menu-binding.test.ts';
  const changedFiles = [file];
  const modules = resolveAffectedModules(changedFiles, moduleGraph);
  const result = resolveAffectedTasks({
    changedFiles,
    affectedModules: modules.affectedModules,
    fallback: modules.fallback,
    fallbackReason: modules.fallbackReason,
    gatePolicy: policy,
    testRegistry: registry
  });
  const menu = result.selectedTasks.find((task) => task.id === 'test.cocos-menu');
  assert.ok(menu, `${file} alone must select its executed test.cocos-menu task`);
  assert.equal(menu.command, 'node');
  assert.ok(menu.args.includes(file), 'the selected menu task must actually execute the changed test');
  assert.equal(result.selectedTasks.some((task) => task.id === 'release.build'), false);
  assert.equal(result.selectedTasks.some((task) => task.id === 'release.check'), false);
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

test('binding source, application tests and shared helper changes select both binding tasks', () => {
  for (const file of [
    'src/cocos-creator-adapter/scene/CocosSceneBindingController.ts',
    'tests/cocos-scene-binding-application.test.ts',
    'tests/cocos-component-node-binding-application.test.ts',
    'tests/support/controlledBindingPort.ts'
  ]) {
    const changedFiles = [file];
    const modules = resolveAffectedModules(changedFiles, moduleGraph);
    const result = resolveAffectedTasks({
      changedFiles,
      affectedModules: modules.affectedModules,
      fallback: modules.fallback,
      fallbackReason: modules.fallbackReason,
      gatePolicy: policy,
      testRegistry: registry
    });
    const ids = result.selectedTasks.map((task) => task.id);
    for (const id of ['test.cocos-scene-binding', 'test.cocos-component-node-binding']) {
      assert.ok(ids.includes(id), `${file} alone must select ${id}`);
    }
    assert.equal(ids.includes('release.build'), false);
    assert.equal(ids.includes('release.check'), false);
  }
});

test('v37 changed tests select the task that actually executes each file', () => {
  const cases = [
  [
    "tests/action-preview-boundary.test.ts",
    "test.action-preview"
  ],
  [
    "tests/cocos-minimal-menu-binding.test.ts",
    "test.cocos-menu"
  ],
  [
    "tests/cocos-runtime-session.test.ts",
    "test.cocos-session"
  ],
  [
    "tests/context-governance-contracts.test.mjs",
    "test.context-governance"
  ],
  [
    "tests/package-hygiene.test.mjs",
    "test.package-hygiene"
  ],
  [
    "tests/project-map-contracts.test.mjs",
    "test.project-map-contracts"
  ],
  [
    "tests/quality-affected-contracts.test.mjs",
    "test.quality-affected-contracts"
  ],
  [
    "tests/quality-gate-contracts.test.mjs",
    "quality.self-test"
  ],
  [
    "tests/quality-rule-authority-contracts.test.mjs",
    "test.quality-rule-authority-contracts"
  ],
  [
    "tests/stage1a-baseline.test.ts",
    "test.stage1a-baseline"
  ],
  [
    "tests/stage1a-contract.test.ts",
    "test.stage1a-contract"
  ],
  [
    "tests/version-surface-contracts.test.mjs",
    "test.version-surface-contracts"
  ]
];
  for (const [file, taskId] of cases) {
    const changedFiles = [file];
    const modules = resolveAffectedModules(changedFiles, moduleGraph);
    const result = resolveAffectedTasks({ changedFiles, affectedModules: modules.affectedModules,
      fallback: modules.fallback, fallbackReason: modules.fallbackReason,
      gatePolicy: policy, testRegistry: registry });
    const task = result.selectedTasks.find((candidate) => candidate.id === taskId);
    assert.ok(task, `${file} alone must select ${taskId}`);
    assert.ok(task.files.includes(file), `${taskId} must register ${file}`);
    const execution = task.command === 'npm'
      ? packageJson.scripts[task.args[1]].split(/\s+/)
      : [task.command, ...task.args];
    assert.ok(execution.includes(file), `${taskId} must actually execute ${file}`);
    for (const tag of ['full', 'blocker']) assert.ok(task.tags.includes(tag));
    assert.equal(result.selectedTasks.some((candidate) => candidate.id === 'release.build'), false);
    assert.equal(result.selectedTasks.some((candidate) => candidate.id === 'release.check'), false);
  }
});
