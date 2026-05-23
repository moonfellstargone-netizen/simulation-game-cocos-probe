#!/usr/bin/env node
import { createFinding } from '../plugin-runtime/createFinding.mjs';
import { createPluginResult } from '../plugin-runtime/createPluginResult.mjs';
import { readJsonFile } from '../plugin-runtime/readJsonFile.mjs';
import { pathExists } from '../plugin-runtime/readTextFile.mjs';
import { loadQualityRuleContext } from '../plugin-runtime/loadQualityRules.mjs';
import { pluginCliMain } from '../plugin-runtime/pluginCliMain.mjs';

const PLUGIN_ID = 'quality-config-integrity';
const root = process.cwd();
const configFiles = [
  'tools/quality/quality.config.json',
  'tools/quality/module-graph.json',
  'tools/quality/test-registry.json',
  'tools/quality/gate-policy.json',
  'tools/quality/rules/project-target.json',
  'tools/quality/rules/context-doc-surface.rules.json',
  'tools/quality/rules/architecture-boundary.rules.json'
];

export function runQualityConfigIntegrityCheck() {
  const startedAt = Date.now();
  const findings = [];
  for (const file of configFiles) readJsonFile(root, file, findings, { missingCode: 'MISSING_QUALITY_CONFIG_FILE' });
  const config = readJsonFile(root, 'tools/quality/quality.config.json', findings);
  const policy = readJsonFile(root, 'tools/quality/gate-policy.json', findings);
  loadQualityRuleContext(root, findings);

  for (const [field, rel] of [
    ['moduleGraph', config.moduleGraph],
    ['testRegistry', config.testRegistry],
    ['gatePolicy', config.gatePolicy],
    ['rules.projectTarget', config.rules?.projectTarget],
    ['rules.contextDocSurface', config.rules?.contextDocSurface],
    ['rules.architectureBoundary', config.rules?.architectureBoundary]
  ]) {
    if (!rel || !pathExists(root, rel)) {
      findings.push(createFinding('error', 'QUALITY_CONFIG_PATH_MISSING', 'tools/quality/quality.config.json', `quality.config.json ${field} must point to an existing file`, { actual: rel }));
    }
    if (String(rel ?? '').includes('_logs') || String(rel ?? '').includes('开发日志包')) {
      findings.push(createFinding('error', 'QUALITY_CONFIG_POINTS_TO_LOGS', 'tools/quality/quality.config.json', `${field} must not point to development logs`, { actual: rel }));
    }
  }
  if (config.reportDir !== 'reports/quality') {
    findings.push(createFinding('error', 'QUALITY_REPORT_DIR_MISMATCH', 'tools/quality/quality.config.json', 'reportDir must remain reports/quality', { expected: 'reports/quality', actual: config.reportDir }));
  }

  const gates = policy.gates ?? {};
  const full = gates.full ?? {};
  const release = gates.release ?? {};
  const affected = gates.affected ?? {};
  const nightly = gates.nightly ?? {};
  for (const [gateId, gate] of Object.entries(gates)) {
    if ('includeTags' in gate) {
      findings.push(createFinding('error', 'DEPRECATED_INCLUDE_TAGS_FIELD', 'tools/quality/gate-policy.json', `${gateId} must not use deprecated includeTags field`));
    }
  }
  for (const field of ['includeTagsAny', 'excludeTags', 'includeTests', 'includeGates']) {
    const presentSomewhere = Object.values(gates).some((gate) => Object.prototype.hasOwnProperty.call(gate, field));
    if (!presentSomewhere) findings.push(createFinding('error', 'GATE_POLICY_FIELD_MISSING', 'tools/quality/gate-policy.json', `gate policy must use ${field}`));
  }
  if (release.allowCache !== false) findings.push(createFinding('error', 'RELEASE_CACHE_ENABLED', 'tools/quality/gate-policy.json', 'release gate must disable cache'));
  if (full.blockOnFailure !== true) findings.push(createFinding('error', 'FULL_NOT_BLOCKING', 'tools/quality/gate-policy.json', 'full gate must block on failure'));
  if (!(release.includeGates ?? []).includes('full')) findings.push(createFinding('error', 'RELEASE_DOES_NOT_INCLUDE_FULL', 'tools/quality/gate-policy.json', 'release gate must include full gate'));
  if (affected.mode !== 'affected' || affected.releaseGate !== false || affected.neverReleaseAuthority !== true) findings.push(createFinding('error', 'AFFECTED_GATE_CONTRACT_INVALID', 'tools/quality/gate-policy.json', 'affected gate must be active only as development feedback and outside release'));
  if (!affected.fallbackGate) findings.push(createFinding('error', 'AFFECTED_FALLBACK_MISSING', 'tools/quality/gate-policy.json', 'affected gate must declare fallbackGate'));
  if ((release.includeGates ?? []).includes('affected') || (release.includeTests ?? []).some((id) => String(id).includes('affected'))) findings.push(createFinding('error', 'RELEASE_INCLUDES_AFFECTED', 'tools/quality/gate-policy.json', 'release gate must not include affected'));
  if (full.allowCache !== false) findings.push(createFinding('error', 'FULL_CACHE_ENABLED', 'tools/quality/gate-policy.json', 'full gate must not depend on cache'));
  if (affected.allowCache !== true) findings.push(createFinding('error', 'AFFECTED_CACHE_DISABLED', 'tools/quality/gate-policy.json', 'affected gate may use local cache probe for development feedback'));
  if (nightly.reserved !== true || nightly.releaseGate !== false) findings.push(createFinding('error', 'NIGHTLY_NOT_RESERVED', 'tools/quality/gate-policy.json', 'nightly gate must remain reserved and outside release'));
  if (Number(policy.groupConcurrency?.release) !== 1 || Number(release.maxConcurrency) !== 1) {
    findings.push(createFinding('error', 'RELEASE_NOT_SEQUENTIAL', 'tools/quality/gate-policy.json', 'release gate and release group concurrency must be 1'));
  }
  const releaseText = JSON.stringify(release);
  if (releaseText.includes('reports/quality')) {
    findings.push(createFinding('error', 'REPORTS_SELECTED_BY_RELEASE', 'tools/quality/gate-policy.json', 'release gate must not directly package reports/quality'));
  }

  return createPluginResult(PLUGIN_ID, findings, startedAt);
}

pluginCliMain(import.meta.url, runQualityConfigIntegrityCheck, { id: PLUGIN_ID, file: 'tools/quality/plugins/quality-config-integrity-check.mjs' });
