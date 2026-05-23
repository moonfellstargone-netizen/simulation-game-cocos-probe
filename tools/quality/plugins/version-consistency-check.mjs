#!/usr/bin/env node
import { loadQualityRuleContext } from '../plugin-runtime/loadQualityRules.mjs';
import { createFinding, addRequiredPhrase } from '../plugin-runtime/createFinding.mjs';
import { createPluginResult } from '../plugin-runtime/createPluginResult.mjs';
import { readJsonFile } from '../plugin-runtime/readJsonFile.mjs';
import { readTextFile, pathExists } from '../plugin-runtime/readTextFile.mjs';
import { pluginCliMain } from '../plugin-runtime/pluginCliMain.mjs';

const PLUGIN_ID = 'version-consistency';
const root = process.cwd();
const currentFiles = [
  'package.json',
  'package-lock.json',
  'README.md',
  'tools/quality/quality.config.json',
  'tools/quality/module-graph.json',
  'tools/quality/test-registry.json',
  'tools/quality/gate-policy.json',
  'tools/build_release_package.py',
  'tools/check_release_zip.py',
  'docs/CHECK_ARCHITECTURE.md',
  'docs/ARCHITECTURE.md',
  'docs/CODE_CONTEXT_INDEX.md',
  'docs/IMPLEMENTATION_SCOPE.md',
  'docs/SOURCE_DESIGN_PACK.md',
  'design_snapshot/SOURCE_DESIGN_PACK.txt',
  'src/cocos-app/README.md'
];

export function runVersionConsistencyCheck() {
  const startedAt = Date.now();
  const findings = [];
  const { projectTarget } = loadQualityRuleContext(root, findings);
  const target = projectTarget.version ?? {};
  const release = projectTarget.release ?? {};
  const staleMarkers = projectTarget.staleMarkers?.forbiddenCurrentMarkers ?? [];

  for (const rel of currentFiles) {
    if (!pathExists(root, rel)) {
      findings.push(createFinding('error', 'MISSING_VERSION_SURFACE', rel, 'required version surface file is missing'));
    }
  }

  const pkg = readJsonFile(root, 'package.json', findings);
  if (pkg.version !== target.npmVersion) {
    findings.push(createFinding('error', 'PACKAGE_VERSION_MISMATCH', 'package.json', 'package.json version must match project target npmVersion', { expected: target.npmVersion, actual: pkg.version }));
  }
  if (!String(pkg.description ?? '').includes(target.codePackageVersion) || !String(pkg.description ?? '').includes(target.versionName)) {
    findings.push(createFinding('error', 'PACKAGE_DESCRIPTION_MISMATCH', 'package.json', 'package description must include current version and version name from project target', { expected: `${target.codePackageVersion} / ${target.versionName}`, actual: pkg.description }));
  }

  const lock = readJsonFile(root, 'package-lock.json', findings);
  if (lock.version !== target.npmVersion || lock.packages?.['']?.version !== target.npmVersion) {
    findings.push(createFinding('error', 'PACKAGE_LOCK_VERSION_MISMATCH', 'package-lock.json', 'package-lock root versions must match project target npmVersion', { expected: target.npmVersion, actual: `${lock.version} / ${lock.packages?.['']?.version}` }));
  }

  const qualityConfig = readJsonFile(root, 'tools/quality/quality.config.json', findings);
  const moduleGraph = readJsonFile(root, 'tools/quality/module-graph.json', findings);
  const registry = readJsonFile(root, 'tools/quality/test-registry.json', findings);
  const policy = readJsonFile(root, 'tools/quality/gate-policy.json', findings);
  for (const [file, actual] of [
    ['tools/quality/quality.config.json', qualityConfig.version],
    ['tools/quality/module-graph.json', moduleGraph.version],
    ['tools/quality/test-registry.json', registry.version],
    ['tools/quality/gate-policy.json', policy.version]
  ]) {
    if (actual !== target.qualityMetadataVersion) {
      findings.push(createFinding('error', 'QUALITY_VERSION_MISMATCH', file, 'quality metadata version must match project target qualityMetadataVersion', { expected: target.qualityMetadataVersion, actual }));
    }
  }

  const releaseBuild = pkg.scripts?.['release:build'] ?? '';
  const releaseCheck = pkg.scripts?.['release:check'] ?? '';
  if (!releaseBuild.includes(release.root) || !releaseBuild.includes(`../${release.zip}`)) {
    findings.push(createFinding('error', 'RELEASE_BUILD_ROOT_MISMATCH', 'package.json', 'release:build must use project target release root and output', { expected: `${release.root} / ../${release.zip}`, actual: releaseBuild }));
  }
  if (!releaseCheck.includes(release.root) || !releaseCheck.includes(`../${release.zip}`)) {
    findings.push(createFinding('error', 'RELEASE_CHECK_ROOT_MISMATCH', 'package.json', 'release:check must use project target expected root and output', { expected: `${release.root} / ../${release.zip}`, actual: releaseCheck }));
  }

  const sourceDesign = readTextFile(root, 'design_snapshot/SOURCE_DESIGN_PACK.txt', findings);
  addRequiredPhrase(findings, sourceDesign, `code_package_version: ${target.codePackageVersion}`, 'design_snapshot/SOURCE_DESIGN_PACK.txt', 'SOURCE_VERSION_MISMATCH');
  addRequiredPhrase(findings, sourceDesign, `code_package_npm_version: ${target.npmVersion}`, 'design_snapshot/SOURCE_DESIGN_PACK.txt', 'SOURCE_NPM_VERSION_MISMATCH');

  const filesAllowedToMentionPrevious = new Set(['tools/quality/rules/project-target.json']);
  for (const rel of currentFiles) {
    if (!pathExists(root, rel)) continue;
    if (filesAllowedToMentionPrevious.has(rel)) continue;
    const text = readTextFile(root, rel, findings);
    for (const marker of staleMarkers) {
      if (marker && text.includes(marker)) {
        findings.push(createFinding('error', 'STALE_VERSION_MARKER', rel, 'stale previous-version marker remains in current code package surface', { actual: marker }));
      }
    }
  }

  for (const rel of ['README.md', 'docs/CHECK_ARCHITECTURE.md', 'docs/IMPLEMENTATION_SCOPE.md', 'docs/CODE_CONTEXT_INDEX.md']) {
    const text = readTextFile(root, rel, findings);
    addRequiredPhrase(findings, text, target.codePackageVersion, rel, 'CURRENT_VERSION_MISSING');
    addRequiredPhrase(findings, text, target.versionName, rel, 'CURRENT_VERSION_NAME_MISSING');
  }

  return createPluginResult(PLUGIN_ID, findings, startedAt);
}

pluginCliMain(import.meta.url, runVersionConsistencyCheck, { id: PLUGIN_ID, file: 'tools/quality/plugins/version-consistency-check.mjs' });
