#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFinding } from '../plugin-runtime/createFinding.mjs';
import { createPluginResult } from '../plugin-runtime/createPluginResult.mjs';
import { readJsonFile } from '../plugin-runtime/readJsonFile.mjs';
import { pathExists } from '../plugin-runtime/readTextFile.mjs';
import { pluginCliMain } from '../plugin-runtime/pluginCliMain.mjs';

const PLUGIN_ID = 'test-registry-integrity';
const root = process.cwd();

export function runTestRegistryIntegrityCheck() {
  const startedAt = Date.now();
  const findings = [];
  const registry = readJsonFile(root, 'tools/quality/test-registry.json', findings);
  const policy = readJsonFile(root, 'tools/quality/gate-policy.json', findings);
  const pkg = readJsonFile(root, 'package.json', findings);
  const tasks = registry.tests ?? {};
  const ids = Object.keys(tasks);
  if (new Set(ids).size !== ids.length) findings.push(createFinding('error', 'DUPLICATE_TASK_ID', 'tools/quality/test-registry.json', 'task ids must be unique'));

  for (const [id, task] of Object.entries(tasks)) {
    for (const field of ['command', 'group', 'timeoutSeconds', 'tags', 'type', 'stability']) {
      if (task[field] === undefined || task[field] === null || (Array.isArray(task[field]) && task[field].length === 0)) {
        findings.push(createFinding('error', 'TASK_FIELD_MISSING', 'tools/quality/test-registry.json', `${id} must declare ${field}`, { taskId: id, expected: field }));
      }
    }
    if (task.command === 'npm') {
      const script = task.args?.[1];
      if (!script || !pkg.scripts?.[script]) findings.push(createFinding('error', 'TASK_SCRIPT_MISSING', 'tools/quality/test-registry.json', `${id} references missing npm script`, { taskId: id, actual: script }));
    }
    if (task.command === 'node' || task.command === 'python3') {
      const maybeFile = task.command === 'node'
        ? (task.args ?? []).find((arg) => typeof arg === 'string' && (arg.startsWith('tools/') || arg.startsWith('tests/')))
        : task.args?.[0];
      if (maybeFile && !pathExists(root, maybeFile)) {
        findings.push(createFinding('error', 'TASK_TARGET_MISSING', 'tools/quality/test-registry.json', `${id} references missing file`, { taskId: id, actual: maybeFile }));
      }
    }
    for (const file of task.files ?? []) {
      if (!pathExists(root, file)) findings.push(createFinding('error', 'TASK_FILE_MISSING', 'tools/quality/test-registry.json', `${id} references missing test file`, { taskId: id, actual: file }));
    }
  }

  const requiredTasks = [
    'static.typecheck',
    'architecture.legacy',
    'quality.self-test',
    'test.package-hygiene',
    'test.context-governance',
    'test.stage1a-baseline',
    'test.cocos-component-node-binding',
    'quality.versionConsistency',
    'quality.configIntegrity',
    'quality.testRegistryIntegrity',
    'quality.releaseSurface',
    'quality.contextDocSurface',
    'quality.architectureBoundary',
    'test.quality-plugin-contracts',
    'test.quality-rule-authority-contracts',
    'test.architecture-boundary-plugin-contracts',
    'test.architecture-boundary-authority-contracts',
    'test.quality-affected-contracts',
    'test.quality-cache-contracts'
  ];
  for (const id of requiredTasks) {
    if (!tasks[id]) findings.push(createFinding('error', 'REQUIRED_TASK_MISSING', 'tools/quality/test-registry.json', `required full-gate task is missing: ${id}`));
  }
  if (JSON.stringify(tasks['quality.self-test']?.args ?? []) !== JSON.stringify(['run', 'test:quality-gate-contracts'])) {
    findings.push(createFinding('error', 'QUALITY_SELF_TEST_SCRIPT_MISMATCH', 'tools/quality/test-registry.json', 'quality.self-test must use npm run test:quality-gate-contracts'));
  }
  for (const id of ['release.build', 'release.check']) {
    if (tasks[id]?.group !== 'release' || tasks[id]?.type !== 'release') {
      findings.push(createFinding('error', 'RELEASE_TASK_CLASSIFICATION_MISMATCH', 'tools/quality/test-registry.json', `${id} must be release group/type`));
    }
  }

  const runnerText = readFileSync(join(root, 'tools/quality/run-quality-gate.mjs'), 'utf8');
  if (/tests\/(stage1a|cocos|package-hygiene)\.test/.test(runnerText)) {
    findings.push(createFinding('error', 'RUNNER_HARDCODES_BUSINESS_TESTS', 'tools/quality/run-quality-gate.mjs', 'quality runner must not hardcode business test file lists'));
  }
  const full = policy.gates?.full ?? {};
  const fullSelectors = JSON.stringify(full);
  for (const id of ['architecture.legacy', 'quality.self-test']) {
    if (!fullSelectors.includes(id)) findings.push(createFinding('error', 'FULL_GATE_MISSING_EXPLICIT_TASK', 'tools/quality/gate-policy.json', `full gate must explicitly include ${id}`));
  }
  return createPluginResult(PLUGIN_ID, findings, startedAt);
}

pluginCliMain(import.meta.url, runTestRegistryIntegrityCheck, { id: PLUGIN_ID, file: 'tools/quality/plugins/test-registry-integrity-check.mjs' });
