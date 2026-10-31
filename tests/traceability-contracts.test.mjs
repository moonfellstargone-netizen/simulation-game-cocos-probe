import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveGateTasks } from '../tools/quality/lib/resolveGateTasks.mjs';

const root = process.cwd();
const readJson = (rel) => JSON.parse(readFileSync(join(root, rel), 'utf8'));

test('browser local save closes over executed storage and fixed-origin tool tests without changing platform boundaries', () => {
  const { traceabilityMap, registry, gatePolicy, moduleGraph } = loadTraceabilityContext();
  const id = 'trace.cocos.browser-local-save';
  const entry = traceabilityMap.entries.find((item) => item.id === id);
  assert.equal(entry?.status, 'active');
  assert.ok(traceabilityMap.currentFullReleaseTraceIds.includes(id));
  const adapter = 'apps/cocos-probe/template/assets/scripts/BrowserSaveStoragePort.ts';
  const serve = 'tools/cocos-probe/serve.mjs';
  for (const source of [adapter, serve, 'apps/cocos-probe/template/assets/scripts/CocosWebProbe.ts', 'tools/cocos-probe/verify-web.mjs']) {
    assert.ok(entry.sourceRefs.includes(source), `${source} must be traced`);
  }
  const pkg = readJson('package.json');
  for (const [taskId, script, file, implementation] of [
    ['test.cocos-engine-probe-lifecycle', 'test:cocos-engine-probe-lifecycle', 'tests/cocos-browser-storage.test.ts', adapter],
    ['test.cocos-web-verification-contracts', 'test:cocos-web-verification-contracts', 'tests/cocos-web-serve-contracts.test.mjs', serve]
  ]) {
    assert.ok(entry.testRefs.includes(taskId));
    const task = registry.tests[taskId];
    assert.equal(task?.stability, 'blocker');
    for (const tag of ['full', 'blocker']) assert.ok(task.tags.includes(tag));
    for (const path of [file, implementation]) assert.ok(task.files.includes(path), `${taskId} must register ${path}`);
    for (const module of ['tests', 'cocos-engine-probe']) assert.ok(task.covers.includes(module));
    assert.ok(task.args.includes(file), `${taskId} must execute ${file}`);
    assert.ok(pkg.scripts[script].split(/\s+/).includes(file), `${script} must execute ${file}`);
    for (const gate of ['full', 'release']) {
      assert.ok(entry.gateRefs.includes(gate));
      assert.ok(resolveGateTasks(gate, gatePolicy, registry).some((selected) => selected.id === taskId));
    }
  }
  assert.ok(registry.tests['test.cocos-probe-preparation'].files.includes(adapter));
  const rules = readJson('tools/quality/rules/architecture-boundary.rules.json');
  const outer = rules.rules.importBoundaries.find((rule) => rule.id === 'cocos-engine-probe-public-runtime-only');
  assert.equal(outer.mode, 'authoritative');
  assert.equal(outer.severity, 'error');
  for (const forbidden of ['wx', 'fs', 'node:fs', 'tests/', 'tools/', 'src/game-core/', 'src/cocos-app/', 'src/cocos-creator-adapter/']) {
    assert.ok(outer.forbiddenImports.includes(forbidden));
  }
  assert.deepEqual(moduleGraph.modules['cocos-engine-probe'].roots, ['apps/cocos-probe/**']);
  assert.equal(traceabilityMap.entries.find((item) => item.id === 'trace.stage1b.wx-storage-port')?.status, 'planned');
});

