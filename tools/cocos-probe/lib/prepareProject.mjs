import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { deriveBuildId } from '../../quality/lib/versionSurface.mjs';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const PROFILES = Object.freeze({
  web: Object.freeze({ templateRel: 'apps/cocos-probe/template', role: 'cocos_web_probe', format: 'cocos-probe-source/v1', wrapper: 'tools/cocos-probe/prepare.mjs' }),
  wechat: Object.freeze({ templateRel: 'apps/cocos-wechat-probe/template', role: 'cocos_wechat_probe', format: 'cocos-wechat-probe-source/v1', wrapper: 'tools/cocos-wechat-probe/prepare.mjs' })
});

function profileFor(name) {
  if (!Object.hasOwn(PROFILES, name)) throw new Error('ERR_PROBE_PROFILE_INVALID');
  return PROFILES[name];
}

export function assertWechatAppId(appId) {
  if (typeof appId !== 'string' || !/^wx[a-f0-9]{16}$/.test(appId) || appId === 'wx6ac3f5090a6b99c5') {
    throw new Error('ERR_WECHAT_APP_ID_REQUIRED');
  }
  return appId;
}
const SNAPSHOT_REL = 'design_snapshot/generated/stage_1A_runtime_snapshot.json';
const TARGET_REL = 'tools/quality/rules/project-target.json';
const RUNTIME_ENTRY = [
  "export { createStage1AHost, QinglanUiSceneProbeComponent } from './src/cocos-creator-adapter/index.ts';",
  "export { InMemorySaveStoragePort } from './src/game-core/index.ts';"
].join('\n');
const WECHAT_RUNTIME_ENTRY = [
  "import { createStage1AHost as bootstrap, QinglanUiSceneProbeComponent } from './src/cocos-creator-adapter/index.ts';",
  "import { precompiledValidators } from 'wechat-generated-schema-validators';",
  'export { QinglanUiSceneProbeComponent };',
  "export { InMemorySaveStoragePort } from './src/game-core/index.ts';",
  'export function createStage1AHost(input) { return bootstrap({ ...input, precompiledValidators }); }'
].join('\n');

const RESOURCE_PREFLIGHT = `
import { readFileSync } from 'node:fs';
try {
const input = JSON.parse(readFileSync(0, 'utf8'));
// Only the verification subprocess simulates a platform without dynamic Function.
// The generated runtime never modifies global Function or eval.
if (input.aot) Object.defineProperty(globalThis, 'Function', { value: undefined, writable: false, configurable: false });
const runtime = await import('data:text/javascript;base64,' + input.runtime);
const host = runtime.createStage1AHost({
  ...input.resources,
  storage: new runtime.InMemorySaveStoragePort(),
  nowIso8601: '2000-01-01T00:00:00.000Z'
});
if (input.aot) {
  const component = new runtime.QinglanUiSceneProbeComponent(host, { applyNodeBindingPatch() {} });
  await component.mount();
  const result = await component.execute({ name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 60 } });
  if (result.command_result.status !== 'completed' || result.command_result.snapshot?.menu?.last_action_result?.success !== true) {
    throw new Error('ERR_WECHAT_AOT_ACTION_PREFLIGHT');
  }
  const beforeInvalid = JSON.stringify(host.requireSession().getViewModel());
  const invalid = host.requireSession().dispatch('advance_time', null);
  if (invalid.success !== false || invalid.status_code !== 'ERR_SCHEMA_VALIDATION_FAILED'
      || JSON.stringify(host.requireSession().getViewModel()) !== beforeInvalid) {
    throw new Error('ERR_WECHAT_AOT_REJECTION_PREFLIGHT');
  }
  await component.unmount();
}
host.destroySession();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
`;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const asJson = (value) => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const inside = (parent, child) => child === parent || child.startsWith(parent + sep);

