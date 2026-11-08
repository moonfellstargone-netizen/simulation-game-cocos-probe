import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareWechatProbe } from '../tools/cocos-wechat-probe/prepare.mjs';
import { buildWechatProbe } from '../tools/cocos-wechat-probe/build.mjs';
import { readWechatPreparedProject, readWechatProbeSource, wechatTreeDigest } from '../tools/cocos-wechat-probe/lib/source.mjs';
import { assertWechatEngineAfterBuild, assertWechatSourceProvenance, WECHAT_BUILD_TOOL_FILES } from '../tools/cocos-wechat-probe/lib/sourceProvenance.mjs';
import { capturePreparedSurface, checkPreparedSurfaceAfterBuild } from '../tools/cocos-probe/lib/webProbeSupport.mjs';

const root = process.cwd();
const appId = 'wx0000000000000001'; // Contract fixture only; never used for a real platform build.
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
let temporary;
let source;
let prepared;

before(() => {
  temporary = mkdtempSync(join(tmpdir(), 'wechat-probe-contract-'));
  source = join(temporary, 'source');
  mkdirSync(source);
  for (const name of ['src', 'design_snapshot', 'tools', 'apps/cocos-wechat-probe']) {
    cpSync(join(root, name), join(source, name), { recursive: true });
  }
  cpSync(join(root, 'package-lock.json'), join(source, 'package-lock.json'));
  const git = (args) => execFileSync('git', ['-C', source, ...args], { stdio: 'pipe' });
  git(['init', '--quiet']);
  git(['config', '--local', 'core.autocrlf', 'false']);
  git(['add', '--all']);
  git(['-c', 'user.name=Wechat Preparation Contract', '-c', 'user.email=contracts@example.invalid', 'commit', '--quiet', '-m', 'controlled preparation inputs']);
});

after(() => {
  if (!temporary) return;
  const absolute = resolve(temporary);
  assert.ok(absolute.startsWith(resolve(tmpdir()) + sep));
  assert.ok(absolute.split(sep).at(-1).startsWith('wechat-probe-contract-'));
  rmSync(absolute, { recursive: true, force: true });
});

const prepare = (name, extra = {}) => prepareWechatProbe({ rootDir: source, outputDir: join(temporary, name), appId, ...extra });