test('Web save/load recovery closes over the executed interaction and command-result regressions', () => {
  const { traceabilityMap, registry, gatePolicy } = loadTraceabilityContext();
  const id = 'trace.cocos.web-save-load-recovery';
  const entry = traceabilityMap.entries.find((item) => item.id === id);
  assert.equal(entry?.status, 'active');
  assert.ok(traceabilityMap.currentFullReleaseTraceIds.includes(id));
  const helper = 'apps/cocos-probe/template/assets/scripts/ProbeInteraction.ts';
  assert.ok(entry.sourceRefs.includes(helper));
  assert.ok(entry.sourceRefs.includes('src/cocos-creator-adapter/shell/CocosUiCommandQueue.ts'));
  for (const [taskId, file] of [
    ['test.cocos-command-queue', 'tests/cocos-ui-command-queue.test.ts'],
    ['test.cocos-component-node-binding', 'tests/cocos-component-node-binding-application.test.ts'],
    ['test.cocos-engine-probe-lifecycle', 'tests/cocos-web-interaction.test.ts'],
    ['test.cocos-web-verification-contracts', 'tests/cocos-web-verification-contracts.test.mjs']
  ]) {
    assert.ok(entry.testRefs.includes(taskId));
    const task = registry.tests[taskId];
    assert.equal(task?.stability, 'blocker');
    for (const tag of ['full', 'blocker']) assert.ok(task.tags.includes(tag));
    assert.ok(task.files.includes(file));
    assert.ok(task.args.includes(file), `${taskId} must actually execute ${file}`);
    assert.ok(task.covers.includes('tests'));
    for (const gate of ['full', 'release']) assert.ok(resolveGateTasks(gate, gatePolicy, registry).some((selected) => selected.id === taskId));
  }
  const interactionTask = registry.tests['test.cocos-engine-probe-lifecycle'];
  assert.ok(interactionTask.files.includes(helper));
  assert.ok(interactionTask.covers.includes('cocos-engine-probe'));
  const pkg = readJson('package.json');
  assert.ok(pkg.scripts['test:cocos-engine-probe-lifecycle'].includes('tests/cocos-web-interaction.test.ts'));
});

test('Cocos Web preparation and lifetime tasks close the outer-layer trace without claiming engine execution', () => {
  const { traceabilityMap, registry, gatePolicy, moduleGraph } = loadTraceabilityContext();
  const id = 'trace.cocos.web-bootstrap-probe';
  const entry = traceabilityMap.entries.find((item) => item.id === id);
  assert.equal(entry?.status, 'active');
  assert.ok(traceabilityMap.currentFullReleaseTraceIds.includes(id));
  assert.ok(entry.moduleRefs.includes('cocos-engine-probe'));
  assert.deepEqual(moduleGraph.modules['cocos-engine-probe'].roots, ['apps/cocos-probe/**']);
  for (const [taskId, file] of [
    ['test.cocos-probe-preparation', 'tests/cocos-probe-preparation.test.mjs'],
    ['test.cocos-engine-probe-lifecycle', 'tests/cocos-engine-probe-lifecycle.test.ts']
  ]) {
    assert.ok(entry.testRefs.includes(taskId));
    const task = registry.tests[taskId];
    assert.equal(task?.stability, 'blocker');
    for (const tag of ['full', 'blocker']) assert.ok(task.tags.includes(tag));
    assert.ok(task.files.includes(file));
    assert.ok(task.args.includes(file), taskId + ' must actually execute its test');
    for (const module of ['cocos-engine-probe', 'tests']) assert.ok(task.covers.includes(module));
    for (const gate of ['full', 'release']) assert.ok(resolveGateTasks(gate, gatePolicy, registry).some((selected) => selected.id === taskId));
  }
  const docs = readFileSync(join(root, 'docs/module-cards/cocos-engine-probe.md'), 'utf8');
  assert.match(docs, /根typecheck只覆盖src/);
  assert.match(docs, /真实.*独立验收/);
});

test('viewport input trace registers executable Node verification contracts separately from real browser evidence', () => {
  const { traceabilityMap, registry, gatePolicy } = loadTraceabilityContext();
  const id = 'trace.cocos.web-viewport-input';
  const entry = traceabilityMap.entries.find((item) => item.id === id);
  assert.equal(entry?.status, 'active');
  assert.ok(traceabilityMap.currentFullReleaseTraceIds.includes(id));
  for (const module of ['cocos-engine-probe', 'tools', 'tests']) assert.ok(entry.moduleRefs.includes(module));
  const taskId = 'test.cocos-web-verification-contracts';
  const task = registry.tests[taskId];
  assert.ok(entry.testRefs.includes(taskId));
  assert.equal(task?.stability, 'blocker');
  assert.equal(task.command, 'node');
  assert.deepEqual(task.args, ['--test', 'tests/cocos-web-verification-contracts.test.mjs', 'tests/cocos-web-serve-contracts.test.mjs']);
  for (const file of ['tests/cocos-web-verification-contracts.test.mjs', 'tools/cocos-probe/verify-web.mjs', 'tools/cocos-probe/lib/webProbeSupport.mjs', 'tools/cocos-probe/build.mjs']) {
    assert.ok(task.files.includes(file), file + ' must be an execution input');
    assert.equal(existsSync(join(root, file)), true);
  }
  for (const tag of ['full', 'blocker']) assert.ok(task.tags.includes(tag));
  for (const gate of ['full', 'release']) assert.ok(resolveGateTasks(gate, gatePolicy, registry).some((selected) => selected.id === taskId));
  const packageJson = readJson('package.json');
  assert.equal(packageJson.scripts['cocos:verify:web'], 'node tools/cocos-probe/verify-web.mjs');
  const docs = readFileSync(join(root, 'docs/module-cards/cocos-engine-probe.md'), 'utf8');
  assert.match(docs, /Node契约不执行真实浏览器/);
  assert.match(docs, /真实鼠标点击/);
});

