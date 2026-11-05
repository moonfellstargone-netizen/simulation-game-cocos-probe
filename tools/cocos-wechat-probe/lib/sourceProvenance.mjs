import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { deriveBuildId } from '../../quality/lib/versionSurface.mjs';

const TOOL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (root, path) => path === root || path.startsWith(root + sep);
const ENGINE_SOURCE = 'apps/cocos-wechat-probe/template/settings/v2/packages/engine.json';
const ENGINE_OUTPUT = 'settings/v2/packages/engine.json';
export const WECHAT_BUILD_TOOL_FILES = Object.freeze([
  'tools/cocos-wechat-probe/build.mjs', 'tools/cocos-wechat-probe/lib/source.mjs',
  'tools/cocos-wechat-probe/lib/sourceProvenance.mjs', 'tools/cocos-probe/lib/prepareProject.mjs',
  'tools/cocos-probe/lib/webProbeSupport.mjs'
]);
const REQUIRED_SOURCE_INPUTS = [
  'tools/cocos-wechat-probe/prepare.mjs', 'tools/cocos-probe/lib/prepareProject.mjs',
  'tools/cocos-wechat-probe/lib/precompiledSchemas.mjs',
  'tools/quality/lib/versionSurface.mjs', 'tools/quality/lib/projectTarget.mjs',
  'tools/quality/rules/project-target.json', 'package-lock.json',
  'design_snapshot/generated/stage_1A_runtime_snapshot.json',
  'apps/cocos-wechat-probe/template/package.json',
  ENGINE_SOURCE,
  'apps/cocos-wechat-probe/template/assets/Probe.scene',
  'apps/cocos-wechat-probe/template/assets/Probe.scene.meta',
  'apps/cocos-wechat-probe/template/assets/scripts/CocosWechatProbe.ts',
  'apps/cocos-wechat-probe/template/assets/scripts/WechatProbeController.ts',
  'apps/cocos-wechat-probe/template/assets/scripts/WechatSaveStoragePort.ts',
  'apps/cocos-wechat-probe/template/assets/scripts/WechatPriorSaveValidator.ts',
  'apps/cocos-wechat-probe/runtime/WechatDataClone.ts',
  'src/cocos-creator-adapter/index.ts', 'src/game-core/index.ts'
];

function canonicalPath(path) {
  if (typeof path !== 'string' || !path || isAbsolute(path) || /[\\:\r\n\0]/.test(path)
      || path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('ERR_WECHAT_SOURCE_INPUT_PATH');
  }
  return path;
}

function assertInputRecord(path, record, bytes) {
  const expected = typeof record === 'string' ? record : record?.sha256;
  if (typeof expected !== 'string' || !/^[a-f\d]{64}$/.test(expected) || sha256(bytes) !== expected
      || (typeof record !== 'string' && record?.bytes !== bytes.length)) {
    throw new Error('ERR_WECHAT_SOURCE_INPUT_MISMATCH:' + path);
  }
}

