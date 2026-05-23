import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadVersionSurface, deriveBuildId, deriveBaselineBuildIds } from '../tools/quality/lib/versionSurface.mjs';
import { runVersionConsistencyCheck } from '../tools/quality/plugins/version-consistency-check.mjs';

const root = process.cwd();

test('project-target helper exposes current version markers and baseline buildIds', () => {
  const surface = loadVersionSurface(root);
  assert.equal(surface.markers.codePackageVersion, 'v0.0.2.24');
  assert.equal(surface.markers.npmVersion, '0.0.2-24');
  assert.equal(surface.markers.snakeVersion, 'v0_0_2_24');
  assert.equal(surface.markers.releaseRoot, '模拟游戏_Cocos微信试水代码包_v0_0_2_24');
  assert.deepEqual(surface.baselineBuildIds, deriveBaselineBuildIds('v0_0_2_24'));
  assert.equal(deriveBuildId('fixture_runner', surface.markers.snakeVersion), 'fixture_runner_v0_0_2_24');
});

test('version-consistency-check reports no stale buildId markers in current repo surface', () => {
  const result = runVersionConsistencyCheck({ rootDir: root });
  const staleBuildFindings = result.findings.filter((finding) => finding.code === 'STALE_BUILD_ID_MARKER');
  assert.deepEqual(staleBuildFindings, []);
});

test('project-target previous markers are allowlisted from stale scan', () => {
  const result = runVersionConsistencyCheck({ rootDir: root });
  const projectTargetFindings = result.findings.filter((finding) => finding.path === 'tools/quality/rules/project-target.json');
  assert.deepEqual(projectTargetFindings.filter((finding) => finding.code.startsWith('STALE_')), []);
});

test('release tools read project-target authority and package scripts match', () => {
  const builder = readFileSync(join(root, 'tools/build_release_package.py'), 'utf8');
  const checker = readFileSync(join(root, 'tools/check_release_zip.py'), 'utf8');
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(builder.includes('DEFAULT_CODE_ROOT'), false);
  assert.match(builder, /--project-target/);
  assert.match(checker, /--project-target/);
  assert.match(packageJson.scripts['release:build'], /--project-target/);
  assert.match(packageJson.scripts['release:check'], /--project-target/);
});

test('version surface contracts are registered for fast/full/blocker gates', () => {
  const registry = JSON.parse(readFileSync(join(root, 'tools/quality/test-registry.json'), 'utf8'));
  const task = registry.tests['test.version-surface-contracts'];
  assert.ok(task);
  assert.deepEqual(task.tags.sort(), ['blocker', 'fast', 'full', 'quality', 'version'].sort());
  assert.equal(existsSync(join(root, 'tests/version-surface-contracts.test.mjs')), true);
});