function loadTraceabilityContext() {
  const qualityConfig = readJson('tools/quality/quality.config.json');
  const traceabilityRel = qualityConfig.rules?.traceabilityMap;
  assert.equal(
    typeof traceabilityRel,
    'string',
    'quality.config.json rules.traceabilityMap must be configured'
  );
  assert.equal(
    traceabilityRel,
    'tools/quality/rules/traceability-map.json',
    'rules.traceabilityMap must point to tools/quality/rules/traceability-map.json'
  );
  assert.equal(existsSync(join(root, traceabilityRel)), true, `${traceabilityRel} must exist`);

  const projectTarget = readJson('tools/quality/rules/project-target.json');
  const moduleGraph = readJson('tools/quality/module-graph.json');
  const registry = readJson('tools/quality/test-registry.json');
  const gatePolicy = readJson('tools/quality/gate-policy.json');
  const traceabilityMap = readJson(traceabilityRel);

  return {
    qualityConfig,
    traceabilityRel,
    projectTarget,
    moduleGraph,
    registry,
    gatePolicy,
    traceabilityMap
  };
}


function assertNoReleaseAuthorityOnAffected(entries) {
  const serialized = JSON.stringify(entries);
  assert.equal(
    /q:affected[\s\S]{0,80}release\s+authority/i.test(serialized),
    false,
    'traceability map must not mark q:affected as release authority'
  );
  for (const entry of entries) {
    if (entry.id === 'trace.quality.affected-full-release-boundary') continue;
    const blob = JSON.stringify(entry);
    assert.equal(
      /release\s+authority/i.test(blob) && /q:affected|affected/.test(blob),
      false,
      `${entry.id} must not claim q:affected release authority`
    );
  }
}

test('traceability map loads from quality.config rules.traceabilityMap', () => {
  const { traceabilityMap, projectTarget } = loadTraceabilityContext();
  assert.equal(traceabilityMap.schemaVersion, 'traceability-lite/v1');
  assert.equal(traceabilityMap.projectVersion, projectTarget.version.codePackageVersion);
});

test('active entries satisfy module, test, gate, and path contracts', () => {
  const { traceabilityMap, moduleGraph, registry, gatePolicy } = loadTraceabilityContext();
  const modules = Object.keys(moduleGraph.modules ?? {});
  const tests = Object.keys(registry.tests ?? {});
  const gates = Object.keys(gatePolicy.gates ?? {});
  const active = traceabilityMap.entries.filter((entry) => entry.status === 'active');

  for (const entry of active) {
    assert.ok(entry.moduleRefs?.length >= 1, `${entry.id} needs moduleRefs`);
    assert.ok(entry.docRefs?.length >= 1, `${entry.id} needs docRefs`);
    assert.ok(entry.testRefs?.length >= 1, `${entry.id} needs testRefs`);

    for (const moduleRef of entry.moduleRefs) {
      assert.ok(modules.includes(moduleRef), `${entry.id} unknown moduleRef ${moduleRef}`);
    }
    for (const testRef of entry.testRefs) {
      assert.ok(tests.includes(testRef), `${entry.id} unknown testRef ${testRef}`);
    }
    for (const gateRef of entry.gateRefs ?? []) {
      assert.ok(gates.includes(gateRef), `${entry.id} unknown gateRef ${gateRef}`);
    }
    for (const rel of [...(entry.sourceRefs ?? []), ...(entry.docRefs ?? [])]) {
      assert.equal(existsSync(join(root, rel)), true, `${entry.id} missing path ${rel}`);
    }
    assert.notEqual(entry.notCurrentAuthority, true, `${entry.id} active entry must not set notCurrentAuthority to true`);
  }

  assertNoReleaseAuthorityOnAffected(traceabilityMap.entries);
});

