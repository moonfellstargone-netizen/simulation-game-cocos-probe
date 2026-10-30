import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareCocosProbe } from '../tools/cocos-probe/prepare.mjs';

const root = process.cwd();
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
let temporary;
let source;
let prepared;

before(() => {
  temporary = mkdtempSync(join(tmpdir(), 'cocos-probe-contract-'));
  source = join(temporary, 'source');
  mkdirSync(source);
  for (const path of ['src', 'design_snapshot', 'tools', 'apps/cocos-probe']) {
    cpSync(join(root, path), join(source, path), { recursive: true });
  }
  cpSync(join(root, 'package-lock.json'), join(source, 'package-lock.json'));
  const git = (args) => execFileSync('git', ['-C', source, ...args], { stdio: 'pipe' });
  git(['init', '--quiet']);
  git(['add', '--all']);
  git(['-c', 'user.name=Preparation Contract', '-c', 'user.email=contracts@example.invalid', 'commit', '--quiet', '-m', 'temporary preparation inputs']);
});

after(() => {
  if (!temporary) return;
  const absolute = resolve(temporary);
  assert.ok(absolute.startsWith(resolve(tmpdir()) + sep));
  assert.ok(absolute.split(sep).at(-1).startsWith('cocos-probe-contract-'));
  rmSync(absolute, { recursive: true, force: true });
});

test('prepare derives a complete reproducible work copy with exact input and output hashes', async () => {
  prepared = await prepareCocosProbe({ rootDir: source, outputDir: join(temporary, 'engine-one') });
  const { manifest } = prepared;
  assert.equal(manifest.format, 'cocos-probe-source/v1');
  assert.match(manifest.sourceCommit, /^[a-f0-9]{40}$/);
  assert.equal(manifest.sourceDirty, false);
  assert.equal(manifest.creatorVersion, '3.8.8');
  assert.equal(manifest.schemaCount, 58);
  assert.equal(manifest.resourcePreflight, 'node-public-bootstrap-passed');
  assert.equal(manifest.engineVerification, 'not-executed-by-prepare');
  const projectSettings = json(join(prepared.outputDir, 'settings/v2/packages/project.json'));
  assert.equal(projectSettings.script?.loose, false,
    'Creator must preserve standard super/getter semantics; loose mode broke Ajv in the real browser');
  const target = json(join(source, 'tools/quality/rules/project-target.json'));
  assert.equal(manifest.version, target.version.codePackageVersion);
  assert.equal(manifest.buildId, 'cocos_web_probe_' + target.version.snakeVersion);
  for (const [path, recorded] of Object.entries(manifest.inputs)) {
    const bytes = readFileSync(join(source, path));
    assert.equal(recorded.sha256, sha256(bytes), path);
    assert.equal(recorded.bytes, bytes.length, path);
  }
  assert.equal(manifest.dependencyInputRoot, 'prepare-tool-installation/node_modules');
  assert.ok(Object.keys(manifest.dependencyInputs).some((path) => path.startsWith('ajv/')),
    'actual trusted npm runtime dependencies must have provenance too');
  const dependencyRoot = realpathSync(join(root, 'node_modules'));
  for (const [path, recorded] of Object.entries(manifest.dependencyInputs)) {
    assert.equal(isAbsolute(path), false);
    assert.equal(path.split('/').includes('..'), false);
    const canonical = realpathSync(join(dependencyRoot, path));
    assert.ok(canonical.startsWith(dependencyRoot + sep));
    const bytes = readFileSync(canonical);
    assert.equal(recorded.sha256, sha256(bytes), path);
    assert.equal(recorded.bytes, bytes.length, path);
  }
  assert.equal(Object.keys(manifest.inputs).some((path) => path.startsWith('node_modules/')), false,
    'source and dependency namespaces must not change meaning between a fixture and the real checkout');
  for (const [path, recorded] of Object.entries(manifest.outputs)) {
    const bytes = readFileSync(join(prepared.outputDir, path));
    assert.equal(recorded.sha256, sha256(bytes), path);
    assert.equal(recorded.bytes, bytes.length, path);
  }
  for (const file of ['index.ejs', 'probe-viewport.css', 'probe-viewport.js']) {
    const path = 'build-templates/web-desktop/' + file;
    const canonical = 'apps/cocos-probe/template/' + path;
    assert.ok(manifest.inputs[canonical], 'responsive build template input must be tracked: ' + file);
    assert.ok(manifest.outputs[path], 'responsive build template must be in the prepared engine project: ' + file);
    assert.deepEqual(readFileSync(join(prepared.outputDir, path)), readFileSync(join(source, canonical)));
  }
  const resources = json(join(prepared.outputDir, 'assets/resources/probe-resources.json'));
  const snapshot = json(join(source, 'design_snapshot/generated/stage_1A_runtime_snapshot.json'));
  assert.deepEqual(resources.snapshot, snapshot);
  assert.deepEqual(Object.keys(resources.schemas).sort(), [...snapshot.schema_paths].sort());
  for (const path of snapshot.schema_paths) {
    assert.ok(manifest.inputs['design_snapshot/' + path], 'declared resource provenance missing: ' + path);
    assert.deepEqual(resources.schemas[path], json(join(source, 'design_snapshot', path)), path);
  }
  for (const path of ['src/cocos-creator-adapter/bootstrap/Stage1ABootstrap.ts', 'src/cocos-creator-adapter/component/QinglanUiSceneProbeComponent.ts',
    'src/game-core/validation/RuntimeSchemaValidator.ts', 'package-lock.json', 'tools/quality/rules/project-target.json']) {
    assert.ok(manifest.inputs[path], 'source provenance missing: ' + path);
  }
  const repeated = await prepareCocosProbe({ rootDir: source, outputDir: join(temporary, 'engine-two') });
  assert.deepEqual(repeated.manifest, manifest);
});

