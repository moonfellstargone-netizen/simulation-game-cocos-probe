#!/usr/bin/env node
import { loadQualityRuleContext } from '../plugin-runtime/loadQualityRules.mjs';
import { createFinding } from '../plugin-runtime/createFinding.mjs';
import { createPluginResult } from '../plugin-runtime/createPluginResult.mjs';
import { readJsonFile } from '../plugin-runtime/readJsonFile.mjs';
import { readTextFile, pathExists } from '../plugin-runtime/readTextFile.mjs';
import { pluginCliMain } from '../plugin-runtime/pluginCliMain.mjs';

const PLUGIN_ID = 'release-surface';
const root = process.cwd();

export function runReleaseSurfaceCheck() {
  const startedAt = Date.now();
  const findings = [];
  const { projectTarget } = loadQualityRuleContext(root, findings);
  const release = projectTarget.release ?? {};
  const outputName = `../${release.zip}`;

  const pkg = readJsonFile(root, 'package.json', findings);
  const buildScript = pkg.scripts?.['release:build'] ?? '';
  const checkScript = pkg.scripts?.['release:check'] ?? '';
  if (!buildScript.includes(release.root) || !buildScript.includes(outputName)) {
    findings.push(createFinding('error', 'RELEASE_BUILD_SCRIPT_MISMATCH', 'package.json', 'release:build must use project target root and output', { expected: `${release.root} / ${outputName}`, actual: buildScript }));
  }
  if (!checkScript.includes(release.root) || !checkScript.includes(outputName)) {
    findings.push(createFinding('error', 'RELEASE_CHECK_SCRIPT_MISMATCH', 'package.json', 'release:check must use project target expected root and output', { expected: `${release.root} / ${outputName}`, actual: checkScript }));
  }

  const builder = readTextFile(root, 'tools/build_release_package.py', findings);
  const checker = readTextFile(root, 'tools/check_release_zip.py', findings);
  const logSuffix = ['_', 'logs'].join('');
  const logPackName = ['开发', '日志包'].join('');
  for (const required of ['reports/quality', '.cache', 'node_modules', 'coverage', 'dist', logSuffix, logPackName]) {
    if (!builder.includes(required)) findings.push(createFinding('error', 'RELEASE_EXCLUDE_MISSING', 'tools/build_release_package.py', `release builder must exclude ${required}`, { expected: required }));
  }
  for (const required of ['reports', 'quality', '.cache', 'node_modules', 'coverage', 'dist']) {
    if (!checker.includes(required)) findings.push(createFinding('error', 'RELEASE_CHECK_EXCLUDE_MISSING', 'tools/check_release_zip.py', `release checker must reject ${required}`, { expected: required }));
  }
  if (!builder.includes(release.root)) {
    findings.push(createFinding('error', 'RELEASE_BUILDER_ROOT_MISMATCH', 'tools/build_release_package.py', 'default release root must match project target', { expected: release.root }));
  }
  if (!checker.includes('expected-root')) {
    findings.push(createFinding('error', 'RELEASE_CHECK_EXPECTED_ROOT_MISSING', 'tools/check_release_zip.py', 'release checker must keep expected-root validation'));
  }

  const registry = readJsonFile(root, 'tools/quality/test-registry.json', findings);
  for (const taskId of ['release.build', 'release.check']) {
    const task = registry.tests?.[taskId];
    if (!task) findings.push(createFinding('error', 'RELEASE_TASK_MISSING', 'tools/quality/test-registry.json', `${taskId} task missing`));
    const commandText = [task?.command, ...(task?.args ?? [])].join(' ');
    if (!commandText.includes(release.root)) findings.push(createFinding('error', 'RELEASE_TASK_ROOT_MISMATCH', 'tools/quality/test-registry.json', `${taskId} must use project target release root`, { expected: release.root }));
  }

  for (const forbidden of projectTarget.staleMarkers?.forbiddenCurrentMarkers ?? []) {
    if (!forbidden) continue;
    if (buildScript.includes(forbidden) || checkScript.includes(forbidden) || builder.includes(forbidden)) {
      findings.push(createFinding('error', 'STALE_RELEASE_ROOT', 'release surface', 'stale release marker remains', { actual: forbidden }));
    }
  }
  for (const rel of ['reports/quality', 'node_modules', 'coverage', 'dist']) {
    if (pathExists(root, rel) && rel !== 'reports/quality') {
      continue;
    }
  }
  return createPluginResult(PLUGIN_ID, findings, startedAt);
}

pluginCliMain(import.meta.url, runReleaseSurfaceCheck, { id: PLUGIN_ID, file: 'tools/quality/plugins/release-surface-check.mjs' });