test('planned entries are negatively constrained and excluded from active coverage', () => {
  const { traceabilityMap } = loadTraceabilityContext();
  const requiredActiveIds = traceabilityMap.currentFullReleaseTraceIds ?? [];
  const planned = traceabilityMap.entries.filter((entry) => entry.status === 'planned');
  const activeIds = traceabilityMap.entries
    .filter((entry) => entry.status === 'active')
    .map((entry) => entry.id);

  assert.equal(planned.length >= 1, true, 'expected at least one planned entry');
  for (const entry of planned) {
    assert.equal(entry.notCurrentAuthority, true, `${entry.id} planned must set notCurrentAuthority`);
    assert.equal(
      requiredActiveIds.includes(entry.id),
      false,
      `${entry.id} planned must not be in currentFullReleaseTraceIds`
    );
    assert.equal(activeIds.includes(entry.id), false, `${entry.id} planned must not be active`);
    assert.deepEqual(entry.testRefs ?? [], [], `${entry.id} planned must not require current testRefs`);
  }

  for (const id of requiredActiveIds) {
    const entry = traceabilityMap.entries.find((item) => item.id === id);
    assert.equal(entry?.status, 'active', `${id} in currentFullReleaseTraceIds must be active`);
  }
});

test('traceability map does not promote module_contracts as module-card primary entry', () => {
  const { traceabilityMap } = loadTraceabilityContext();
  const blob = JSON.stringify(traceabilityMap);
  assert.equal(/module_contracts.*module-card.*主入口/i.test(blob), false);
  assert.equal(/主入口.*module_contracts/i.test(blob), false);
});

test('TRACEABILITY_MATRIX.md documents traceability-lite semantics and boundaries', () => {
  const matrixPath = join(root, 'docs/TRACEABILITY_MATRIX.md');
  assert.equal(existsSync(matrixPath), true);
  const text = readFileSync(matrixPath, 'utf8');

  assert.match(text, /^---\r?\n[\s\S]*?doc_type:\s*traceability/m);
  assert.match(text, /status:\s*active/);
  assert.match(text, /traceability-lite\/v1/);
  assert.match(text, /\bactive\b/);
  assert.match(text, /\bplanned\b/);
  assert.match(text, /notCurrentAuthority/);
  assert.match(text, /后续建议不是授权目标/);
  assert.match(text, /不进入 Stage 1B/);
  assert.match(text, /不接 wx|不接真实 wx/);
  assert.match(text, /不接真实 Cocos/);
  assert.match(text, /futureExtensions/);
  assert.match(text, /tools\/quality\/rules\/traceability-map\.json/);
});

test('test.traceability-contracts is registered for full gate with governance tags', () => {
  const registry = readJson('tools/quality/test-registry.json');
  const task = registry.tests['test.traceability-contracts'];
  assert.ok(task, 'test.traceability-contracts must exist in test-registry');
  assert.deepEqual(task.command, 'npm');
  assert.deepEqual(task.args, ['run', 'test:traceability-contracts']);
  for (const tag of ['traceability', 'governance', 'full', 'blocker']) {
    assert.ok(task.tags.includes(tag), `missing tag ${tag}`);
  }

  const packageJson = readJson('package.json');
  assert.equal(typeof packageJson.scripts['test:traceability-contracts'], 'string');
});

test('trace.cocos.session-viewmodel-port closes over the cocos session test as a full/blocker registry task', () => {
  const { traceabilityMap, registry } = loadTraceabilityContext();

  const entry = traceabilityMap.entries.find((item) => item.id === 'trace.cocos.session-viewmodel-port');
  assert.ok(entry, 'trace.cocos.session-viewmodel-port must exist');

  const testRefs = entry.testRefs ?? [];
  assert.ok(
    testRefs.includes('test.cocos-session'),
    `trace.cocos.session-viewmodel-port testRefs must at least include test.cocos-session (got ${JSON.stringify(testRefs)})`
  );

  const task = registry.tests['test.cocos-session'];
  assert.ok(task, 'test.cocos-session must exist in test-registry');
  assert.ok(task.tags?.includes('full'), 'test.cocos-session must carry the full tag so q:full executes it');
  assert.ok(task.tags?.includes('blocker'), 'test.cocos-session must carry the blocker tag');
  assert.ok(
    (task.files ?? []).includes('tests/cocos-runtime-session.test.ts'),
    'test.cocos-session.files must include tests/cocos-runtime-session.test.ts'
  );
  assert.ok(
    (task.args ?? []).includes('tests/cocos-runtime-session.test.ts'),
    'test.cocos-session command args must actually cover tests/cocos-runtime-session.test.ts'
  );
});

