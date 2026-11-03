import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { assertWechatAppId } from '../../cocos-probe/lib/prepareProject.mjs';
import { capturePreparedSurface, checkPreparedSurfaceAfterBuild } from '../../cocos-probe/lib/webProbeSupport.mjs';
import { assertWechatSourceProvenance } from './sourceProvenance.mjs';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const within = (parent, child) => {
  const rel = relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel));
};

export function readWechatPreparedProject({ rootDir, project }) {
  const projectDir = realpathSync(project);
  const root = realpathSync(rootDir);
  if (within(root, projectDir) || within(projectDir, root)) throw new Error('ERR_WECHAT_PROJECT_OVERLAP');
  const manifestBytes = readFileSync(join(projectDir, 'probe-source-manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  if (manifest.format !== 'cocos-wechat-probe-source/v1' || manifest.target !== 'wechatgame'
      || !/^[a-f\d]{40}$/i.test(manifest.sourceCommit) || typeof manifest.sourceDirty !== 'boolean'
      || !manifest.outputs || typeof manifest.outputs !== 'object' || Array.isArray(manifest.outputs)) {
    throw new Error('ERR_WECHAT_SOURCE_MANIFEST');
  }
  assertWechatAppId(manifest.appId);
  const sourceVerification = assertWechatSourceProvenance({ rootDir: root, manifest });
  const identity = JSON.parse(readFileSync(join(projectDir, 'assets/resources/candidate-identity.json'), 'utf8'));
  if (identity.schema !== 'wechat-candidate/v1' || !/^wechat-[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(identity.candidate_id)
      || identity.source_commit !== manifest.sourceCommit || identity.short_commit !== manifest.sourceCommit.slice(0, 12)
      || identity.version !== manifest.version || identity.build_id !== manifest.buildId
      || JSON.stringify(identity) !== JSON.stringify(manifest.candidateIdentity)) {
    throw new Error('ERR_WECHAT_CANDIDATE_IDENTITY_MISMATCH');
  }
  for (const mandatory of ['assets/resources/candidate-identity.json', 'assets/resources/probe-resources.json', 'assets/generated/probe-runtime.js', 'wechat-build-options.json', 'assets/Probe.scene.meta',
    'wechat-precompiled-validators.mjs', 'wechat-schema-precompile.json', 'wechat-runtime-entry.mjs']) {
    if (!Object.hasOwn(manifest.outputs, mandatory)) throw new Error('ERR_WECHAT_SOURCE_OUTPUT_MISSING:' + mandatory);
  }
  const config = JSON.parse(readFileSync(join(projectDir, 'wechat-build-options.json'), 'utf8'));
  const scene = JSON.parse(readFileSync(join(projectDir, 'assets/Probe.scene.meta'), 'utf8'));
  if (config.platform !== 'wechatgame' || config.outputName !== 'wechatgame' || config.taskName !== 'wechatgame'
      || config.buildPath !== 'project://build' || config.debug !== true || config.startScene !== scene.uuid
      || !/^[a-f\d-]{36}$/i.test(scene.uuid) || config.packages?.wechatgame?.appid !== manifest.appId
      || config.packages?.wechatgame?.orientation !== 'landscape' || config.packages?.wechatgame?.separateEngine !== false) {
    throw new Error('ERR_WECHAT_BUILD_CONFIG_MISMATCH');
  }
  return { projectDir, manifest, identity, manifestBytes, sourceVerification };
}

/** Digest only the actual game directory; candidate records are always outside it. */
export function wechatTreeDigest(directory, appId) {
  assertWechatAppId(appId);
  if (lstatSync(directory).isSymbolicLink()) throw new Error('ERR_WECHAT_BUILD_LINK');
  const root = realpathSync(directory);
  const files = Object.create(null);
  function visit(dir, prefix = '') {
    for (const item of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const file = join(dir, item.name);
      if (item.isSymbolicLink()) throw new Error('ERR_WECHAT_BUILD_LINK');
      const name = prefix + item.name;
      if (item.isDirectory()) visit(file, name + '/');
      else if (item.isFile()) { const bytes = readFileSync(file); files[name] = { bytes: bytes.length, sha256: sha256(bytes) }; }
      else throw new Error('ERR_WECHAT_BUILD_FILE_TYPE:' + name);
    }
  }
  visit(root);
  for (const name of ['game.js', 'game.json', 'project.config.json']) {
    if (!files[name]) throw new Error('ERR_WECHAT_BUILD_ENTRY_MISSING:' + name);
  }
  const project = JSON.parse(readFileSync(join(root, 'project.config.json'), 'utf8'));
  const game = JSON.parse(readFileSync(join(root, 'game.json'), 'utf8'));
  if (project.compileType !== 'game' || project.appid !== appId || game.deviceOrientation !== 'landscape') {
    throw new Error('ERR_WECHAT_BUILD_PROJECT_CONFIG');
  }
  return { digestScope: 'directory-tree/build/wechatgame', sha256: sha256(JSON.stringify(files)), fileCount: Object.keys(files).length, files };
}

/** Re-establish the exact build/identity link before an official-tool import. */
export function readWechatProbeSource({ rootDir, project, buildRecord }) {
  const source = readWechatPreparedProject({ rootDir, project });
  const bytes = readFileSync(buildRecord);
  const record = JSON.parse(bytes);
  const { projectDir, manifest, identity, manifestBytes } = source;
  if (record.format !== 'cocos-wechat-candidate-record/v1' || record.target !== 'wechatgame'
      || record.passed !== true || record.creatorExitCode !== 36
      || record.preparedManifestSha256 !== sha256(manifestBytes)
      || realpathSync(record.projectDir) !== projectDir || record.sourceCommit !== manifest.sourceCommit
      || record.sourceDirty !== manifest.sourceDirty || record.creatorVersion !== manifest.creatorVersion
      || record.candidate_id !== identity.candidate_id || record.appId !== manifest.appId
      || record.version !== manifest.version || record.buildId !== manifest.buildId
      || JSON.stringify(record.inputs) !== JSON.stringify(manifest.inputs)
      || JSON.stringify(record.dependencyInputs) !== JSON.stringify(manifest.dependencyInputs)) {
    throw new Error('ERR_WECHAT_BUILD_RECORD_MISMATCH');
  }
  const sourceVerification = assertWechatSourceProvenance({ rootDir, manifest, toolInputs: record.toolInputs });
  if (JSON.stringify(record.sourceVerification) !== JSON.stringify(sourceVerification)) throw new Error('ERR_WECHAT_SOURCE_VERIFICATION_MISMATCH');
  const preparedSurfaceAfter = capturePreparedSurface(projectDir, manifest);
  const creatorNormalizations = checkPreparedSurfaceAfterBuild(manifest, preparedSurfaceAfter);
  if (JSON.stringify(record.preparedSurfaceAfter) !== JSON.stringify(preparedSurfaceAfter)
      || JSON.stringify(record.creatorNormalizations) !== JSON.stringify(creatorNormalizations)) {
    throw new Error('ERR_WECHAT_PREPARED_OUTPUT_CHANGED');
  }
  const gameBuild = wechatTreeDigest(join(projectDir, 'build/wechatgame'), manifest.appId);
  if (JSON.stringify(record.gameBuild) !== JSON.stringify(gameBuild)) throw new Error('ERR_WECHAT_BUILD_CONTENT_CHANGED');
  return { ...source, sourceVerification, gameBuild, preparedManifestSha256: sha256(manifestBytes), buildRecordSha256: sha256(bytes) };
}
