import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { capturePreparedSurface, checkPreparedSurfaceAfterBuild, webTreeDigest } from './lib/webProbeSupport.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const isWithin = (parent, child) => {
  const rel = relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel));
};
const prospectivePath = (value) => {
  let ancestor = resolve(value);
  const suffix = [];
  while (!existsSync(ancestor)) {
    suffix.unshift(relative(dirname(ancestor), ancestor));
    ancestor = dirname(ancestor);
  }
  return resolve(realpathSync(ancestor), ...suffix);
};

export async function buildCocosProbe({ creator, project, logDir } = {}) {
  for (const [name, value] of Object.entries({ creator, project, logDir })) {
    if (typeof value !== 'string' || !isAbsolute(value)) throw new Error(`ERR_PROBE_BUILD_ABSOLUTE_PATH_REQUIRED:${name}`);
  }
  const root = realpathSync(ROOT);
  const projectDir = realpathSync(project);
  const executable = realpathSync(creator);
  if (isWithin(root, projectDir) || isWithin(projectDir, root)) throw new Error('ERR_PROBE_BUILD_PROJECT_OVERLAP');
  const logs = prospectivePath(logDir);
  if (isWithin(root, logs)) throw new Error('ERR_PROBE_BUILD_LOGS_INSIDE_REPOSITORY');
  const manifestBytes = readFileSync(join(projectDir, 'probe-source-manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  const packageJson = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8'));
  const enginePackage = JSON.parse(readFileSync(join(dirname(executable), 'resources/resources/3d/engine/package.json'), 'utf8'));
  if (enginePackage.version !== packageJson.creator?.version || manifest.creatorVersion !== enginePackage.version) {
    throw new Error('ERR_PROBE_BUILD_CREATOR_VERSION_MISMATCH');
  }
  for (const [file, expected] of Object.entries(manifest.outputs)) {
    const target = resolve(projectDir, file);
    if (!isWithin(projectDir, target) || digest(readFileSync(target)) !== expected.sha256) {
      throw new Error(`ERR_PROBE_BUILD_PREPARED_OUTPUT_CHANGED:${file}`);
    }
  }
  const scene = JSON.parse(readFileSync(join(projectDir, 'assets/Probe.scene.meta'), 'utf8'));
  if (typeof scene.uuid !== 'string' || !/^[a-f\d-]{36}$/i.test(scene.uuid)) throw new Error('ERR_PROBE_BUILD_SCENE_UUID_INVALID');
  mkdirSync(logs, { recursive: true });
  const recordDir = mkdtempSync(join(logs, 'creator-build-'));
  const stdout = openSync(join(recordDir, 'stdout.log'), 'wx');
  const stderr = openSync(join(recordDir, 'stderr.log'), 'wx');
  const args = ['--project', projectDir, '--build', `platform=web-desktop;debug=true;startScene=${scene.uuid}`];
  const startedAt = new Date().toISOString();
  let exitCode = null;
  let executionError = null;
  try {
    exitCode = await new Promise((resolveCode, reject) => {
      const child = spawn(executable, args, { cwd: projectDir, shell: false, windowsHide: true, stdio: ['ignore', stdout, stderr] });
      child.once('error', reject);
      child.once('close', (code) => resolveCode(code));
    });
  } catch (error) {
    executionError = error instanceof Error ? error.message : String(error);
  } finally {
    closeSync(stdout);
    closeSync(stderr);
  }
  const webIndex = join(projectDir, 'build/web-desktop/index.html');
  let webBuild = null;
  let preparedSurfaceAfter = null;
  let creatorNormalizations = [];
  if (executionError === null && exitCode === 36 && existsSync(webIndex)) {
    try {
      preparedSurfaceAfter = capturePreparedSurface(projectDir, manifest);
      creatorNormalizations = checkPreparedSurfaceAfterBuild(manifest, preparedSurfaceAfter);
      webBuild = webTreeDigest(join(projectDir, 'build/web-desktop'));
    }
    catch (error) { executionError = error instanceof Error ? error.message : String(error); }
  }
  // Creator documents 36 as build success; zero is not evidence of a completed build.
  const passed = executionError === null && exitCode === 36 && existsSync(webIndex);
  const result = {
    creatorVersion: enginePackage.version, executable, executableSha256: digest(readFileSync(executable)),
    projectDir, sourceCommit: manifest.sourceCommit, sourceDirty: manifest.sourceDirty,
    version: manifest.version, preparedManifestSha256: digest(manifestBytes),
    buildToolSha256: digest(readFileSync(fileURLToPath(import.meta.url))),
    args, startedAt, finishedAt: new Date().toISOString(), creatorExitCode: exitCode,
    executionError, passed, preparedSurfaceAfter, creatorNormalizations, webBuild,
    webIndex: existsSync(webIndex) ? webIndex : null, recordDir
  };
  writeFileSync(join(recordDir, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  if (!passed) throw new Error(`ERR_PROBE_CREATOR_BUILD_FAILED:${exitCode}:${recordDir}${executionError ? ':' + executionError : ''}`);
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {};
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 2) {
    const key = { '--creator': 'creator', '--project': 'project', '--log-dir': 'logDir' }[args[i]];
    if (!key || !args[i + 1] || options[key]) throw new Error('Usage: cocos:build --creator ABS_PATH --project ABS_PATH --log-dir ABS_PATH');
    options[key] = args[i + 1];
  }
  buildCocosProbe(options).then((result) => console.log(JSON.stringify(result))).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
