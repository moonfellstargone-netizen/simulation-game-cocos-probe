import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { deriveBuildId } from '../quality/lib/versionSurface.mjs';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TEMPLATE_REL = 'apps/cocos-probe/template';
const SNAPSHOT_REL = 'design_snapshot/generated/stage_1A_runtime_snapshot.json';
const TARGET_REL = 'tools/quality/rules/project-target.json';
const RUNTIME_ENTRY = [
  "export { createStage1AHost, QinglanUiSceneProbeComponent } from './src/cocos-creator-adapter/index.ts';",
  "export { InMemorySaveStoragePort } from './src/game-core/index.ts';"
].join('\n');

const RESOURCE_PREFLIGHT = `
import { readFileSync } from 'node:fs';
try {
const input = JSON.parse(readFileSync(0, 'utf8'));
const runtime = await import('data:text/javascript;base64,' + input.runtime);
const host = runtime.createStage1AHost({
  ...input.resources,
  storage: new runtime.InMemorySaveStoragePort(),
  nowIso8601: '2000-01-01T00:00:00.000Z'
});
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

export function readProbeResources(rootDir = PROJECT_ROOT, inputs = new Map()) {
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
  return { snapshot, schemas, buildId: deriveBuildId('cocos_web_probe', snakeVersion) };
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

function templateFiles(root, inputs) {
  const files = new Map();
  function visit(rel) {
    for (const item of readdirSync(join(root, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = rel + '/' + item.name;
      if (item.isSymbolicLink()) throw new Error('ERR_PROBE_TEMPLATE_SYMLINK:' + child);
      if (item.isDirectory()) visit(child);
      else if (item.isFile()) files.set(child.slice(TEMPLATE_REL.length + 1), readSourceFile(root, child, inputs));
    }
  }
  visit(TEMPLATE_REL);
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
export async function prepareCocosProbe({ rootDir = PROJECT_ROOT, outputDir } = {}) {
  const root = realpathSync(resolve(rootDir));
  const output = assertOutputDirectory(root, outputDir);
  const inputs = new Map();
  // npm inputs have their own relative namespace even when the source root is the tool checkout.
  const dependencyRoot = realpathSync(join(PROJECT_ROOT, 'node_modules'));
  const dependencyInputs = new Map();
  const resources = readProbeResources(root, inputs);
  const files = templateFiles(root, inputs);
  readSourceFile(root, 'package-lock.json', inputs);
  for (const path of ['tools/cocos-probe/prepare.mjs', 'tools/quality/lib/versionSurface.mjs', 'tools/quality/lib/projectTarget.mjs']) {
    readSourceFile(root, path, inputs);
  }
  const bundled = await build({
    absWorkingDir: root,
    stdin: { contents: RUNTIME_ENTRY, resolveDir: root, sourcefile: 'cocos-probe-runtime-entry.ts', loader: 'ts' },
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
    input: JSON.stringify({ runtime: runtime.toString('base64'), resources }),
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    timeout: 30000,
    windowsHide: true
  });
  if (preflight.status !== 0) {
    throw new Error('ERR_PROBE_RESOURCE_PREFLIGHT:' + (preflight.error?.message ?? preflight.stderr.trim()));
  }
  for (const reserved of ['assets/generated/probe-runtime.js', 'assets/resources/probe-resources.json', 'probe-source-manifest.json']) {
    if (files.has(reserved)) throw new Error('ERR_PROBE_TEMPLATE_RESERVED_OUTPUT:' + reserved);
  }
  files.set('assets/generated/probe-runtime.js', runtime);
  files.set('assets/resources/probe-resources.json', asJson(resources));
  const source = gitSource(root);
  const projectTarget = JSON.parse(readFileSync(join(root, TARGET_REL), 'utf8'));
  const projectPackage = JSON.parse(files.get('package.json'));
  if (typeof projectPackage.creator?.version !== 'string' || !projectPackage.creator.version) {
    throw new Error('ERR_PROBE_CREATOR_VERSION_MISSING');
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
    format: 'cocos-probe-source/v1',
    sourceCommit: source.commit,
    sourceDirty: source.dirty,
    version: projectTarget.version.codePackageVersion,
    buildId: resources.buildId,
    creatorVersion: projectPackage.creator?.version,
    schemaCount: resources.snapshot.schema_paths.length,
    runtimeEntrySha256: sha256(RUNTIME_ENTRY),
    resourcePreflight: 'node-public-bootstrap-passed',
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--output') {
    console.error('Usage: node tools/cocos-probe/prepare.mjs --output <absolute-empty-directory-outside-repository>');
    process.exitCode = 1;
  } else {
    try {
      const result = await prepareCocosProbe({ outputDir: args[1] });
      console.log(JSON.stringify({ outputDir: result.outputDir, sourceCommit: result.manifest.sourceCommit,
        sourceDirty: result.manifest.sourceDirty, schemaCount: result.manifest.schemaCount, engineVerification: result.manifest.engineVerification }));
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
