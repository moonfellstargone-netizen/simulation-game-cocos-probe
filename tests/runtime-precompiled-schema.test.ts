import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020';
import standaloneCode from 'ajv/dist/standalone';
import { build } from 'esbuild';
import { RuntimeSchemaValidator, type PrecompiledSchemaValidatorSet, type RuntimeConfigSnapshot } from '../src/game-core';

const root = process.cwd();
const snapshot = JSON.parse(readFileSync('design_snapshot/generated/stage_1A_runtime_snapshot.json', 'utf8')) as RuntimeConfigSnapshot;
const schemas: Record<string, unknown> = Object.fromEntries(snapshot.schema_paths.map(path => [path,
  JSON.parse(readFileSync('design_snapshot/' + path, 'utf8'))]));
let directory: string;
let precompiled: PrecompiledSchemaValidatorSet;

before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'runtime-precompiled-contract-'));
  const ajv = new Ajv2020({ strict: false, allErrors: true, allowUnionTypes: true, code: { source: true, esm: true } });
  const sources = Object.fromEntries(Object.entries(schemas).map(([path, schema]) => [path, JSON.stringify(schema)]));
  const exports: Record<string, string> = Object.create(null);
  Object.values(schemas).forEach((schema, index) => {
    const id = (schema as { $id: string }).$id;
    ajv.addSchema(schema as object, id);
    exports['schema_' + index] = id;
  });
  const generated = standaloneCode(ajv, exports)
    + '\nexport const precompiledValidators = { format: "runtime-precompiled-schemas/v1", schemaSources: '
    + JSON.stringify(sources) + ', validators: {'
    + Object.entries(exports).map(([name, id]) => JSON.stringify(id) + ':' + name).join(',') + '} };\n';
  const validators = await build({ stdin: { contents: generated, resolveDir: root, sourcefile: 'controlled-standalone-entry.mjs' },
    absWorkingDir: root, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'silent' });
  writeFileSync(join(directory, 'validators.mjs'), validators.outputFiles[0]!.contents);
  const runtime = await build({ stdin: { contents: [
    "export { RuntimeSchemaValidator, RuntimeContractValidator, InMemorySaveStoragePort } from './src/game-core/index.ts';",
    "export { createStage1AHost, QinglanUiSceneProbeComponent } from './src/cocos-creator-adapter/index.ts';"
  ].join('\n'), resolveDir: root, sourcefile: 'controlled-public-runtime-entry.ts' },
  absWorkingDir: root, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'silent' });
  writeFileSync(join(directory, 'runtime.mjs'), runtime.outputFiles[0]!.contents);
  writeFileSync(join(directory, 'resources.json'), JSON.stringify({ snapshot, schemas, buildId: 'precompiled_schema_contract' }));
  precompiled = (await import(pathToFileURL(join(directory, 'validators.mjs')).href)).precompiledValidators;
});

after(() => {
  if (!directory) return;
  const absolute = resolve(directory);
  assert.ok(absolute.startsWith(resolve(tmpdir()) + sep));
  assert.ok(absolute.split(sep).at(-1)!.startsWith('runtime-precompiled-contract-'));
  rmSync(absolute, { recursive: true, force: true });
});

test('precompiled formal schemas retain default dynamic validation decisions and normalized errors for all declared IDs', () => {
  const dynamic = RuntimeSchemaValidator.fromSnapshotSchemas(schemas);
  const compiled = RuntimeSchemaValidator.fromSnapshotSchemas(schemas, precompiled);
  const ids = Object.values(schemas).map(schema => (schema as { $id: string }).$id);
  assert.equal(ids.length, 58);
  dynamic.assertSchemasAvailable(ids);
  compiled.assertSchemasAvailable(ids);
  for (const [path, schema] of Object.entries(schemas)) {
    const id = (schema as { $id: string }).$id;
    for (const value of [null, {}, [], 0, '', true, { amount: 1, unit: 'g' }]) {
      assert.deepEqual(compiled.validate(id, value), dynamic.validate(id, value), id);
      assert.deepEqual(compiled.validate(path, value), dynamic.validate(path, value), path);
    }
  }
  assert.throws(() => compiled.assertSchemasAvailable(['missing_contract.schema.json']), /ERR_RUNTIME_SCHEMA_NOT_LOADED/);
});