test('the actual browser bundle runs public bootstrap, action, memory save/load and component disposal', async () => {
  assert.ok(prepared);
  const bytes = readFileSync(join(prepared.outputDir, 'assets/generated/probe-runtime.js'));
  const runtime = await import('data:text/javascript;base64,' + bytes.toString('base64'));
  const resources = json(join(prepared.outputDir, 'assets/resources/probe-resources.json'));
  const storage = new runtime.InMemorySaveStoragePort();
  const host = runtime.createStage1AHost({ ...resources, storage, nowIso8601: '2026-10-30T00:00:00.000Z' });
  const applied = new Map();
  const component = new runtime.QinglanUiSceneProbeComponent(host, {
    applyNodeBindingPatch(patch) { applied.set(patch.section, structuredClone(patch.payload)); }
  });
  await component.mount();
  const initial = structuredClone(host.requireSession().getViewModel());
  assert.deepEqual(applied.get('menu').view_model, initial);
  assert.equal((await component.execute({ name: 'save', selection: { slot_id: 'probe_contract' } })).command_result.status, 'completed');
  assert.equal((await component.execute({ name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 60 } })).command_result.status, 'completed');
  assert.notEqual(applied.get('menu').view_model.time_label, initial.time_label);
  assert.equal((await component.execute({ name: 'load', selection: { slot_id: 'probe_contract' } })).command_result.status, 'completed');
  assert.deepEqual(host.requireSession().getViewModel(), initial);
  assert.deepEqual(applied.get('menu').view_model, initial);
  await component.unmount();
  assert.equal(host.hasSession(), false);
  assert.equal(applied.get('lifecycle').has_session, false);
  assert.equal(Object.keys(prepared.manifest.inputs).some((path) => /^(?:tests\/|src\/game-core\/(?:dev(?:\/|-api\.)|testing(?:\/|-api\.)))/.test(path)), false);
});

test('unsafe or occupied destinations are rejected without replacing files', async () => {
  for (const outputDir of [undefined, 'relative-output', source, join(source, 'derived'), temporary]) {
    await assert.rejects(prepareCocosProbe({ rootDir: source, outputDir }), /ERR_PROBE_OUTPUT_/);
  }
  const occupied = join(temporary, 'occupied');
  mkdirSync(occupied);
  writeFileSync(join(occupied, 'keep.txt'), 'preserve');
  await assert.rejects(prepareCocosProbe({ rootDir: source, outputDir: occupied }), /ERR_PROBE_OUTPUT_NOT_EMPTY/);
  assert.equal(readFileSync(join(occupied, 'keep.txt'), 'utf8'), 'preserve');
});