function assertCanonicalResourcePath(path) {
  if (typeof path !== 'string' || !path.startsWith('schemas/') || !path.endsWith('.schema.json')
      || path.includes('\\') || path.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('ERR_PROBE_SCHEMA_PATH_INVALID:' + String(path));
  }
}

function readSourceFile(root, rel, inputs) {
  const absolute = resolve(root, rel);
  if (!inside(root, absolute) || !inside(root, realpathSync(absolute))) {
    throw new Error('ERR_PROBE_SOURCE_OUTSIDE_ROOT:' + rel);
  }
  const bytes = readFileSync(absolute);
  inputs.set(rel.replaceAll('\\', '/'), { bytes: bytes.length, sha256: sha256(bytes) });
  return bytes;
}

function readDependencyFile(dependencyRoot, rel, inputs) {
  const absolute = resolve(dependencyRoot, rel);
  if (!inside(dependencyRoot, absolute) || !inside(dependencyRoot, realpathSync(absolute))) {
    throw new Error('ERR_PROBE_RUNTIME_INPUT_OUTSIDE_ROOT:' + rel);
  }
  const bytes = readFileSync(absolute);
  inputs.set(rel.replaceAll('\\', '/'), { bytes: bytes.length, sha256: sha256(bytes) });
  return bytes;
}

function runtimeLoader(path) {
  const extension = extname(path).toLowerCase();
  if (['.ts', '.mts', '.cts'].includes(extension)) return 'ts';
  if (['.js', '.mjs', '.cjs'].includes(extension)) return 'js';
  if (extension === '.tsx') return 'tsx';
  if (extension === '.jsx') return 'jsx';
  if (extension === '.json') return 'json';
  throw new Error('ERR_PROBE_RUNTIME_INPUT_UNSUPPORTED:' + path);
}

export function readPreparedProbeResources(rootDir = PROJECT_ROOT, inputs = new Map(), profileName = 'web') {
  const profile = profileFor(profileName);
  const root = realpathSync(resolve(rootDir));
  const snapshot = JSON.parse(readSourceFile(root, SNAPSHOT_REL, inputs));
  if (!Array.isArray(snapshot.schema_paths) || snapshot.schema_paths.length === 0) {
    throw new Error('ERR_PROBE_SCHEMA_DECLARATION_INVALID');
  }
  const schemas = {};
  for (const path of snapshot.schema_paths) {
    assertCanonicalResourcePath(path);
    if (Object.hasOwn(schemas, path)) throw new Error('ERR_PROBE_SCHEMA_PATH_DUPLICATE:' + path);
    schemas[path] = JSON.parse(readSourceFile(root, 'design_snapshot/' + path, inputs));
  }
  const projectTarget = JSON.parse(readSourceFile(root, TARGET_REL, inputs));
  const snakeVersion = projectTarget.version?.snakeVersion;
  if (typeof snakeVersion !== 'string' || !snakeVersion) throw new Error('ERR_PROBE_VERSION_MISSING');
  return { snapshot, schemas, buildId: deriveBuildId(profile.role, snakeVersion) };
}

function assertOutputDirectory(root, outputDir) {
  if (typeof outputDir !== 'string' || !outputDir.trim() || !isAbsolute(outputDir)) {
    throw new Error('ERR_PROBE_OUTPUT_ABSOLUTE_REQUIRED');
  }
  const output = resolve(outputDir);
  let existing = output;
  while (!existsSync(existing)) existing = dirname(existing);
  for (let current = existing; ; current = dirname(current)) {
    if (lstatSync(current).isSymbolicLink()) throw new Error('ERR_PROBE_OUTPUT_SYMLINK');
    if (dirname(current) === current) break;
  }
  const resolvedOutput = resolve(realpathSync(existing), relative(existing, output));
  if (inside(root, resolvedOutput) || inside(resolvedOutput, root)) {
    throw new Error('ERR_PROBE_OUTPUT_OVERLAPS_SOURCE');
  }
  if (existsSync(output) && (!lstatSync(output).isDirectory() || readdirSync(output).length > 0)) {
    throw new Error('ERR_PROBE_OUTPUT_NOT_EMPTY');
  }
  return output;
}