test('precompiled sets reject missing, extra, mismatched, duplicate and asynchronous validator resources without fallback', () => {
  const copy = (): PrecompiledSchemaValidatorSet => ({ ...precompiled,
    schemaSources: { ...precompiled.schemaSources }, validators: { ...precompiled.validators } });
  const firstPath = Object.keys(schemas)[0]!;
  const firstId = (schemas[firstPath] as { $id: string }).$id;
  const firstFunction = precompiled.validators[firstId]!;
  const invalid: unknown[] = [null, {}, { ...copy(), format: 'unrecognized' }];
  const missingSource = copy();
  delete (missingSource.schemaSources as Record<string, string>)[firstPath];
  invalid.push(missingSource);
  invalid.push({ ...copy(), schemaSources: { ...precompiled.schemaSources, 'schemas/unexpected.schema.json': '{}' } });
  invalid.push({ ...copy(), schemaSources: { ...precompiled.schemaSources, [firstPath]: '{}' } });
  const missingValidator = copy();
  delete (missingValidator.validators as Record<string, ValidateFunction>)[firstId];
  invalid.push(missingValidator);
  invalid.push({ ...copy(), validators: { ...precompiled.validators, 'unexpected.schema.json': firstFunction } });
  invalid.push({ ...copy(), validators: { ...precompiled.validators, [firstId]: null } });
  invalid.push({ ...copy(), validators: { ...precompiled.validators, [firstId]: async () => false } });
  const asyncMarked = Object.assign((value: unknown) => firstFunction(value), { $async: true });
  invalid.push({ ...copy(), validators: { ...precompiled.validators, [firstId]: asyncMarked } });
  for (const input of invalid) {
    assert.throws(() => RuntimeSchemaValidator.fromSnapshotSchemas(schemas, input as PrecompiledSchemaValidatorSet), /ERR_PRECOMPILED_SCHEMA_/);
  }
  const changed = structuredClone(schemas);
  (changed[firstPath] as Record<string, unknown>).title = 'changed formal source';
  assert.throws(() => RuntimeSchemaValidator.fromSnapshotSchemas(changed, precompiled), /ERR_PRECOMPILED_SCHEMA_SOURCE_MISMATCH/);
  const duplicate = structuredClone(schemas);
  const secondPath = Object.keys(duplicate)[1]!;
  (duplicate[secondPath] as Record<string, unknown>).$id = firstId;
  const matchingSources = Object.fromEntries(Object.entries(duplicate).map(([path, schema]) => [path, JSON.stringify(schema)]));
  assert.throws(() => RuntimeSchemaValidator.fromSnapshotSchemas(duplicate, { ...copy(), schemaSources: matchingSources }), /ERR_PRECOMPILED_SCHEMA_ID_DUPLICATE/);
  const invalidResult = { ...copy(), validators: { ...precompiled.validators,
    [firstId]: (() => ({ incorrect: 'not a synchronous boolean' })) as unknown as ValidateFunction } };
  const guarded = RuntimeSchemaValidator.fromSnapshotSchemas(schemas, invalidResult);
  assert.throws(() => guarded.validate(firstId, {}), /ERR_PRECOMPILED_SCHEMA_RESULT_INVALID/);
  assert.throws(() => guarded.assertValid(firstId, {}), /ERR_PRECOMPILED_SCHEMA_RESULT_INVALID/);
});

test('public compiled bootstrap and formal action run in an isolated process with dynamic Function disabled', () => {
  const script = `
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const directory = process.argv[1];
const input = JSON.parse(readFileSync(directory + '/resources.json', 'utf8'));
let dynamicAttempts = 0;
globalThis.Function = new Proxy(globalThis.Function, {
  construct() { dynamicAttempts++; throw new Error('ERR_TEST_DYNAMIC_FUNCTION_DISABLED'); },
  apply() { dynamicAttempts++; throw new Error('ERR_TEST_DYNAMIC_FUNCTION_DISABLED'); }
});
const runtime = await import(pathToFileURL(directory + '/runtime.mjs').href);
const { precompiledValidators } = await import(pathToFileURL(directory + '/validators.mjs').href);
const validator = runtime.RuntimeSchemaValidator.fromSnapshotSchemas(input.schemas, precompiledValidators);
validator.assertSchemasAvailable(Object.values(input.schemas).map(schema => schema.$id));
for (const id of ['save_file.schema.json', 'action_request.schema.json']) {
  assert.throws(() => validator.assertValid(id, {}), /ERR_SCHEMA_VALIDATION_FAILED/);
}
let reads = 0;
let writes = 0;
const storage = { read: async () => { reads++; return null; }, write: async () => { writes++; } };
const options = { ...input, storage, nowIso8601: '2026-11-03T00:00:00.000Z', precompiledValidators };
const host = runtime.createStage1AHost(options);
const component = new runtime.QinglanUiSceneProbeComponent(host, { applyNodeBindingPatch() {} });
await component.mount();
assert.equal(host.requireSession().getViewModel().time_label, 'day 1 minute 360');
const result = await component.execute({ name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 60 } });
assert.equal(result.command_result.status, 'completed');
assert.equal(result.command_result.snapshot.menu.last_action_result.success, true);
assert.equal(host.requireSession().getViewModel().time_label, 'day 1 minute 420');
await component.unmount();
assert.equal(host.hasSession(), false);
const changed = JSON.parse(JSON.stringify(input.schemas));
changed[Object.keys(changed)[0]].title = 'controlled source mismatch';
assert.throws(() => runtime.createStage1AHost({ ...options, schemas: changed }), /ERR_PRECOMPILED_SCHEMA_SOURCE_MISMATCH/);
const missing = { ...precompiledValidators, validators: { ...precompiledValidators.validators } };
delete missing.validators[Object.keys(missing.validators)[0]];
assert.throws(() => runtime.createStage1AHost({ ...options, precompiledValidators: missing }), /ERR_PRECOMPILED_SCHEMA_VALIDATORS_MISMATCH/);
assert.equal(reads, 0);
assert.equal(writes, 0);
assert.equal(dynamicAttempts, 0, 'the compiled path must not attempt dynamic code generation');
assert.throws(() => runtime.createStage1AHost({ ...options, precompiledValidators: undefined }), /ERR_TEST_DYNAMIC_FUNCTION_DISABLED/);
assert.ok(dynamicAttempts > 0, 'the restricted-process guard must reject the unchanged default dynamic path');
console.log(JSON.stringify({ compiledStartup: true, formalAdvance: true, invalidDataRejected: true, invalidResourcesRejected: true, storageReads: reads, storageWrites: writes, dynamicGuardVerified: true }));
`;
  const stdout = execFileSync(process.execPath, ['--input-type=module', '--eval', script, directory], { encoding: 'utf8', timeout: 30000, windowsHide: true });
  assert.deepEqual(JSON.parse(stdout.trim()), { compiledStartup: true, formalAdvance: true, invalidDataRejected: true,
    invalidResourcesRejected: true, storageReads: 0, storageWrites: 0, dynamicGuardVerified: true });
});