test('an empty destination below a symlink or junction is rejected without writing through it', async () => {
  const actual = join(temporary, 'actual-output-parent');
  const alias = join(temporary, 'output-alias');
  mkdirSync(join(actual, 'empty'), { recursive: true });
  symlinkSync(actual, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(prepareCocosProbe({ rootDir: source, outputDir: join(alias, 'empty') }), /ERR_PROBE_OUTPUT_SYMLINK/);
  assert.equal(existsSync(join(actual, 'empty/probe-source-manifest.json')), false);
});

async function withChangedInput(path, value, name, expected) {
  const absolute = join(source, path);
  const original = readFileSync(absolute);
  const outputDir = join(temporary, name);
  try {
    if (value === null) rmSync(absolute);
    else writeFileSync(absolute, typeof value === 'function' ? value(original) : value);
    await assert.rejects(prepareCocosProbe({ rootDir: source, outputDir }), expected);
    assert.equal(existsSync(outputDir), false, 'invalid resources must not publish a work copy');
  } finally {
    writeFileSync(absolute, original);
  }
}

test('missing, malformed and noncanonical declared resources fail before publication', async () => {
  await withChangedInput('design_snapshot/schemas/action_request.schema.json', null, 'missing-schema', /ENOENT/);
  await withChangedInput('design_snapshot/schemas/action_request.schema.json', '{', 'invalid-json', /JSON/);
  await withChangedInput('design_snapshot/generated/stage_1A_runtime_snapshot.json', (bytes) => {
    const snapshot = JSON.parse(bytes);
    snapshot.schema_paths = ['../outside.schema.json'];
    return JSON.stringify(snapshot);
  }, 'unsafe-resource', /ERR_PROBE_SCHEMA_PATH_INVALID/);
});

test('unresolved references outside the nine runtime contracts still fail full resource readiness', async () => {
  await withChangedInput('design_snapshot/schemas/config/crop_config.schema.json', JSON.stringify({
    $id: 'crop_config.schema.json', $ref: 'missing_probe_resource.schema.json'
  }), 'broken-reference', /ERR_PROBE_RESOURCE_PREFLIGHT:[\s\S]*missing_probe_resource/);
});

test('missing required configuration is rejected by the actual bundled public bootstrap', async () => {
  await withChangedInput('design_snapshot/generated/stage_1A_runtime_snapshot.json', (bytes) => {
    const snapshot = JSON.parse(bytes);
    delete snapshot.loaded_documents['configs/core/new_game_builder_mapping.yaml'];
    return JSON.stringify(snapshot);
  }, 'missing-config', /ERR_PROBE_RESOURCE_PREFLIGHT:[\s\S]*ERR_CONFIG_DOC_NOT_LOADED/);
});

test('browser preparation rejects Node builtins and dev/testing entry leakage', async () => {
  await withChangedInput('src/cocos-creator-adapter/index.ts', (bytes) => bytes + "\nimport 'node:fs';\n", 'node-leak', /Could not resolve ["']node:fs/);
  await withChangedInput('src/game-core/index.ts', (bytes) => bytes + "\nexport * from './dev-api';\n", 'dev-leak', /ERR_PROBE_RUNTIME_TEST_DEPENDENCY/);
});

test('source imports cannot bundle an unrecorded relative dependency outside the source root', async () => {
  writeFileSync(join(temporary, 'outside-runtime.mjs'), "globalThis.__outsideProbeInput = 'outside-source-runtime';\n");
  await withChangedInput('src/cocos-creator-adapter/index.ts',
    (bytes) => bytes + "\nimport '../../../outside-runtime.mjs';\n",
    'outside-relative-input', /ERR_PROBE_RUNTIME_INPUT_OUTSIDE_ROOT/);
});

test('source imports cannot escape through an internal symlink or junction', async () => {
  const outside = join(temporary, 'outside-runtime-directory');
  mkdirSync(outside);
  writeFileSync(join(outside, 'runtime.mjs'), "globalThis.__outsideProbeInput = 'outside-symlink-runtime';\n");
  symlinkSync(outside, join(source, 'src/cocos-creator-adapter/linked-runtime'),
    process.platform === 'win32' ? 'junction' : 'dir');
  await withChangedInput('src/cocos-creator-adapter/index.ts',
    (bytes) => bytes + "\nimport './linked-runtime/runtime.mjs';\n",
    'outside-symlink-input', /ERR_PROBE_RUNTIME_INPUT_OUTSIDE_ROOT/);
});

test('uncommitted source is recorded truthfully without claiming an immutable release input', async () => {
  const path = join(source, 'src/cocos-creator-adapter/index.ts');
  const original = readFileSync(path);
  try {
    writeFileSync(path, Buffer.concat([original, Buffer.from('\n// preparation provenance control\n')]));
    const dirty = await prepareCocosProbe({ rootDir: source, outputDir: join(temporary, 'dirty-source') });
    assert.equal(dirty.manifest.sourceDirty, true);
    assert.equal(dirty.manifest.inputs['src/cocos-creator-adapter/index.ts'].sha256, sha256(readFileSync(path)));
  } finally {
    writeFileSync(path, original);
  }
});
