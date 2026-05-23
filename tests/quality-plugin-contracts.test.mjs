import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const readJson = (rel) => JSON.parse(readFileSync(join(root, rel), 'utf8'));
const registry = readJson('tools/quality/test-registry.json');

const pluginTasks = [
  ['quality.versionConsistency', 'tools/quality/plugins/version-consistency-check.mjs', 'version-consistency'],
  ['quality.configIntegrity', 'tools/quality/plugins/quality-config-integrity-check.mjs', 'quality-config-integrity'],
  ['quality.testRegistryIntegrity', 'tools/quality/plugins/test-registry-integrity-check.mjs', 'test-registry-integrity'],
  ['quality.releaseSurface', 'tools/quality/plugins/release-surface-check.mjs', 'release-surface'],
  ['quality.contextDocSurface', 'tools/quality/plugins/context-doc-surface-check.mjs', 'context-doc-surface'],
  ['quality.architectureBoundary', 'tools/quality/plugins/architecture-boundary-check.mjs', 'architecture-boundary']
];

test('quality plugin files and registry tasks are one-to-one', () => {
  for (const [taskId, pluginPath] of pluginTasks) {
    assert.equal(existsSync(join(root, pluginPath)), true, `${pluginPath} must exist`);
    const task = registry.tests[taskId];
    assert.ok(task, `${taskId} must be registered`);
    assert.equal(task.type, 'quality-plugin');
    assert.equal(task.group, 'quality');
    assert.equal(task.stability, 'blocker');
    assert.equal(typeof task.timeoutSeconds, 'number');
    assert.ok(task.args.includes(pluginPath), `${taskId} must invoke ${pluginPath}`);
    assert.ok(task.tags.includes('full'), `${taskId} must be covered by full gate`);
  }
});

test('quality plugins can run independently and emit structured result JSON', () => {
  const ids = new Set();
  for (const [taskId, pluginPath, expectedId] of pluginTasks) {
    const result = spawnSync(process.execPath, [pluginPath], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, `${taskId} should pass independently: ${result.stderr || result.stdout}`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.id, expectedId);
    assert.equal(parsed.status, 'passed');
    assert.equal(typeof parsed.durationMs, 'number');
    assert.ok(Array.isArray(parsed.findings), `${taskId} must emit findings array`);
    ids.add(parsed.id);
  }
  assert.equal(ids.size, pluginTasks.length, 'plugin ids must be unique');
});

test('quality plugins do not mutate source files or depend on runtime/log inputs', () => {
  for (const [, pluginPath] of pluginTasks) {
    const text = readFileSync(join(root, pluginPath), 'utf8');
    assert.equal(/writeFileSync|appendFileSync|rmSync|unlinkSync|mkdirSync/.test(text), false, `${pluginPath} must be read-only`);
    assert.equal(/from ['"][^'"]*src\/(game-core|cocos-app|cocos-creator-adapter)|import\([^)]*src\/(game-core|cocos-app|cocos-creator-adapter)/.test(text), false, `${pluginPath} must not import runtime source as a business dependency`);
    assert.equal(/v0_0_2_22_logs|readFileSync\([^)]*_logs|join\([^)]*_logs/.test(text), false, `${pluginPath} must not depend on development log package files`);
    assert.equal(/正式开发总设定包.*\.zip|修改规范包.*\.zip|日志包.*\.zip/.test(text), false, `${pluginPath} must not read raw design/spec/log zip inputs`);
  }
});

test('plugin findings contract contains actionable fields in source text', () => {
  const helper = readFileSync(join(root, 'tools/quality/plugin-runtime/createFinding.mjs'), 'utf8') + readFileSync(join(root, 'tools/quality/plugin-runtime/createPluginResult.mjs'), 'utf8');
  for (const required of ['severity', 'code', 'file', 'message', 'status', 'findings']) {
    assert.equal(helper.includes(required), true, `plugin result helper must include ${required}`);
  }
});
