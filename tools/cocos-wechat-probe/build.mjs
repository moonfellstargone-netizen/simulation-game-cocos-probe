import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { capturePreparedSurface, checkPreparedSurfaceAfterBuild } from '../cocos-probe/lib/webProbeSupport.mjs';
import { readWechatPreparedProject, sha256, wechatTreeDigest, within } from './lib/source.mjs';
import { assertWechatSourceProvenance, WECHAT_BUILD_TOOL_FILES } from './lib/sourceProvenance.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function prospectivePath(value) {
  let ancestor = resolve(value);
  const suffix = [];
  while (!existsSync(ancestor)) {
    suffix.unshift(relative(dirname(ancestor), ancestor));
    ancestor = dirname(ancestor);
  }
  return resolve(realpathSync(ancestor), ...suffix);
}

export async function buildWechatProbe({ creator, project, logDir, rootDir = ROOT } = {}) {
  for (const [name, value] of Object.entries({ creator, project, logDir })) {
    if (typeof value !== 'string' || !isAbsolute(value)) throw new Error('ERR_WECHAT_BUILD_ABSOLUTE_PATH_REQUIRED:' + name);
    if (value.includes(';') || /[\r\n]/.test(value)) throw new Error('ERR_WECHAT_BUILD_PATH_DELIMITER:' + name);
  }
  const root = realpathSync(rootDir);
  const toolRoot = realpathSync(ROOT);
  const source = readWechatPreparedProject({ rootDir: root, project });
  const { projectDir, manifest, identity, manifestBytes } = source;
  const attemptFile = join(projectDir, 'probe-build-attempt.json');
  if (existsSync(attemptFile) || existsSync(join(projectDir, 'build/wechatgame'))) {
    throw new Error('ERR_WECHAT_CANDIDATE_ALREADY_BUILT:prepare-a-new-candidate');
  }
  const logs = prospectivePath(logDir);
  if (within(root, logs) || within(toolRoot, logs) || within(projectDir, logs)) throw new Error('ERR_WECHAT_BUILD_LOGS_OVERLAP');
  const toolInputs = Object.fromEntries(WECHAT_BUILD_TOOL_FILES.map((file) => [file, sha256(readFileSync(join(toolRoot, file)))]));
  let sourceVerification = assertWechatSourceProvenance({ rootDir: root, manifest, toolInputs });
  mkdirSync(logs, { recursive: true });
  const recordDir = mkdtempSync(join(logs, 'wechat-build-'));
  const startedAt = new Date().toISOString();
  // This is outside the source repository and outside the compiled game tree.
  // One prepared identity permits one build attempt, including a failed attempt.
  writeFileSync(attemptFile, JSON.stringify({ candidate_id: identity.candidate_id, preparedManifestSha256: sha256(manifestBytes), recordDir, startedAt }, null, 2) + '\n', { flag: 'wx' });
  const stdout = openSync(join(recordDir, 'stdout.log'), 'wx');
  const stderr = openSync(join(recordDir, 'stderr.log'), 'wx');
  const args = ['--project', projectDir, '--build', 'configPath=' + join(projectDir, 'wechat-build-options.json')];
  let executable = null;
  let executableSha256 = null;
  let creatorVersion = null;
  let exitCode = null;
  let executionError = null;
  try {
    executable = realpathSync(creator);
    executableSha256 = sha256(readFileSync(executable));
    const packageJson = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8'));
    const enginePackage = JSON.parse(readFileSync(join(dirname(executable), 'resources/resources/3d/engine/package.json'), 'utf8'));
    creatorVersion = enginePackage.version;
    if (creatorVersion !== packageJson.creator?.version || manifest.creatorVersion !== creatorVersion) {
      throw new Error('ERR_WECHAT_BUILD_CREATOR_VERSION_MISMATCH');
    }
    const before = capturePreparedSurface(projectDir, manifest);
    for (const [file, expected] of Object.entries(manifest.outputs)) {
      if (before[file]?.sha256 !== expected.sha256 || before[file]?.bytes !== expected.bytes) {
        throw new Error('ERR_WECHAT_BUILD_PREPARED_OUTPUT_CHANGED:' + file);
      }
    }
    exitCode = await new Promise((accept, reject) => {
      const child = spawn(executable, args, { cwd: projectDir, shell: false, windowsHide: true, stdio: ['ignore', stdout, stderr] });
      child.once('error', reject);
      child.once('close', accept);
    });
  } catch (error) {
    executionError = error instanceof Error ? error.message : String(error);
  } finally {
    closeSync(stdout);
    closeSync(stderr);
  }
  let preparedSurfaceAfter = null;
  let creatorNormalizations = [];
  let gameBuild = null;
  if (executionError === null && exitCode === 36) {
    try {
      preparedSurfaceAfter = capturePreparedSurface(projectDir, manifest);
      creatorNormalizations = checkPreparedSurfaceAfterBuild(manifest, preparedSurfaceAfter);
      gameBuild = wechatTreeDigest(join(projectDir, 'build/wechatgame'), manifest.appId);
    } catch (error) { executionError = error instanceof Error ? error.message : String(error); }
  }
  try {
    for (const [file, expected] of Object.entries(toolInputs)) {
      if (sha256(readFileSync(join(toolRoot, file))) !== expected) throw new Error('ERR_WECHAT_BUILD_TOOL_CHANGED:' + file);
    }
    if (executableSha256 !== null && sha256(readFileSync(executable)) !== executableSha256) {
      throw new Error('ERR_WECHAT_BUILD_EXECUTABLE_CHANGED');
    }
    sourceVerification = assertWechatSourceProvenance({ rootDir: root, manifest, toolInputs });
  } catch (error) { executionError ??= error instanceof Error ? error.message : String(error); }
  const passed = executionError === null && exitCode === 36 && gameBuild !== null;
  const record = {
    format: 'cocos-wechat-candidate-record/v1', target: 'wechatgame', candidate_id: identity.candidate_id,
    sourceCommit: manifest.sourceCommit, sourceDirty: manifest.sourceDirty, version: manifest.version,
    buildId: manifest.buildId, appId: manifest.appId, inputs: manifest.inputs, dependencyInputs: manifest.dependencyInputs,
    creatorVersion, executable, executableSha256, toolInputs, sourceVerification,
    projectDir, preparedManifestSha256: sha256(manifestBytes), args,
    startedAt, finishedAt: new Date().toISOString(), creatorExitCode: exitCode, executionError, passed,
    preparedSurfaceAfter, creatorNormalizations, gameBuild, recordDir,
    developerToolVerification: 'not-executed-by-build', developerToolVersion: null, baseLibraryVersion: null,
    qrSource: null
  };
  writeFileSync(join(recordDir, 'candidate-record.json'), JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
  if (!passed) throw new Error(`ERR_WECHAT_CREATOR_BUILD_FAILED:${exitCode}:${recordDir}${executionError ? ':' + executionError : ''}`);
  return record;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {};
  const args = process.argv.slice(2);
  try {
    for (let i = 0; i < args.length; i += 2) {
      const key = { '--creator': 'creator', '--project': 'project', '--log-dir': 'logDir' }[args[i]];
      if (!key || !args[i + 1] || Object.hasOwn(options, key)) throw new Error('Usage: build-wechat --creator ABS --project ABS --log-dir ABS');
      options[key] = args[i + 1];
    }
    const record = await buildWechatProbe(options);
    console.log(JSON.stringify({ passed: record.passed, candidate_id: record.candidate_id, recordDir: record.recordDir, gameBuild: record.gameBuild.sha256 }));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