function templateFiles(root, inputs, templateRel) {
  const files = new Map();
  function visit(rel) {
    for (const item of readdirSync(join(root, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = rel + '/' + item.name;
      if (item.isSymbolicLink()) throw new Error('ERR_PROBE_TEMPLATE_SYMLINK:' + child);
      if (item.isDirectory()) visit(child);
      else if (item.isFile()) files.set(child.slice(templateRel.length + 1), readSourceFile(root, child, inputs));
    }
  }
  visit(templateRel);
  if (!files.has('package.json')) throw new Error('ERR_PROBE_TEMPLATE_PROJECT_MISSING');
  return files;
}

function gitSource(root) {
  const run = (args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true });
  const head = run(['rev-parse', 'HEAD']);
  const status = run(['status', '--porcelain=v1', '--untracked-files=normal']);
  if (head.status !== 0 || status.status !== 0) throw new Error('ERR_PROBE_SOURCE_GIT_UNAVAILABLE');
  return { commit: head.stdout.trim(), dirty: status.stdout.trim().length > 0 };
}

/** Creates a derived engine work copy; it does not run or prove Cocos compatibility. */
export async function prepareProbeProject({ rootDir = PROJECT_ROOT, outputDir, profileName = 'web', appId } = {}) {
  const profile = profileFor(profileName);
  if (profileName === 'wechat') assertWechatAppId(appId);
  const root = realpathSync(resolve(rootDir));
  const output = assertOutputDirectory(root, outputDir);
  const inputs = new Map();
  // npm inputs have their own relative namespace even when the source root is the tool checkout.
  const dependencyRoot = realpathSync(join(PROJECT_ROOT, 'node_modules'));
  const dependencyInputs = new Map();
  const resources = readPreparedProbeResources(root, inputs, profileName);
  const files = templateFiles(root, inputs, profile.templateRel);
  readSourceFile(root, 'package-lock.json', inputs);
  for (const path of [profile.wrapper, 'tools/cocos-probe/lib/prepareProject.mjs', 'tools/quality/lib/versionSurface.mjs', 'tools/quality/lib/projectTarget.mjs']) {
    readSourceFile(root, path, inputs);
  }
  let precompiled = null;
  if (profileName === 'wechat') {
    readSourceFile(root, 'tools/cocos-wechat-probe/lib/precompiledSchemas.mjs', inputs);
    const { compileWechatSchemas } = await import('../../cocos-wechat-probe/lib/precompiledSchemas.mjs');
    try { precompiled = compileWechatSchemas(resources.schemas); }
    catch (error) { throw new Error('ERR_PROBE_SCHEMA_PRECOMPILE:' + (error instanceof Error ? error.message : String(error))); }
    // Node-side compiler execution is not part of esbuild's browser metafile.
    // Record its actual loaded CommonJS closure in the existing dependency namespace.
    for (const path of precompiled.compilerDependencyPaths) {
      readDependencyFile(dependencyRoot, relative(dependencyRoot, realpathSync(path)), dependencyInputs);
    }
  }
  const runtimeEntry = profileName === 'wechat' ? WECHAT_RUNTIME_ENTRY : RUNTIME_ENTRY;
  const bundled = await build({
    absWorkingDir: root,
    stdin: { contents: runtimeEntry, resolveDir: root, sourcefile: 'cocos-probe-runtime-entry.ts', loader: 'ts' },
    bundle: true,
    write: false,
    outfile: 'probe-runtime.js',
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    treeShaking: true,
    metafile: true,
    logLevel: 'silent',
    nodePaths: [join(PROJECT_ROOT, 'node_modules')],
    plugins: [{
      name: 'record-canonical-runtime-inputs',
      setup(bundler) {
        if (precompiled) {
          bundler.onResolve({ filter: /^wechat-generated-schema-validators$/ }, () => ({ path: 'wechat-generated-schema-validators', namespace: 'wechat-aot' }));
          bundler.onLoad({ filter: /.*/, namespace: 'wechat-aot' }, () => ({ contents: precompiled.moduleCode, loader: 'js', resolveDir: root }));
        }
        bundler.onLoad({ filter: /.*/, namespace: 'file' }, (args) => {
          const canonical = realpathSync(args.path);
          let bytes;
          if (inside(dependencyRoot, canonical)) {
            bytes = readDependencyFile(dependencyRoot, relative(dependencyRoot, canonical), dependencyInputs);
          } else if (inside(root, canonical) && !inside(join(root, 'node_modules'), canonical)) {
            bytes = readSourceFile(root, relative(root, canonical), inputs);
          } else {
            throw new Error('ERR_PROBE_RUNTIME_INPUT_OUTSIDE_ROOT:' + args.path);
          }
          return { contents: bytes.toString('utf8'), loader: runtimeLoader(canonical) };
        });
      }
    }]
  });
  for (const name of Object.keys(bundled.metafile.inputs)) {
    const normalized = name.replaceAll('\\', '/');
    if (/^src\/game-core\/(?:dev(?:\/|-api\.)|testing(?:\/|-api\.))/.test(normalized)
        || normalized.startsWith('tests/')) {
      throw new Error('ERR_PROBE_RUNTIME_TEST_DEPENDENCY:' + normalized);
    }
  }
  if (Object.values(bundled.metafile.outputs).some((item) => item.imports.some((entry) => entry.external))) {
    throw new Error('ERR_PROBE_RUNTIME_EXTERNAL_DEPENDENCY');
  }
  // Build dependencies are fixed by package-lock; the plugin records exact runtime source bytes.
  const runtime = Buffer.from(bundled.outputFiles[0].contents);
  const preflight = spawnSync(process.execPath, ['--input-type=module', '--eval', RESOURCE_PREFLIGHT], {
    input: JSON.stringify({ runtime: runtime.toString('base64'), resources, aot: profileName === 'wechat' }),
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    timeout: 30000,
    windowsHide: true
  });
  if (preflight.status !== 0) {
    throw new Error('ERR_PROBE_RESOURCE_PREFLIGHT:' + (preflight.error?.message ?? preflight.stderr.trim()));
  }
  const reservedOutputs = ['assets/generated/probe-runtime.js', 'assets/resources/probe-resources.json', 'probe-source-manifest.json'];
  if (profileName === 'wechat') reservedOutputs.push('assets/resources/candidate-identity.json', 'wechat-build-options.json', 'probe-build-attempt.json',
    'wechat-precompiled-validators.mjs', 'wechat-schema-precompile.json', 'wechat-runtime-entry.mjs');
  for (const reserved of reservedOutputs) {
    if (files.has(reserved)) throw new Error('ERR_PROBE_TEMPLATE_RESERVED_OUTPUT:' + reserved);
  }
  files.set('assets/generated/probe-runtime.js', runtime);
  files.set('assets/resources/probe-resources.json', asJson(resources));
  let schemaPrecompilation;
  if (precompiled) {
    const generated = Buffer.from(precompiled.moduleCode);
    const compilerDependencyInputs = precompiled.compilerDependencyPaths.map(path => relative(dependencyRoot, realpathSync(path)).replaceAll('\\', '/')).sort();
    schemaPrecompilation = { format: 'wechat-schema-precompile/v1', compiler: precompiled.compiler,
      schemaCount: precompiled.schemaIds.length, exportMap: precompiled.exportMap, schemaSources: precompiled.schemaSources,
      compilerDependencyInputs, generatedModuleSha256: sha256(generated) };
    files.set('wechat-precompiled-validators.mjs', generated);
    files.set('wechat-schema-precompile.json', asJson(schemaPrecompilation));
    files.set('wechat-runtime-entry.mjs', Buffer.from(runtimeEntry));
  }
  const source = gitSource(root);
  const projectTarget = JSON.parse(readFileSync(join(root, TARGET_REL), 'utf8'));
  const projectPackage = JSON.parse(files.get('package.json'));
  if (typeof projectPackage.creator?.version !== 'string' || !projectPackage.creator.version) {
    throw new Error('ERR_PROBE_CREATOR_VERSION_MISSING');
  }
  let candidateIdentity;
  if (profileName === 'wechat') {
    candidateIdentity = Object.freeze({
      schema: 'wechat-candidate/v1', candidate_id: 'wechat-' + randomUUID(),
      source_commit: source.commit, short_commit: source.commit.slice(0, 12),
      version: projectTarget.version.codePackageVersion, build_id: resources.buildId
    });
    const scene = JSON.parse(files.get('assets/Probe.scene.meta')?.toString('utf8') ?? 'null');
    if (!scene || typeof scene.uuid !== 'string' || !/^[a-f\d-]{36}$/i.test(scene.uuid)) {
      throw new Error('ERR_WECHAT_SCENE_UUID_INVALID');
    }
    files.set('assets/resources/candidate-identity.json', asJson(candidateIdentity));
    files.set('wechat-build-options.json', asJson({
      platform: 'wechatgame', taskName: 'wechatgame', outputName: 'wechatgame', buildPath: 'project://build',
      debug: true, startScene: scene.uuid, scenes: [{ url: 'db://assets/Probe.scene', uuid: scene.uuid }],
      packages: { wechatgame: { appid: appId, orientation: 'landscape', separateEngine: false, buildOpenDataContextTemplate: false } }
    }));
  }
  for (const [name, recorded] of inputs) {
    if (sha256(readSourceFile(root, name, new Map())) !== recorded.sha256) {
      throw new Error('ERR_PROBE_SOURCE_CHANGED_DURING_PREPARE:' + name);
    }
  }
  for (const [name, recorded] of dependencyInputs) {
    if (sha256(readDependencyFile(dependencyRoot, name, new Map())) !== recorded.sha256) {
      throw new Error('ERR_PROBE_SOURCE_CHANGED_DURING_PREPARE:node_modules/' + name);
    }
  }
  const manifest = {
    format: profile.format,
    ...(profileName === 'wechat' ? { target: 'wechatgame', appId, candidateIdentity, schemaPrecompilation } : {}),
    sourceCommit: source.commit,
    sourceDirty: source.dirty,
    version: projectTarget.version.codePackageVersion,
    buildId: resources.buildId,
    creatorVersion: projectPackage.creator?.version,
    schemaCount: resources.snapshot.schema_paths.length,
    runtimeEntrySha256: sha256(runtimeEntry),
    resourcePreflight: profileName === 'wechat' ? 'node-aot-public-bootstrap-passed' : 'node-public-bootstrap-passed',
    engineVerification: 'not-executed-by-prepare',
    inputs: Object.fromEntries([...inputs].sort(([a], [b]) => a.localeCompare(b))),
    dependencyInputRoot: 'prepare-tool-installation/node_modules',
    dependencyInputs: Object.fromEntries([...dependencyInputs].sort(([a], [b]) => a.localeCompare(b))),
    outputs: Object.fromEntries([...files].sort(([a], [b]) => a.localeCompare(b)).map(([name, bytes]) => [name, {
      bytes: bytes.length, sha256: sha256(bytes)
    }]))
  };
  // Repeat after asynchronous build/preflight so an occupied destination is never overwritten.
  assertOutputDirectory(root, output);
  mkdirSync(output, { recursive: true });
  for (const [name, bytes] of files) {
    const target = join(output, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes, { flag: 'wx' });
  }
  writeFileSync(join(output, 'probe-source-manifest.json'), asJson(manifest), { flag: 'wx' });
  return { outputDir: output, manifest };
}
