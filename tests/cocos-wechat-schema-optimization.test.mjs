import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { createContext, Script } from 'node:vm';
import Ajv2020 from 'ajv/dist/2020.js';
import standaloneCode from 'ajv/dist/standalone/index.js';
import { build } from 'esbuild';
import { compileWechatSchemas } from '../tools/cocos-wechat-probe/lib/precompiledSchemas.mjs';
import { assertWechatSourceProvenance } from '../tools/cocos-wechat-probe/lib/sourceProvenance.mjs';
import { prepareWechatProbe } from '../tools/cocos-wechat-probe/prepare.mjs';

const root = process.cwd();
const snapshot = JSON.parse(readFileSync(join(root, 'design_snapshot/generated/stage_1A_runtime_snapshot.json'), 'utf8'));
const schemas = Object.fromEntries(snapshot.schema_paths.map(path => [
  path, JSON.parse(readFileSync(join(root, 'design_snapshot', path), 'utf8'))
]));
const ordered = Object.entries(schemas).sort(([a], [b]) => a.localeCompare(b));
const compilerOptions = { strict: false, allErrors: true, allowUnionTypes: true, loopRequired: 1, code: { source: true, esm: true } };

async function browserStandalone(code) {
  const output = await build({
    stdin: { contents: code, resolveDir: root, sourcefile: 'schema-standalone.mjs' },
    bundle: true, platform: 'browser', format: 'iife', globalName: 'schemaExports',
    minify: true, write: false, logLevel: 'silent'
  });
  const context = createContext({ Function: undefined });
  new Script(output.outputFiles[0].text).runInContext(context);
  assert.equal(context.Function, undefined, 'standalone does not restore or require dynamic Function');
  return context.schemaExports;
}

function snapshotSamples() {
  const values = [null, true, false, 0, 1, -1, '', 'x', [], {}, { x: 1 }];
  const pending = [snapshot.loaded_documents];
  while (pending.length && values.length < 161) {
    const value = pending.shift();
    if (value && typeof value === 'object') {
      values.push(value);
      for (const child of Object.values(value)) if (child && typeof child === 'object') pending.push(child);
    }
  }
  return values;
}

function samplesFor(schema) {
  const required = Array.isArray(schema.required) ? schema.required : [];
  const full = Object.fromEntries(required.map(name => [name, null]));
  const missingPairs = [];
  for (let i = 0; i < required.length; i++) {
    for (let j = i + 1; j < required.length; j++) {
      const value = { ...full };
      delete value[required[i]];
      delete value[required[j]];
      missingPairs.push(value);
    }
  }
  return [
    ...snapshotSamples(),
    full,
    ...required.map(name => { const value = { ...full }; delete value[name]; return value; }),
    ...missingPairs,
    { world_time: {} },
    { world_time: { world_day: 1 } },
    { world_time: { absolute_minute: 0 } }
  ];
}

function resultOf(validate, value) {
  const valid = validate(value);
  return JSON.stringify({ valid, errors: validate.errors });
}

