#!/usr/bin/env node
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { loadQualityRuleContext } from '../plugin-runtime/loadQualityRules.mjs';
import { createFinding, addRequiredPhrase } from '../plugin-runtime/createFinding.mjs';
import { createPluginResult } from '../plugin-runtime/createPluginResult.mjs';
import { readJsonFile } from '../plugin-runtime/readJsonFile.mjs';
import { readTextFile, pathExists } from '../plugin-runtime/readTextFile.mjs';
import { pluginCliMain } from '../plugin-runtime/pluginCliMain.mjs';
import { collectStaleBuildIdMarkers, pathAllowlistForHistoricalMarkers } from '../lib/versionSurface.mjs';

const PLUGIN_ID = 'version-consistency';
const SCAN_SKIP_DIRS = new Set(['node_modules', '.git', 'reports', '.cache', 'dist', 'coverage']);
const SCAN_EXTENSIONS = new Set(['.json', '.md', '.txt', '.mjs', '.ts', '.py', '.yaml', '.yml']);

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

function normalizeRel(rootDir, absPath) {
  return relative(rootDir, absPath).split('\\').join('/');
}

function isAllowlisted(relPath, allowlist) {
  for (const allowed of allowlist) {
    if (relPath === allowed) return true;
    if (allowed.endsWith('/**') && relPath.startsWith(allowed.slice(0, -3))) return true;
  }
  return false;
}

function walkScanFiles(rootDir, dir = rootDir, files = []) {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const rel = normalizeRel(rootDir, abs);
    const first = rel.split('/')[0];
    if (SCAN_SKIP_DIRS.has(first) || SCAN_SKIP_DIRS.has(entry)) continue;
    const stat = statSync(abs);
    if (stat.isDirectory()) {
      walkScanFiles(rootDir, abs, files);
      continue;
    }
    const ext = entry.includes('.') ? entry.slice(entry.lastIndexOf('.')) : '';
    if (SCAN_EXTENSIONS.has(ext)) files.push(rel);
  }
  return files;
}

function shouldSkipStaleScan(relPath) {
  if (relPath.startsWith('tests/')) return true;
  if (relPath === 'tools/validate_code_architecture.py') return true;
  return false;
}

function scanMarkers(rootDir, findings, markers, allowlist, findingType) {
  for (const rel of walkScanFiles(rootDir)) {
    if (isAllowlisted(rel, allowlist) || shouldSkipStaleScan(rel)) continue;
    const text = readTextFile(rootDir, rel, findings);
    for (const marker of markers) {
      if (marker && text.includes(marker)) {
        findings.push(createFinding('error', findingType, rel, 'stale marker remains outside allowlisted historical scope', { actual: marker, allowlist: [...allowlist] }));
      }
    }
  }
}