test('storage failure recovery is traced to all three executed full/blocker test surfaces', () => {
  const { traceabilityMap, registry, gatePolicy } = loadTraceabilityContext();
  const id = 'trace.save.storage-failure-recovery';
  const entry = traceabilityMap.entries.find((item) => item.id === id);
  assert.equal(entry?.status, 'active');
  assert.ok(traceabilityMap.currentFullReleaseTraceIds.includes(id));
  for (const [taskId, file] of [
    ['test.cocos-session', 'tests/cocos-runtime-session.test.ts'],
    ['test.cocos-save-load', 'tests/cocos-save-load-ui-binding.test.ts'],
    ['test.cocos-command-queue', 'tests/cocos-ui-command-queue.test.ts']
  ]) {
    assert.ok(entry.testRefs.includes(taskId));
    const task = registry.tests[taskId];
    assert.equal(task?.stability, 'blocker');
    for (const tag of ['full', 'blocker']) assert.ok(task.tags.includes(tag));
    assert.ok(task.files.includes(file), `${taskId} must register ${file}`);
    assert.ok(task.files.includes('tests/support/controlledSaveStoragePort.ts'));
    assert.ok(task.covers.includes('tests'), `${taskId} must be selected for test helper changes`);
    assert.ok(task.args.includes(file), `${taskId} must actually execute ${file}`);
    for (const gate of ['full', 'release']) {
      assert.ok(resolveGateTasks(gate, gatePolicy, registry).some((selected) => selected.id === taskId));
    }
  }
});

test('runtime bootstrap is traced to an executed full/blocker integration test', () => {
  const { traceabilityMap, registry, gatePolicy } = loadTraceabilityContext();
  const id = 'trace.runtime.bootstrap-resources';
  const entry = traceabilityMap.entries.find((item) => item.id === id);
  assert.equal(entry?.status, 'active');
  assert.ok(traceabilityMap.currentFullReleaseTraceIds.includes(id));
  const taskId = 'test.stage1a-bootstrap';
  assert.ok(entry.testRefs.includes(taskId));
  const task = registry.tests[taskId];
  assert.equal(task?.stability, 'blocker');
  for (const tag of ['full', 'blocker']) assert.ok(task.tags.includes(tag));
  assert.ok(task.files.includes('tests/stage1a-bootstrap.test.ts'));
  assert.ok(task.args.includes('tests/stage1a-bootstrap.test.ts'));
  for (const gate of ['full', 'release']) {
    assert.ok(resolveGateTasks(gate, gatePolicy, registry).some((selected) => selected.id === taskId));
  }
});

test('binding async recovery closes over both executed full/blocker binding tasks', () => {
  const { traceabilityMap, registry, gatePolicy } = loadTraceabilityContext();
  const id = 'trace.cocos.binding-async-recovery';
  const entry = traceabilityMap.entries.find((item) => item.id === id);
  assert.equal(entry?.status, 'active');
  assert.ok(traceabilityMap.currentFullReleaseTraceIds.includes(id));
  assert.ok(entry.sourceRefs.includes('src/cocos-creator-adapter/scene/CocosSceneBindingController.ts'));
  for (const gate of ['full', 'release']) assert.ok(entry.gateRefs.includes(gate));
  for (const [taskId, file] of [
    ['test.cocos-scene-binding', 'tests/cocos-scene-binding-application.test.ts'],
    ['test.cocos-component-node-binding', 'tests/cocos-component-node-binding-application.test.ts']
  ]) {
    assert.ok(entry.testRefs.includes(taskId));
    const task = registry.tests[taskId];
    assert.equal(task?.stability, 'blocker');
    for (const tag of ['full', 'blocker']) assert.ok(task.tags.includes(tag));
    assert.ok(task.files.includes(file), `${taskId} must register ${file}`);
    assert.ok(task.files.includes('tests/support/controlledBindingPort.ts'));
    assert.ok(task.covers.includes('tests'), `${taskId} must cover test-only changes`);
    assert.ok(task.args.includes(file), `${taskId} must actually execute ${file}`);
    for (const gate of ['full', 'release']) {
      assert.ok(resolveGateTasks(gate, gatePolicy, registry).some((selected) => selected.id === taskId));
    }
  }
});

test('q:affected is not represented as release authority in traceability entries', () => {
  const { traceabilityMap } = loadTraceabilityContext();
  const affectedEntry = traceabilityMap.entries.find(
    (entry) => entry.id === 'trace.quality.affected-full-release-boundary'
  );
  assert.ok(affectedEntry);
  assert.equal(affectedEntry.status, 'active');
  assert.ok(affectedEntry.gateRefs.includes('affected'));
  assert.ok(affectedEntry.gateRefs.includes('release'));
  const docBlob = readFileSync(join(root, 'docs/TRACEABILITY_MATRIX.md'), 'utf8');
  assert.match(docBlob, /affected.*非.*release|q:affected.*不可/);
});