test('production optimized standalone preserves decisions and full errors against dynamic and default standalone for all 58 schemas', { timeout: 120000 }, async () => {
  assert.equal(ordered.length, 58);
  const produced = compileWechatSchemas(schemas);
  assert.deepEqual(produced.compiler.options, compilerOptions);
  assert.equal(Object.hasOwn(produced.compiler.options, 'inlineRefs'), false);
  const optimized = (await browserStandalone(produced.moduleCode)).precompiledValidators;
  assert.deepEqual(Object.keys(optimized.validators).sort(), ordered.map(([, schema]) => schema.$id).sort());

  const dynamic = new Ajv2020({ strict: false, allErrors: true, allowUnionTypes: true });
  const defaultCompiler = new Ajv2020({ strict: false, allErrors: true, allowUnionTypes: true, code: { source: true, esm: true } });
  const exportMap = Object.create(null);
  ordered.forEach(([, schema], i) => {
    dynamic.addSchema(schema, schema.$id);
    defaultCompiler.addSchema(schema, schema.$id);
    exportMap['schema_' + String(i).padStart(3, '0')] = schema.$id;
  });
  const baseline = await browserStandalone(standaloneCode(defaultCompiler, exportMap));
  let comparisons = 0;
  let pairedSamples = 0;
  let verifiedRequiredOrder = false;
  for (let i = 0; i < ordered.length; i++) {
    const [path, schema] = ordered[i];
    const actual = optimized.validators[schema.$id];
    const defaultStandalone = baseline['schema_' + String(i).padStart(3, '0')];
    const defaultDynamic = dynamic.getSchema(schema.$id);
    assert.equal(typeof actual, 'function', path);
    assert.equal(typeof defaultDynamic, 'function', path);
    const samples = samplesFor(schema);
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (let first = 0; first < required.length; first++) {
      for (let second = first + 1; second < required.length; second++) {
        const present = required.filter((_, index) => index !== first && index !== second);
        const value = samples.find(sample => sample && !Array.isArray(sample) && typeof sample === 'object'
          && Object.keys(sample).length === present.length
          && present.every(name => Object.hasOwn(sample, name) && sample[name] === null));
        assert.ok(value, `missing pair ${required[first]}, ${required[second]} for ${path}`);
        pairedSamples++;
        defaultDynamic(value);
        const missing = (defaultDynamic.errors ?? []).filter(error => error.instancePath === '' && error.keyword === 'required')
          .map(error => error.params.missingProperty);
        if (missing.includes(required[first]) && missing.includes(required[second])) {
          actual(value);
          const optimizedMissing = Array.from(actual.errors ?? []).filter(error => error.instancePath === '' && error.keyword === 'required')
            .map(error => error.params.missingProperty);
          assert.deepEqual(optimizedMissing, missing, `required error order for ${path}`);
          verifiedRequiredOrder = true;
        }
      }
    }
    for (const [sampleIndex, value] of samples.entries()) {
      const expected = resultOf(defaultDynamic, value);
      assert.equal(resultOf(defaultStandalone, value), expected, `default standalone ${path} sample ${sampleIndex}`);
      assert.equal(resultOf(actual, value), expected, `optimized standalone ${path} sample ${sampleIndex}`);
      comparisons++;
    }
  }
  assert.ok(comparisons >= 9900, `required combinations and nested refs actually compared: ${comparisons}`);
  assert.ok(pairedSamples >= 2351, `paired required omissions actually included: ${pairedSamples}`);
  assert.ok(verifiedRequiredOrder, 'at least one missing pair preserves required error ordering');
  for (const id of ['initial_world.schema.json', 'save_file.schema.json']) {
    const validate = optimized.validators[id];
    validate({ world_time: {} });
    assert.ok(validate.errors.some(error => error.instancePath === '/world_time'
      && error.keyword === 'required' && error.schemaPath === 'time_state.schema.json/required'),
    `preserve referenced schema error path in ${id}`);
  }
});

test('prepared source binds exact optimized compiler options and rejects weakened or changed metadata', { timeout: 120000 }, async () => {
  const temp = mkdtempSync(join(tmpdir(), 'wechat-schema-optimization-'));
  try {
    const prepared = await prepareWechatProbe({ outputDir: join(temp, 'candidate'), appId: 'wx0000000000000001' });
    const manifest = prepared.manifest;
    assert.deepEqual(manifest.schemaPrecompilation.compiler.options, compilerOptions);
    assert.doesNotThrow(() => assertWechatSourceProvenance({ rootDir: root, manifest }));
    for (const mutate of [
      options => { delete options.loopRequired; },
      options => { options.loopRequired = 200; },
      options => { options.inlineRefs = false; },
      options => { options.allErrors = false; }
    ]) {
      const forged = structuredClone(manifest);
      mutate(forged.schemaPrecompilation.compiler.options);
      assert.throws(() => assertWechatSourceProvenance({ rootDir: root, manifest: forged }),
        /ERR_WECHAT_SCHEMA_PRECOMPILE_SOURCE_MISMATCH/);
    }
  } finally {
    const actual = realpathSync(temp);
    assert.ok(actual.startsWith(resolve(realpathSync(tmpdir())) + sep));
    assert.ok(basename(actual).startsWith('wechat-schema-optimization-'));
    rmSync(actual, { recursive: true, force: true });
  }
});