function git(root, args, input) {
  const result = spawnSync('git', ['-C', root, ...args], { input, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  if (result.status !== 0) throw new Error('ERR_WECHAT_SOURCE_GIT_UNAVAILABLE:' + args[0]);
  return result.stdout;
}

function readGitInputs(root, commit, records) {
  const paths = Object.keys(records).sort();
  for (const path of paths) canonicalPath(path);
  const output = git(root, ['cat-file', '--batch'], paths.map(path => commit + ':' + path + '\n').join(''));
  const bytes = new Map();
  let offset = 0;
  for (const path of paths) {
    const end = output.indexOf(10, offset);
    const header = output.subarray(offset, end).toString('utf8');
    const match = /^[a-f\d]{40} blob (\d+)$/.exec(header);
    if (end < offset || !match) throw new Error('ERR_WECHAT_SOURCE_GIT_BLOB_MISSING:' + path);
    const size = Number(match[1]);
    offset = end + 1;
    const value = output.subarray(offset, offset + size);
    if (value.length !== size || output[offset + size] !== 10) throw new Error('ERR_WECHAT_SOURCE_GIT_BATCH_INVALID');
    assertInputRecord(path, records[path], value);
    bytes.set(path, value);
    offset += size + 1;
  }
  if (offset !== output.length) throw new Error('ERR_WECHAT_SOURCE_GIT_BATCH_INVALID');
  return bytes;
}

function readDiskInputs(root, records) {
  const values = new Map();
  for (const [path, record] of Object.entries(records)) {
    canonicalPath(path);
    const target = resolve(root, path);
    if (!inside(root, target) || !inside(root, realpathSync(target))) throw new Error('ERR_WECHAT_SOURCE_INPUT_OUTSIDE_ROOT:' + path);
    const bytes = readFileSync(target);
    assertInputRecord(path, record, bytes);
    values.set(path, bytes);
  }
  return values;
}

/** Tie declared inputs to Git, or explicitly to the current unfixed working tree. */
export function assertWechatSourceProvenance({ rootDir, manifest, toolInputs, toolRoot = TOOL_ROOT }) {
  const root = realpathSync(rootDir);
  const trustedTools = realpathSync(toolRoot);
  if (!/^[a-f\d]{40}$/.test(manifest.sourceCommit) || typeof manifest.sourceDirty !== 'boolean') throw new Error('ERR_WECHAT_SOURCE_COMMIT_INVALID');
  const resolved = git(root, ['rev-parse', '--verify', manifest.sourceCommit + '^{commit}']).toString('utf8').trim();
  if (resolved !== manifest.sourceCommit) throw new Error('ERR_WECHAT_SOURCE_COMMIT_INVALID');
  if (!manifest.inputs || typeof manifest.inputs !== 'object' || Array.isArray(manifest.inputs)
      || REQUIRED_SOURCE_INPUTS.some(path => !Object.hasOwn(manifest.inputs, path))) throw new Error('ERR_WECHAT_SOURCE_INPUTS_INCOMPLETE');
  let source;
  if (manifest.sourceDirty) {
    if (git(root, ['rev-parse', 'HEAD']).toString('utf8').trim() !== manifest.sourceCommit) throw new Error('ERR_WECHAT_DIRTY_SOURCE_HEAD_MISMATCH');
    source = readDiskInputs(root, manifest.inputs);
  } else {
    source = readGitInputs(root, manifest.sourceCommit, manifest.inputs);
  }
  const engineBytes = source.get(ENGINE_SOURCE);
  if (manifest.outputs?.[ENGINE_OUTPUT]?.sha256 !== sha256(engineBytes)
      || manifest.outputs?.[ENGINE_OUTPUT]?.bytes !== engineBytes.length) {
    throw new Error('ERR_WECHAT_ENGINE_SOURCE_MISMATCH');
  }
  const target = JSON.parse(source.get('tools/quality/rules/project-target.json'));
  const snapshot = JSON.parse(source.get('design_snapshot/generated/stage_1A_runtime_snapshot.json'));
  if (manifest.version !== target.version?.codePackageVersion
      || manifest.buildId !== deriveBuildId('cocos_wechat_probe', target.version?.snakeVersion)
      || !Array.isArray(snapshot.schema_paths) || snapshot.schema_paths.length !== manifest.schemaCount
      || snapshot.schema_paths.some(path => !Object.hasOwn(manifest.inputs, 'design_snapshot/' + path))) {
    throw new Error('ERR_WECHAT_SOURCE_AUTHORITY_MISMATCH');
  }
  const precompiled = manifest.schemaPrecompilation;
  const paths = [...snapshot.schema_paths].sort();
  const schemaIds = paths.map(path => JSON.parse(source.get('design_snapshot/' + path)).$id).sort();
  if (!precompiled || precompiled.format !== 'wechat-schema-precompile/v1'
      || precompiled.schemaCount !== paths.length || !precompiled.schemaSources
      || JSON.stringify(Object.keys(precompiled.schemaSources).sort()) !== JSON.stringify(paths)
      || paths.some(path => precompiled.schemaSources[path] !== JSON.stringify(JSON.parse(source.get('design_snapshot/' + path))))
      || !precompiled.exportMap || Object.keys(precompiled.exportMap).some(name => !/^schema_\d{3}$/.test(name))
      || JSON.stringify(Object.values(precompiled.exportMap).sort()) !== JSON.stringify(schemaIds)
      || precompiled.compiler?.name !== 'ajv' || precompiled.compiler?.mode !== 'standalone-esm'
      || JSON.stringify(precompiled.compiler?.options) !== JSON.stringify({ strict: false, allErrors: true, allowUnionTypes: true, loopRequired: 1, code: { source: true, esm: true } })
      || precompiled.generatedModuleSha256 !== manifest.outputs?.['wechat-precompiled-validators.mjs']?.sha256
      || manifest.runtimeEntrySha256 !== manifest.outputs?.['wechat-runtime-entry.mjs']?.sha256) {
    throw new Error('ERR_WECHAT_SCHEMA_PRECOMPILE_SOURCE_MISMATCH');
  }
  if (manifest.dependencyInputRoot !== 'prepare-tool-installation/node_modules'
      || !manifest.dependencyInputs || typeof manifest.dependencyInputs !== 'object'
      || Array.isArray(manifest.dependencyInputs) || Object.keys(manifest.dependencyInputs).length === 0) {
    throw new Error('ERR_WECHAT_DEPENDENCY_INPUTS_INCOMPLETE');
  }
  readDiskInputs(realpathSync(join(trustedTools, 'node_modules')), manifest.dependencyInputs);
  const compilerPaths = precompiled.compilerDependencyInputs;
  const compilerPackage = JSON.parse(readFileSync(join(trustedTools, 'node_modules/ajv/package.json')));
  if (!Array.isArray(compilerPaths) || compilerPaths.length === 0 || new Set(compilerPaths).size !== compilerPaths.length
      || ['ajv/dist/2020.js', 'ajv/dist/standalone/index.js', 'ajv/package.json'].some(path => !compilerPaths.includes(path))
      || compilerPaths.some(path => !Object.hasOwn(manifest.dependencyInputs, path))
      || precompiled.compiler.version !== compilerPackage.version) {
    throw new Error('ERR_WECHAT_SCHEMA_COMPILER_INPUTS_MISMATCH');
  }
  if (toolInputs !== undefined) {
    if (!toolInputs || typeof toolInputs !== 'object' || JSON.stringify(Object.keys(toolInputs).sort()) !== JSON.stringify([...WECHAT_BUILD_TOOL_FILES].sort())) {
      throw new Error('ERR_WECHAT_BUILD_TOOL_INPUTS_INCOMPLETE');
    }
    if (manifest.sourceDirty) readDiskInputs(trustedTools, toolInputs);
    else readGitInputs(root, manifest.sourceCommit, toolInputs);
  }
  return { status: manifest.sourceDirty ? 'working-tree-verified-unfixed' : 'fixed-git-inputs-verified',
    sourceCommit: manifest.sourceCommit, inputCount: Object.keys(manifest.inputs).length,
    dependencyInputCount: Object.keys(manifest.dependencyInputs).length, dependencies: 'actual-tool-installation-verified' };
}

/** Permit only the Creator 3.8.8 profile migration observed in the real lite02 build. */
export function assertWechatEngineAfterBuild({ rootDir, manifest, projectDir }) {
  const root = realpathSync(rootDir);
  const records = { [ENGINE_SOURCE]: manifest.inputs[ENGINE_SOURCE] };
  const source = manifest.sourceDirty ? readDiskInputs(root, records) : readGitInputs(root, manifest.sourceCommit, records);
  const expected = JSON.parse(source.get(ENGINE_SOURCE));
  const actual = JSON.parse(readFileSync(join(projectDir, ENGINE_OUTPUT)));
  if (isDeepStrictEqual(actual, expected)) return;
  if (manifest.creatorVersion !== '3.8.8' || expected.__version__ !== '1.0.11') {
    throw new Error('ERR_WECHAT_ENGINE_NORMALIZATION_MISMATCH');
  }
  const config = expected.modules.configs.defaultConfig;
  const cache = config.cache;
  const additions = {
    'custom-pipeline': { _value: true }, 'custom-pipeline-post-process': { _value: false },
    'gfx-webgpu': { _value: false }, 'legacy-pipeline': { _value: false }, 'meshopt': { _value: false },
    'physics-2d-box2d-jsb': { _value: false },
    'physics-2d-box2d-wasm': { _value: false, _flags: { LOAD_BOX2D_MANUALLY: false } },
    'procedural-animation': { _value: false }, 'sorting-2d': { _value: false },
    'spine-3.8': { _value: cache.spine._value, _flags: { LOAD_SPINE_MANUALLY: false } },
    'spine-4.2': { _value: false, _flags: { LOAD_SPINE_MANUALLY: false } },
    'ui-skew': { _value: false }, 'vendor-google': { _value: false }
  };
  if (Object.keys(additions).some(key => Object.hasOwn(cache, key))
      || Object.hasOwn(cache['physics-ammo'], '_flags') || Object.hasOwn(cache['physics-physx'], '_flags')
      || Object.hasOwn(cache['render-pipeline'], '_value')) {
    throw new Error('ERR_WECHAT_ENGINE_NORMALIZATION_MISMATCH');
  }
  Object.assign(cache, additions);
  cache['physics-ammo']._flags = { LOAD_BULLET_MANUALLY: false };
  cache['physics-physx']._flags = { LOAD_PHYSX_MANUALLY: false };
  cache['render-pipeline']._value = true;
  config.includeModules.sort();
  expected.__version__ = '1.0.12';
  if (!isDeepStrictEqual(actual, expected)) throw new Error('ERR_WECHAT_ENGINE_NORMALIZATION_MISMATCH');
}
