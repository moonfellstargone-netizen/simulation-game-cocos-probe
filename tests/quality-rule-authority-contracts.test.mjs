import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadQualityRuleContext } from '../tools/quality/plugin-runtime/loadQualityRules.mjs';

const root = process.cwd();
const readJson = (rel) => JSON.parse(readFileSync(join(root, rel), 'utf8'));
const projectTarget = readJson('tools/quality/rules/project-target.json');
const currentMarkers = [
  projectTarget.version.codePackageVersion,
  projectTarget.version.npmVersion,
  projectTarget.version.qualityMetadataVersion,
  projectTarget.version.snakeVersion,
  projectTarget.release.root,
  projectTarget.release.zip,
  projectTarget.version.versionName,
  projectTarget.version.chineseVersionName
];
const staleMarkers = projectTarget.staleMarkers.forbiddenCurrentMarkers;
const pluginFiles = readdirSync(join(root, 'tools/quality/plugins'))
  .filter((name) => name.endsWith('.mjs'))
  .map((name) => `tools/quality/plugins/${name}`)
  .filter((rel) => !rel.endsWith('legacy-architecture-validator.mjs') && !rel.endsWith('plugin-result.mjs'));
const runtimeFiles = readdirSync(join(root, 'tools/quality/plugin-runtime'))
  .filter((name) => name.endsWith('.mjs'))
  .map((name) => `tools/quality/plugin-runtime/${name}`);

test('project target and context doc rules are the rule authority source', () => {
  assert.equal(projectTarget.version.codePackageVersion, 'v0.0.2.23');
  assert.equal(projectTarget.version.npmVersion, '0.0.2-23');
  assert.equal(projectTarget.version.qualityMetadataVersion, '0.0.2.23');
  assert.equal(projectTarget.release.root, '模拟游戏_Cocos微信试水代码包_v0_0_2_23');
  assert.equal(projectTarget.design.designPackVersion, 'v1.5.2.2');
  assert.ok(staleMarkers.includes(projectTarget.previous.codePackageVersion));
  assert.ok(staleMarkers.includes(projectTarget.previous.releaseRoot));
  assert.equal(existsSync(join(root, 'tools/quality/rules/context-doc-surface.rules.json')), true);
  assert.equal(existsSync(join(root, 'tools/quality/rules/architecture-boundary.rules.json')), true);
});

test('quality rule loader expands variables from project target', () => {
  const findings = [];
  const context = loadQualityRuleContext(root, findings);
  assert.deepEqual(findings, []);
  const readmeRules = context.contextDocSurfaceRules.files['README.md'];
  assert.ok(readmeRules.required.includes('v0.0.2.23'));
  assert.ok(readmeRules.required.includes('Project Map & Git Workflow Readiness'));
  assert.ok(readmeRules.forbiddenCurrent.includes(projectTarget.previous.codePackageVersion));
  assert.equal(context.architectureBoundaryRules.defaultMode, 'shadow');
  assert.ok(context.architectureBoundaryRules.rules.importBoundaries.some((rule) => rule.mode === 'authoritative'));
  assert.ok(context.architectureBoundaryRules.rules.tokenBoundaries.some((rule) => rule.mode === 'shadow' || rule.mode === 'shadow_aligned'));
  assert.ok(context.architectureBoundaryRules.rules.importBoundaries.length > 0);
});

test('quality plugins and runtime do not hardcode current version, release root, or stale markers', () => {
  for (const rel of [...pluginFiles, ...runtimeFiles]) {
    const text = readFileSync(join(root, rel), 'utf8');
    for (const marker of [...currentMarkers, ...staleMarkers]) {
      assert.equal(text.includes(marker), false, `${rel} must not hardcode marker: ${marker}`);
    }
  }
});

test('quality plugins reuse shared plugin runtime helpers', () => {
  for (const rel of pluginFiles) {
    const text = readFileSync(join(root, rel), 'utf8');
    assert.equal(text.includes('../plugin-runtime/'), true, `${rel} must import shared plugin runtime`);
    for (const forbidden of ['function readJson', 'function readText', 'function createFinding', 'function createPluginResult']) {
      assert.equal(text.includes(forbidden), false, `${rel} must not redefine ${forbidden}`);
    }
  }
});

test('business runtime does not import quality plugin runtime', () => {
  for (const dir of ['src/game-core', 'src/cocos-app', 'src/cocos-creator-adapter']) {
    const violations = [];
    walk(join(root, dir), (abs) => {
      if (!abs.endsWith('.ts')) return;
      const text = readFileSync(abs, 'utf8');
      if (text.includes('tools/quality/plugin-runtime') || text.includes('plugin-runtime/')) violations.push(abs);
    });
    assert.deepEqual(violations, []);
  }
});

function walk(dir, visit) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, visit);
    else visit(abs);
  }
}