export function runVersionConsistencyCheck({ rootDir = process.cwd() } = {}) {
  const startedAt = Date.now();
  const findings = [];
  const { projectTarget } = loadQualityRuleContext(rootDir, findings);
  const target = projectTarget.version ?? {};
  const release = projectTarget.release ?? {};
  const staleMarkers = projectTarget.staleMarkers?.forbiddenCurrentMarkers ?? [];
  const staleBuildIds = collectStaleBuildIdMarkers(projectTarget);
  const allowlist = [...pathAllowlistForHistoricalMarkers(projectTarget)];

  for (const rel of currentFiles) {
    if (!pathExists(rootDir, rel)) {
      findings.push(createFinding('error', 'MISSING_VERSION_SURFACE', rel, 'required version surface file is missing'));
    }
  }

  const pkg = readJsonFile(rootDir, 'package.json', findings);
  if (pkg.version !== target.npmVersion) {
    findings.push(createFinding('error', 'PACKAGE_VERSION_MISMATCH', 'package.json', 'package.json version must match project target npmVersion', { expected: target.npmVersion, actual: pkg.version }));
  }
  if (!String(pkg.description ?? '').includes(target.codePackageVersion) || !String(pkg.description ?? '').includes(target.versionName)) {
    findings.push(createFinding('error', 'PACKAGE_DESCRIPTION_MISMATCH', 'package.json', 'package description must include current version and version name from project target', { expected: `${target.codePackageVersion} / ${target.versionName}`, actual: pkg.description }));
  }

  const lock = readJsonFile(rootDir, 'package-lock.json', findings);
  if (lock.version !== target.npmVersion || lock.packages?.['']?.version !== target.npmVersion) {
    findings.push(createFinding('error', 'PACKAGE_LOCK_VERSION_MISMATCH', 'package-lock.json', 'package-lock root versions must match project target npmVersion', { expected: target.npmVersion, actual: `${lock.version} / ${lock.packages?.['']?.version}` }));
  }

  const qualityConfig = readJsonFile(rootDir, 'tools/quality/quality.config.json', findings);
  const moduleGraph = readJsonFile(rootDir, 'tools/quality/module-graph.json', findings);
  const registry = readJsonFile(rootDir, 'tools/quality/test-registry.json', findings);
  const policy = readJsonFile(rootDir, 'tools/quality/gate-policy.json', findings);
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
  if (!releaseBuild.includes('--project-target') || !releaseBuild.includes('tools/build_release_package.py')) {
    findings.push(createFinding('error', 'RELEASE_BUILD_ROOT_MISMATCH', 'package.json', 'release:build must use build_release_package.py with --project-target', { expected: '--project-target tools/quality/rules/project-target.json', actual: releaseBuild }));
  }
  if (!releaseCheck.includes('--project-target') || !releaseCheck.includes('tools/check_release_zip.py')) {
    findings.push(createFinding('error', 'RELEASE_CHECK_ROOT_MISMATCH', 'package.json', 'release:check must use check_release_zip.py with --project-target', { expected: '--project-target tools/quality/rules/project-target.json', actual: releaseCheck }));
  }

  const builder = readTextFile(rootDir, 'tools/build_release_package.py', findings);
  if (!builder.includes('--project-target') || /DEFAULT_CODE_ROOT\s*=\s*['"]模拟游戏/.test(builder)) {
    findings.push(createFinding('error', 'RELEASE_BUILD_ROOT_MISMATCH', 'tools/build_release_package.py', 'release builder must read project-target and must not keep versioned default root authority'));
  }
  const checker = readTextFile(rootDir, 'tools/check_release_zip.py', findings);
  if (!checker.includes('--project-target')) {
    findings.push(createFinding('error', 'RELEASE_CHECK_ROOT_MISMATCH', 'tools/check_release_zip.py', 'release checker must support --project-target authority'));
  }

  const sourceDesign = readTextFile(rootDir, 'design_snapshot/SOURCE_DESIGN_PACK.txt', findings);
  addRequiredPhrase(findings, sourceDesign, `code_package_version: ${target.codePackageVersion}`, 'design_snapshot/SOURCE_DESIGN_PACK.txt', 'SOURCE_VERSION_MISMATCH');
  addRequiredPhrase(findings, sourceDesign, `code_package_npm_version: ${target.npmVersion}`, 'design_snapshot/SOURCE_DESIGN_PACK.txt', 'SOURCE_NPM_VERSION_MISMATCH');

  const filesAllowedToMentionPrevious = new Set(['tools/quality/rules/project-target.json']);
  for (const rel of currentFiles) {
    if (!pathExists(rootDir, rel)) continue;
    if (filesAllowedToMentionPrevious.has(rel)) continue;
    const text = readTextFile(rootDir, rel, findings);
    for (const marker of staleMarkers) {
      if (marker && text.includes(marker)) {
        findings.push(createFinding('error', 'STALE_VERSION_MARKER', rel, 'stale previous-version marker remains in current code package surface', { actual: marker }));
      }
    }
  }

  scanMarkers(rootDir, findings, staleMarkers, allowlist, 'STALE_VERSION_MARKER');
  scanMarkers(rootDir, findings, staleBuildIds, allowlist, 'STALE_BUILD_ID_MARKER');

  for (const rel of ['README.md', 'docs/CHECK_ARCHITECTURE.md', 'docs/IMPLEMENTATION_SCOPE.md', 'docs/CODE_CONTEXT_INDEX.md']) {
    const text = readTextFile(rootDir, rel, findings);
    addRequiredPhrase(findings, text, target.codePackageVersion, rel, 'CURRENT_VERSION_MISSING');
    addRequiredPhrase(findings, text, target.versionName, rel, 'CURRENT_VERSION_NAME_MISSING');
  }

  return createPluginResult(PLUGIN_ID, findings, startedAt);
}

pluginCliMain(import.meta.url, () => runVersionConsistencyCheck(), { id: PLUGIN_ID, file: 'tools/quality/plugins/version-consistency-check.mjs' });