test('fixed Wechat preparation records exact public inputs and distinct same-commit candidate identities', async () => {
  prepared = await prepare('candidate-a', { profileName: 'web', templateRel: 'untrusted-template' });
  const repeated = await prepare('candidate-b');
  const { manifest } = prepared;
  const target = json(join(source, 'tools/quality/rules/project-target.json'));
  assert.equal(manifest.format, 'cocos-wechat-probe-source/v1');
  assert.equal(manifest.target, 'wechatgame');
  assert.equal(manifest.appId, appId);
  assert.equal(manifest.sourceDirty, false);
  assert.equal(manifest.sourceCommit, repeated.manifest.sourceCommit);
  assert.equal(manifest.version, target.version.codePackageVersion);
  assert.equal(manifest.buildId, 'cocos_wechat_probe_' + target.version.snakeVersion);
  assert.equal(manifest.schemaCount, 58);
  assert.equal(manifest.resourcePreflight, 'node-aot-public-bootstrap-passed');
  assert.equal(manifest.engineVerification, 'not-executed-by-prepare');
  const identity = json(join(prepared.outputDir, 'assets/resources/candidate-identity.json'));
  assert.deepEqual(identity, manifest.candidateIdentity);
  assert.match(identity.candidate_id, /^wechat-[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/);
  assert.notEqual(identity.candidate_id, repeated.manifest.candidateIdentity.candidate_id);
  assert.equal(identity.source_commit, manifest.sourceCommit);
  assert.equal(identity.short_commit, manifest.sourceCommit.slice(0, 12));
  assert.equal(identity.build_id, manifest.buildId);
  assert.equal(identity.schema, 'wechat-candidate/v1');
  const config = json(join(prepared.outputDir, 'wechat-build-options.json'));
  assert.equal(config.packages.wechatgame.appid, appId);
  assert.equal(config.platform, 'wechatgame');
  assert.equal(config.debug, false, 'WeChat candidates use the compact Creator build');
  assert.equal(config.startScene, json(join(prepared.outputDir, 'assets/Probe.scene.meta')).uuid);
  assert.equal(json(join(prepared.outputDir, 'settings/v2/packages/project.json')).script.loose, false);
  const engine = json(join(prepared.outputDir, 'settings/v2/packages/engine.json')).modules.configs.defaultConfig;
  assert.deepEqual([...engine.includeModules].sort(),
    ['2d', 'graphics', 'affine-transform', 'animation', 'base', 'gfx-webgl', 'gfx-webgl2', 'tween', 'ui', 'custom-pipeline'].sort());
  for (const name of ['base', '2d', 'ui', 'graphics', 'animation', 'tween', 'gfx-webgl', 'gfx-webgl2']) {
    assert.equal(engine.cache[name]._value, true, 'retained WeChat engine feature: ' + name);
  }
  for (const name of ['spine', 'dragon-bones', 'physics-2d', 'physics-2d-box2d', 'physics-2d-builtin',
    'particle-2d', 'tiled-map', 'video', 'webview', 'audio', 'profiler', 'rich-text', 'mask', 'intersection-2d']) {
    assert.equal(engine.cache[name]._value, false, 'excluded WeChat engine feature: ' + name);
  }
  for (const file of ['WechatInventoryGroups.ts', 'WechatInventoryGroups.ts.meta']) {
    assert.ok(manifest.inputs['apps/cocos-wechat-probe/template/assets/scripts/' + file], 'inventory source recorded');
    assert.ok(manifest.outputs['assets/scripts/' + file], 'inventory source copied to prepared candidate');
  }
  assert.ok(manifest.inputs['apps/cocos-wechat-probe/template/settings/v2/packages/engine.json']);
  assert.ok(manifest.outputs['settings/v2/packages/engine.json']);
  for (const name of ['tools/cocos-probe/lib/prepareProject.mjs', 'tools/cocos-wechat-probe/prepare.mjs']) assert.ok(manifest.inputs[name]);
  for (const [path, item] of Object.entries(manifest.inputs)) {
    const bytes = readFileSync(join(source, path));
    assert.equal(sha256(bytes), item.sha256, path);
    assert.equal(bytes.length, item.bytes, path);
  }
  for (const [path, item] of Object.entries(manifest.outputs)) {
    const bytes = readFileSync(join(prepared.outputDir, path));
    assert.equal(sha256(bytes), item.sha256, path);
    assert.equal(bytes.length, item.bytes, path);
  }
  const resources = json(join(prepared.outputDir, 'assets/resources/probe-resources.json'));
  assert.deepEqual(Object.keys(resources).sort(), ['buildId', 'schemas', 'snapshot']);
  assert.equal(Object.hasOwn(resources.snapshot, 'candidate_id'), false);
  const precompile = json(join(prepared.outputDir, 'wechat-schema-precompile.json'));
  assert.deepEqual(precompile, manifest.schemaPrecompilation);
  assert.equal(precompile.schemaCount, 58);
  assert.equal(Object.keys(precompile.exportMap).length, 58);
  assert.deepEqual(Object.values(precompile.exportMap).sort(), Object.values(resources.schemas).map(schema => schema.$id).sort());
  assert.deepEqual(Object.keys(precompile.schemaSources).sort(), Object.keys(resources.schemas).sort());
  for (const [path, schema] of Object.entries(resources.schemas)) assert.equal(precompile.schemaSources[path], JSON.stringify(schema));
  for (const name of Object.keys(precompile.exportMap)) assert.match(name, /^schema_\d{3}$/);
  for (const name of ['ajv/dist/2020.js', 'ajv/dist/standalone/index.js', 'ajv/package.json']) {
    assert.ok(precompile.compilerDependencyInputs.includes(name), 'record actual Node compiler input ' + name);
  }
  for (const name of precompile.compilerDependencyInputs) assert.ok(manifest.dependencyInputs[name], name);
  assert.ok(manifest.inputs['tools/cocos-wechat-probe/lib/precompiledSchemas.mjs']);
  assert.ok(manifest.inputs['apps/cocos-wechat-probe/runtime/WechatDataClone.ts']);
  assert.equal(precompile.generatedModuleSha256, sha256(readFileSync(join(prepared.outputDir, 'wechat-precompiled-validators.mjs'))));
  assert.equal(manifest.runtimeEntrySha256, sha256(readFileSync(join(prepared.outputDir, 'wechat-runtime-entry.mjs'))));
  assert.equal(readWechatPreparedProject({ rootDir: source, project: prepared.outputDir }).identity.candidate_id, identity.candidate_id);
});

test('WeChat build source rejects a debug candidate even if its output record is rewritten', () => {
  const configPath = join(prepared.outputDir, 'wechat-build-options.json');
  const manifestPath = join(prepared.outputDir, 'probe-source-manifest.json');
  const originalConfig = readFileSync(configPath);
  const originalManifest = readFileSync(manifestPath);
  try {
    const config = JSON.parse(originalConfig);
    config.debug = true;
    const changed = Buffer.from(JSON.stringify(config));
    writeFileSync(configPath, changed);
    const manifest = JSON.parse(originalManifest);
    manifest.outputs['wechat-build-options.json'] = { bytes: changed.length, sha256: sha256(changed) };
    writeFileSync(manifestPath, JSON.stringify(manifest));
    assert.throws(() => readWechatPreparedProject({ rootDir: source, project: prepared.outputDir }),
      /ERR_WECHAT_BUILD_CONFIG_MISMATCH/);
  } finally {
    writeFileSync(configPath, originalConfig);
    writeFileSync(manifestPath, originalManifest);
  }
  assert.equal(readWechatPreparedProject({ rootDir: source, project: prepared.outputDir }).identity.candidate_id,
    prepared.manifest.candidateIdentity.candidate_id);
});

test('engine output is bound to its fixed Git template even when output and manifest are forged together', () => {
  const enginePath = join(prepared.outputDir, 'settings/v2/packages/engine.json');
  const manifestPath = join(prepared.outputDir, 'probe-source-manifest.json');
  const engineBytes = readFileSync(enginePath);
  const manifestBytes = readFileSync(manifestPath);
  try {
    const engine = JSON.parse(engineBytes);
    engine.modules.configs.defaultConfig.cache.tween._value = false;
    const changed = Buffer.from(JSON.stringify(engine));
    const manifest = JSON.parse(manifestBytes);
    manifest.outputs['settings/v2/packages/engine.json'] = { bytes: changed.length, sha256: sha256(changed) };
    writeFileSync(enginePath, changed);
    writeFileSync(manifestPath, JSON.stringify(manifest));
    assert.throws(() => readWechatPreparedProject({ rootDir: source, project: prepared.outputDir }), /ERR_WECHAT_ENGINE_SOURCE_MISMATCH/);
    delete manifest.inputs['apps/cocos-wechat-probe/template/settings/v2/packages/engine.json'];
    writeFileSync(manifestPath, JSON.stringify(manifest));
    assert.throws(() => readWechatPreparedProject({ rootDir: source, project: prepared.outputDir }), /ERR_WECHAT_SOURCE_INPUTS_INCOMPLETE/);
    manifest.inputs['apps/cocos-wechat-probe/template/settings/v2/packages/engine.json'] = JSON.parse(manifestBytes).inputs['apps/cocos-wechat-probe/template/settings/v2/packages/engine.json'];
    delete manifest.outputs['settings/v2/packages/engine.json'];
    writeFileSync(manifestPath, JSON.stringify(manifest));
    assert.throws(() => readWechatPreparedProject({ rootDir: source, project: prepared.outputDir }), /ERR_WECHAT_ENGINE_SOURCE_MISMATCH/);
  } finally {
    writeFileSync(enginePath, engineBytes);
    writeFileSync(manifestPath, manifestBytes);
  }
});

test('WeChat Creator normalization preserves every existing engine setting', () => {
  const enginePath = join(prepared.outputDir, 'settings/v2/packages/engine.json');
  const original = readFileSync(enginePath);
  const engine = JSON.parse(original);
  const config = engine.modules.configs.defaultConfig;
  const cache = config.cache;
  engine.__version__ = '1.0.12';
  config.includeModules.sort();
  Object.assign(cache, {
    'custom-pipeline': { _value: true }, 'custom-pipeline-post-process': { _value: false },
    'gfx-webgpu': { _value: false }, 'legacy-pipeline': { _value: false }, 'meshopt': { _value: false },
    'physics-2d-box2d-jsb': { _value: false }, 'physics-2d-box2d-wasm': { _value: false, _flags: { LOAD_BOX2D_MANUALLY: false } },
    'procedural-animation': { _value: false }, 'sorting-2d': { _value: false },
    'spine-3.8': { _value: cache.spine._value, _flags: { LOAD_SPINE_MANUALLY: false } },
    'spine-4.2': { _value: false, _flags: { LOAD_SPINE_MANUALLY: false } },
    'ui-skew': { _value: false }, 'vendor-google': { _value: false }
  });
  cache['physics-ammo']._flags = { LOAD_BULLET_MANUALLY: false };
  cache['physics-physx']._flags = { LOAD_PHYSX_MANUALLY: false };
  cache['render-pipeline']._value = true;
  const options = { rootDir: source, manifest: prepared.manifest, projectDir: prepared.outputDir };
  try {
    writeFileSync(enginePath, JSON.stringify(engine));
    assertWechatEngineAfterBuild(options);
    cache.tween._value = false;
    writeFileSync(enginePath, JSON.stringify(engine));
    assert.throws(() => assertWechatEngineAfterBuild(options), /ERR_WECHAT_ENGINE_NORMALIZATION_MISMATCH/);
    cache.tween._value = true;
    cache['gfx-webgpu']._value = true;
    writeFileSync(enginePath, JSON.stringify(engine));
    assert.throws(() => assertWechatEngineAfterBuild(options), /ERR_WECHAT_ENGINE_NORMALIZATION_MISMATCH/);
  } finally { writeFileSync(enginePath, original); }
});

test('a clean alternate source cannot claim a different compiler helper that the tool did not execute', async () => {
  const alternate = join(temporary, 'different-compiler-source');
  cpSync(source, alternate, { recursive: true });
  const helper = 'tools/cocos-wechat-probe/lib/precompiledSchemas.mjs';
  const helperPath = join(alternate, helper);
  writeFileSync(helperPath, Buffer.concat([Buffer.from("throw new Error('DIFFERENT_SOURCE_HELPER_MUST_NOT_EXECUTE');\n"), readFileSync(helperPath)]));
  const git = args => execFileSync('git', ['-C', alternate, ...args], { stdio: 'pipe' });
  git(['add', helper]);
  git(['-c', 'user.name=Wechat Preparation Contract', '-c', 'user.email=contracts@example.invalid', 'commit', '--quiet', '-m', 'controlled different source compiler']);
  assert.equal(git(['status', '--porcelain']).toString('utf8').trim(), '');
  const destination = join(temporary, 'different-compiler-output');
  await assert.rejects(prepareWechatProbe({ rootDir: alternate, outputDir: destination, appId }),
    error => error.message === 'ERR_PROBE_COMPILER_SOURCE_MISMATCH:' + helper);
  assert.equal(existsSync(destination), false, 'mismatched executable source must fail before publishing any output');
});

test('published Wechat facade boots without Function or native structuredClone and binds every formal Schema', () => {
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', `
    import assert from 'node:assert/strict';
    import { readFileSync } from 'node:fs';
    const { project } = JSON.parse(readFileSync(0, 'utf8'));
    const resources = JSON.parse(readFileSync(project + '/assets/resources/probe-resources.json', 'utf8'));
    const bytes = readFileSync(project + '/assets/generated/probe-runtime.js');
    let attempts = 0;
    const unavailable = () => { attempts++; throw new Error('ERR_DYNAMIC_FUNCTION_UNAVAILABLE'); };
    globalThis.Function = new Proxy(globalThis.Function, { construct: unavailable, apply: unavailable });
    globalThis.structuredClone = undefined;
    const runtime = await import('data:text/javascript;base64,' + bytes.toString('base64'));
    assert.equal(globalThis.structuredClone, undefined);
    const createHost = input => runtime.createStage1AHost({ ...input, storage: new runtime.InMemorySaveStoragePort(), nowIso8601: '2026-11-03T00:00:00.000Z' });
    const host = createHost(resources);
    const component = new runtime.QinglanUiSceneProbeComponent(host, { applyNodeBindingPatch() {} });
    await component.mount();
    assert.equal(host.requireSession().getViewModel().time_label, 'day 1 minute 360');
    const advanced = await component.execute({ name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 60 } });
    assert.equal(advanced.command_result.snapshot.menu.last_action_result.success, true);
    assert.equal(host.requireSession().getViewModel().time_label, 'day 1 minute 420');
    const beforeInvalid = JSON.stringify(host.requireSession().getViewModel());
    const invalid = host.requireSession().dispatch('advance_time', null);
    assert.equal(invalid.success, false);
    assert.equal(invalid.status_code, 'ERR_SCHEMA_VALIDATION_FAILED');
    assert.equal(JSON.stringify(host.requireSession().getViewModel()), beforeInvalid);
    let rejectedSources = 0;
    for (const path of Object.keys(resources.schemas)) {
      const changed = JSON.parse(JSON.stringify(resources));
      changed.schemas[path].__controlled_source_mutation__ = true;
      assert.throws(() => createHost(changed), /ERR_PRECOMPILED_SCHEMA_SOURCE_MISMATCH/);
      rejectedSources++;
    }
    await component.unmount();
    assert.equal(host.hasSession(), false);
    assert.equal(attempts, 0);
    assert.equal(globalThis.structuredClone, undefined);
    console.log(JSON.stringify({ functionAttempts: attempts, globalCloneUnchanged: true, rejectedSources, time: 'day 1 minute 420', invalidRequestRejected: true }));
  `], { input: JSON.stringify({ project: prepared.outputDir }), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 30000, windowsHide: true });
  assert.equal(child.status, 0, (child.error?.message ?? '') + child.stderr.slice(0, 2000));
  assert.deepEqual(JSON.parse(child.stdout), { functionAttempts: 0, globalCloneUnchanged: true, rejectedSources: 58, time: 'day 1 minute 420', invalidRequestRejected: true });
});

test('the actual prepared public bundle starts Stage1A and dispatches advance_time through its existing component', async () => {
  const runtime = await import('data:text/javascript;base64,' + readFileSync(join(prepared.outputDir, 'assets/generated/probe-runtime.js')).toString('base64'));
  const resources = json(join(prepared.outputDir, 'assets/resources/probe-resources.json'));
  const host = runtime.createStage1AHost({ ...resources, storage: new runtime.InMemorySaveStoragePort(), nowIso8601: '2026-11-03T00:00:00.000Z' });
  const component = new runtime.QinglanUiSceneProbeComponent(host, { applyNodeBindingPatch() {} });
  await component.mount();
  assert.equal(host.requireSession().getViewModel().time_label, 'day 1 minute 360');
  const result = await component.execute({ name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 60 } });
  assert.equal(result.command_result.status, 'completed');
  assert.equal(result.command_result.snapshot.menu.last_preview_result.success, true);
  assert.equal(result.command_result.snapshot.menu.last_action_result.success, true);
  assert.equal(result.command_result.snapshot.menu.last_preview_result.action_type, 'advance_time');
  assert.equal(typeof result.command_result.snapshot.menu.last_action_result.request_id, 'string');
  assert.ok(result.command_result.snapshot.menu.last_action_result.request_id.length > 0);
  assert.equal(host.requireSession().getViewModel().time_label, 'day 1 minute 420');
  await component.unmount();
  assert.equal(host.hasSession(), false);
});

test('missing, default or malformed AppID and unsafe destinations fail without publishing a project', async () => {
  for (const invalid of [undefined, '', 'touristappid', 'wx6ac3f5090a6b99c5', 'wx123', appId + ';platform=web-desktop']) {
    const outputDir = join(temporary, 'invalid-app-' + String(invalid).length);
    await assert.rejects(prepareWechatProbe({ rootDir: source, outputDir, appId: invalid }), /ERR_WECHAT_APP_ID_REQUIRED/);
    assert.equal(existsSync(outputDir), false);
  }
  for (const outputDir of [undefined, 'relative', source, join(source, 'derived'), temporary, prepared.outputDir]) {
    await assert.rejects(prepareWechatProbe({ rootDir: source, outputDir, appId }), /ERR_PROBE_OUTPUT_/);
  }
  const real = join(temporary, 'real-parent');
  mkdirSync(real);
  const alias = join(temporary, 'linked-parent');
  symlinkSync(real, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(prepareWechatProbe({ rootDir: source, outputDir: join(alias, 'new'), appId }), /ERR_PROBE_OUTPUT_SYMLINK/);
  assert.equal(existsSync(join(real, 'new')), false);
});

test('Wechat profile inherits full resource readiness and runtime source-boundary failures', async () => {
  const changes = [
    ['design_snapshot/generated/stage_1A_runtime_snapshot.json', (bytes) => { const snapshot = JSON.parse(bytes); delete snapshot.loaded_documents['configs/core/new_game_builder_mapping.yaml']; return JSON.stringify(snapshot); }, /ERR_PROBE_RESOURCE_PREFLIGHT:[\s\S]*ERR_CONFIG_DOC_NOT_LOADED/],
    ['design_snapshot/schemas/config/crop_config.schema.json', () => JSON.stringify({ $id: 'crop_config.schema.json', $ref: 'missing_wechat_contract.schema.json' }), /ERR_PROBE_(?:RESOURCE_PREFLIGHT|SCHEMA_PRECOMPILE):[\s\S]*missing_wechat_contract/],
    ['src/cocos-creator-adapter/index.ts', (bytes) => bytes + "\nimport 'node:fs';\n", /Could not resolve ["']node:fs/],
    ['src/game-core/index.ts', (bytes) => bytes + "\nexport * from './dev-api';\n", /ERR_PROBE_RUNTIME_TEST_DEPENDENCY/]
  ];
  for (const [index, [name, change, expected]] of changes.entries()) {
    const path = join(source, name);
    const bytes = readFileSync(path);
    const outputDir = join(temporary, 'invalid-source-' + index);
    try {
      writeFileSync(path, change(bytes.toString('utf8')));
      await assert.rejects(prepareWechatProbe({ rootDir: source, outputDir, appId }), expected);
      assert.equal(existsSync(outputDir), false);
    } finally { writeFileSync(path, bytes); }
  }
});

test('candidate resources cannot be supplied by a source template or replaced after preparation', async () => {
  const reserved = join(source, 'apps/cocos-wechat-probe/template/assets/resources/candidate-identity.json');
  mkdirSync(join(source, 'apps/cocos-wechat-probe/template/assets/resources'), { recursive: true });
  try {
    writeFileSync(reserved, '{}');
    await assert.rejects(prepare('reserved-identity'), /ERR_PROBE_TEMPLATE_RESERVED_OUTPUT/);
    assert.equal(existsSync(join(temporary, 'reserved-identity')), false);
  } finally { rmSync(reserved); }
  const identityFile = join(prepared.outputDir, 'assets/resources/candidate-identity.json');
  const original = readFileSync(identityFile);
  try {
    const identity = JSON.parse(original);
    identity.source_commit = '0'.repeat(40);
    writeFileSync(identityFile, JSON.stringify(identity));
    assert.throws(() => readWechatPreparedProject({ rootDir: source, project: prepared.outputDir }), /ERR_WECHAT_CANDIDATE_IDENTITY_MISMATCH/);
  } finally { writeFileSync(identityFile, original); }
});

test('source claims are anchored to real Git bytes, current dirty inputs and installed dependencies', async () => {
  const manifestFile = join(prepared.outputDir, 'probe-source-manifest.json');
  const identityFile = join(prepared.outputDir, 'assets/resources/candidate-identity.json');
  const originalManifest = readFileSync(manifestFile);
  const originalIdentity = readFileSync(identityFile);
  try {
    const forged = JSON.parse(originalManifest);
    const falseIdentity = JSON.parse(originalIdentity);
    forged.sourceCommit = falseIdentity.source_commit = '0'.repeat(40);
    falseIdentity.short_commit = '0'.repeat(12);
    forged.candidateIdentity = falseIdentity;
    const identityBytes = Buffer.from(JSON.stringify(falseIdentity));
    forged.outputs['assets/resources/candidate-identity.json'] = { bytes: identityBytes.length, sha256: sha256(identityBytes) };
    writeFileSync(identityFile, identityBytes);
    writeFileSync(manifestFile, JSON.stringify(forged));
    assert.throws(() => readWechatPreparedProject({ rootDir: source, project: prepared.outputDir }), /ERR_WECHAT_SOURCE_GIT_UNAVAILABLE/,
      'coordinated JSON rewrites cannot establish a nonexistent source commit');
  } finally { writeFileSync(manifestFile, originalManifest); writeFileSync(identityFile, originalIdentity); }
  const wrongBytes = structuredClone(prepared.manifest);
  wrongBytes.inputs['src/cocos-creator-adapter/index.ts'].sha256 = '0'.repeat(64);
  assert.throws(() => assertWechatSourceProvenance({ rootDir: source, manifest: wrongBytes }), /ERR_WECHAT_SOURCE_INPUT_MISMATCH/);
  const wrongDependency = structuredClone(prepared.manifest);
  const dependency = Object.keys(wrongDependency.dependencyInputs)[0];
  wrongDependency.dependencyInputs[dependency].sha256 = '0'.repeat(64);
  assert.throws(() => assertWechatSourceProvenance({ rootDir: source, manifest: wrongDependency }), /ERR_WECHAT_SOURCE_INPUT_MISMATCH/);
  const missingCloneInput = structuredClone(prepared.manifest);
  delete missingCloneInput.inputs['apps/cocos-wechat-probe/runtime/WechatDataClone.ts'];
  assert.throws(() => assertWechatSourceProvenance({ rootDir: source, manifest: missingCloneInput }), /ERR_WECHAT_SOURCE_INPUTS_INCOMPLETE/);
  for (const file of ['WechatInventoryGroups.ts', 'WechatInventoryGroups.ts.meta']) {
    const incomplete = structuredClone(prepared.manifest);
    delete incomplete.inputs['apps/cocos-wechat-probe/template/assets/scripts/' + file];
    assert.throws(() => assertWechatSourceProvenance({ rootDir: source, manifest: incomplete }), /ERR_WECHAT_SOURCE_INPUTS_INCOMPLETE/, file + ' is required');
  }
  const wrongPrecompiledSource = structuredClone(prepared.manifest);
  const precompiledPath = Object.keys(wrongPrecompiledSource.schemaPrecompilation.schemaSources)[0];
  wrongPrecompiledSource.schemaPrecompilation.schemaSources[precompiledPath] = '{}';
  assert.throws(() => assertWechatSourceProvenance({ rootDir: source, manifest: wrongPrecompiledSource }), /ERR_WECHAT_SCHEMA_PRECOMPILE_SOURCE_MISMATCH/);
  const missingCompilerInput = structuredClone(prepared.manifest);
  missingCompilerInput.schemaPrecompilation.compilerDependencyInputs = missingCompilerInput.schemaPrecompilation.compilerDependencyInputs.filter(path => path !== 'ajv/dist/standalone/index.js');
  assert.throws(() => assertWechatSourceProvenance({ rootDir: source, manifest: missingCompilerInput }), /ERR_WECHAT_SCHEMA_COMPILER_INPUTS_MISMATCH/);
  const changed = join(source, 'apps/cocos-wechat-probe/template/assets/scripts/WechatProbeController.ts');
  const original = readFileSync(changed);
  let dirty;
  try {
    writeFileSync(changed, Buffer.concat([original, Buffer.from('\n// controlled dirty preparation input\n')]));
    dirty = await prepare('dirty-source');
    assert.equal(dirty.manifest.sourceDirty, true);
    assert.equal(readWechatPreparedProject({ rootDir: source, project: dirty.outputDir }).sourceVerification.status, 'working-tree-verified-unfixed');
    writeFileSync(changed, Buffer.concat([original, Buffer.from('\n// changed after dirty preparation\n')]));
    assert.throws(() => readWechatPreparedProject({ rootDir: source, project: dirty.outputDir }), /ERR_WECHAT_SOURCE_INPUT_MISMATCH/);
  } finally { writeFileSync(changed, original); }
  writeFileSync(join(source, 'source-history-marker.txt'), 'controlled later commit, outside runtime inputs\n');
  const git = args => execFileSync('git', ['-C', source, ...args], { stdio: 'pipe' });
  git(['add', 'source-history-marker.txt']);
  git(['-c', 'user.name=Wechat Preparation Contract', '-c', 'user.email=contracts@example.invalid', 'commit', '--quiet', '-m', 'later source history']);
  assert.throws(() => assertWechatSourceProvenance({ rootDir: source, manifest: dirty.manifest }), /ERR_WECHAT_DIRTY_SOURCE_HEAD_MISMATCH/);
  assert.equal(readWechatPreparedProject({ rootDir: source, project: prepared.outputDir }).sourceVerification.status, 'fixed-git-inputs-verified',
    'historical clean candidates remain anchored to their own real commit when HEAD advances');
});

function writeGame(directory) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'game.js'), '// controlled digest fixture; no Creator execution\n');
  writeFileSync(join(directory, 'game.json'), JSON.stringify({ deviceOrientation: 'landscape' }));
  writeFileSync(join(directory, 'project.config.json'), JSON.stringify({ compileType: 'game', appid: appId }));
}

test('game digest binds exact MiniGame entries, AppID and target instead of accepting Web artifacts', () => {
  const directory = join(temporary, 'game-digest');
  writeGame(directory);
  const first = wechatTreeDigest(directory, appId);
  assert.equal(first.digestScope, 'directory-tree/build/wechatgame');
  assert.equal(first.fileCount, 3);
  writeFileSync(join(directory, 'game.js'), '// changed\n');
  assert.notEqual(wechatTreeDigest(directory, appId).sha256, first.sha256);
  writeFileSync(join(directory, 'project.config.json'), JSON.stringify({ compileType: 'miniprogram', appid: appId }));
  assert.throws(() => wechatTreeDigest(directory, appId), /ERR_WECHAT_BUILD_PROJECT_CONFIG/);
  writeFileSync(join(directory, 'project.config.json'), JSON.stringify({ compileType: 'game', appid: 'wx0000000000000002' }));
  assert.throws(() => wechatTreeDigest(directory, appId), /ERR_WECHAT_BUILD_PROJECT_CONFIG/);
  writeGame(directory);
  rmSync(join(directory, 'game.js'));
  writeFileSync(join(directory, 'index.html'), 'not a MiniGame');
  assert.throws(() => wechatTreeDigest(directory, appId), /ERR_WECHAT_BUILD_ENTRY_MISSING:game.js/);
});

test('game digest records special filenames as own entries and detects their byte changes and removal', () => {
  const directory = join(temporary, 'special-filename-digest');
  writeGame(directory);
  const names = ['__proto__', 'constructor', 'toString'];
  for (const name of names) writeFileSync(join(directory, name), 'candidate A\n');
  const first = wechatTreeDigest(directory, appId);
  assert.equal(first.fileCount, 6);
  const serialized = JSON.parse(JSON.stringify(first));
  for (const name of names) {
    assert.equal(Object.hasOwn(first.files, name), true);
    assert.equal(Object.hasOwn(serialized.files, name), true);
    assert.equal(first.files[name].sha256, sha256(Buffer.from('candidate A\n')));
    writeFileSync(join(directory, name), 'candidate B\n');
    assert.notEqual(wechatTreeDigest(directory, appId).sha256, first.sha256, name);
    writeFileSync(join(directory, name), 'candidate A\n');
  }
  rmSync(join(directory, '__proto__'));
  const removed = wechatTreeDigest(directory, appId);
  assert.equal(removed.fileCount, 5);
  assert.notEqual(removed.sha256, first.sha256);
});

test('official-tool source checks reject cross-target records, changed prepared outputs and changed game bytes', () => {
  const game = join(prepared.outputDir, 'build/wechatgame');
  writeGame(game);
  writeFileSync(join(game, '__proto__'), 'candidate A\n');
  const recordPath = join(temporary, 'controlled-candidate-record.json');
  const manifest = prepared.manifest;
  const record = {
    format: 'cocos-wechat-candidate-record/v1', target: 'wechatgame', passed: true, creatorExitCode: 36,
    preparedManifestSha256: sha256(readFileSync(join(prepared.outputDir, 'probe-source-manifest.json'))),
    projectDir: prepared.outputDir, sourceCommit: manifest.sourceCommit, sourceDirty: manifest.sourceDirty,
    creatorVersion: manifest.creatorVersion, candidate_id: manifest.candidateIdentity.candidate_id, appId,
    version: manifest.version, buildId: manifest.buildId, inputs: manifest.inputs, dependencyInputs: manifest.dependencyInputs,
    toolInputs: Object.fromEntries(WECHAT_BUILD_TOOL_FILES.map(file => [file, sha256(readFileSync(join(root, file)))])),
    sourceVerification: assertWechatSourceProvenance({ rootDir: source, manifest }),
    preparedSurfaceAfter: capturePreparedSurface(prepared.outputDir, manifest), creatorNormalizations: [],
    gameBuild: wechatTreeDigest(game, appId)
  };
  writeFileSync(recordPath, JSON.stringify(record));
  const options = { rootDir: source, project: prepared.outputDir, buildRecord: recordPath };
  assert.equal(readWechatProbeSource(options).gameBuild.sha256, record.gameBuild.sha256);
  writeFileSync(recordPath, JSON.stringify({ ...record, target: 'web-desktop' }));
  assert.throws(() => readWechatProbeSource(options), /ERR_WECHAT_BUILD_RECORD_MISMATCH/);
  writeFileSync(recordPath, JSON.stringify({ ...record, toolInputs: { ...record.toolInputs, 'tools/cocos-wechat-probe/build.mjs': '0'.repeat(64) } }));
  assert.throws(() => readWechatProbeSource(options), /ERR_WECHAT_SOURCE_INPUT_MISMATCH/);
  writeFileSync(recordPath, JSON.stringify(record));
  const runtime = join(prepared.outputDir, 'assets/generated/probe-runtime.js');
  const original = readFileSync(runtime);
  try {
    writeFileSync(runtime, '// replaced public runtime');
    assert.throws(() => readWechatProbeSource(options), /ERR_WEB_PROBE_PREPARED_OUTPUT_CHANGED/);
  } finally { writeFileSync(runtime, original); }
  const enginePath = join(prepared.outputDir, 'settings/v2/packages/engine.json');
  const originalEngine = readFileSync(enginePath);
  try {
    const alteredEngine = JSON.parse(originalEngine);
    alteredEngine.modules.configs.defaultConfig.cache.tween._value = false;
    writeFileSync(enginePath, JSON.stringify(alteredEngine));
    const forgedSurface = capturePreparedSurface(prepared.outputDir, manifest);
    const forgedRecord = { ...record, preparedSurfaceAfter: forgedSurface,
      creatorNormalizations: checkPreparedSurfaceAfterBuild(manifest, forgedSurface) };
    writeFileSync(recordPath, JSON.stringify(forgedRecord));
    assert.throws(() => readWechatProbeSource(options), /ERR_WECHAT_ENGINE_NORMALIZATION_MISMATCH/,
      'rewriting a post-build record cannot authorize a changed engine feature');
  } finally {
    writeFileSync(enginePath, originalEngine);
    writeFileSync(recordPath, JSON.stringify(record));
  }
  writeFileSync(join(game, '__proto__'), 'candidate B\n');
  assert.throws(() => readWechatProbeSource(options), /ERR_WECHAT_BUILD_CONTENT_CHANGED/);
  writeFileSync(join(game, '__proto__'), 'candidate A\n');
  writeFileSync(join(game, 'game.js'), '// changed after build');
  assert.throws(() => readWechatProbeSource(options), /ERR_WECHAT_BUILD_CONTENT_CHANGED/);
});

test('a failed build attempt consumes its candidate and requires a fresh prepared identity', async () => {
  const failed = await prepare('failed-build-candidate');
  const fakeCreator = join(temporary, 'non-executable-creator/CocosCreator.exe');
  mkdirSync(join(temporary, 'non-executable-creator/resources/resources/3d/engine'), { recursive: true });
  writeFileSync(fakeCreator, 'deliberately invalid executable; this contract never launches Creator\n');
  writeFileSync(join(temporary, 'non-executable-creator/resources/resources/3d/engine/package.json'), JSON.stringify({ version: failed.manifest.creatorVersion }));
  const options = { creator: fakeCreator, project: failed.outputDir, logDir: join(temporary, 'failed-build-records'), rootDir: source };
  await assert.rejects(buildWechatProbe(options), /ERR_WECHAT_CREATOR_BUILD_FAILED/);
  const attempt = json(join(failed.outputDir, 'probe-build-attempt.json'));
  const record = json(join(attempt.recordDir, 'candidate-record.json'));
  assert.equal(record.passed, false);
  assert.equal(record.candidate_id, failed.manifest.candidateIdentity.candidate_id);
  assert.equal(record.gameBuild, null);
  assert.equal(record.developerToolVerification, 'not-executed-by-build');
  for (const [file, expected] of Object.entries(record.toolInputs)) assert.equal(sha256(readFileSync(join(root, file))), expected);
  await assert.rejects(buildWechatProbe(options), /ERR_WECHAT_CANDIDATE_ALREADY_BUILT/);
  const fresh = await prepare('new-candidate-after-failure');
  assert.notEqual(fresh.manifest.candidateIdentity.candidate_id, attempt.candidate_id);
  assert.equal(existsSync(join(fresh.outputDir, 'probe-build-attempt.json')), false);
  writeFileSync(join(temporary, 'non-executable-creator/resources/resources/3d/engine/package.json'), JSON.stringify({ version: 'wrong-engine-version' }));
  const preflightOptions = { ...options, project: fresh.outputDir };
  await assert.rejects(buildWechatProbe(preflightOptions), /ERR_WECHAT_CREATOR_BUILD_FAILED:[\s\S]*ERR_WECHAT_BUILD_CREATOR_VERSION_MISMATCH/);
  const preflightAttempt = json(join(fresh.outputDir, 'probe-build-attempt.json'));
  const preflightRecord = json(join(preflightAttempt.recordDir, 'candidate-record.json'));
  assert.equal(preflightRecord.passed, false);
  assert.equal(preflightRecord.creatorExitCode, null, 'version rejection must happen before launching any executable');
  await assert.rejects(buildWechatProbe(preflightOptions), /ERR_WECHAT_CANDIDATE_ALREADY_BUILT/);
});
