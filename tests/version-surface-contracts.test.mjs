import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadVersionSurface,
  deriveBuildId,
  deriveBaselineBuildIds,
  pathAllowlistForStaleScan,
  STALE_SCAN_NEGATIVE_CONTRACT_PATHS
} from '../tools/quality/lib/versionSurface.mjs';
import { runVersionConsistencyCheck } from '../tools/quality/plugins/version-consistency-check.mjs';

const root = process.cwd();

test('project-target helper exposes current version markers and baseline buildIds', () => {
  const surface = loadVersionSurface(root);
  assert.equal(surface.markers.codePackageVersion, 'v0.0.2.28');
  assert.equal(surface.markers.npmVersion, '0.0.2-28');
  assert.equal(surface.markers.snakeVersion, 'v0_0_2_28');
  assert.equal(surface.markers.releaseRoot, '模拟游戏_Cocos微信试水代码包_v0_0_2_28');
  assert.deepEqual(surface.baselineBuildIds, deriveBaselineBuildIds('v0_0_2_28'));
  assert.equal(deriveBuildId('fixture_runner', surface.markers.snakeVersion), 'fixture_runner_v0_0_2_28');
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

test('version-consistency-check flags stale buildId markers under tests/** outside allowlist', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'version-surface-stale-scan-'));
  const copyRelPaths = [
    'tools/quality/rules/project-target.json',
    'tools/quality/quality.config.json',
    'tools/quality/module-graph.json',
    'tools/quality/test-registry.json',
    'tools/quality/gate-policy.json',
    'package.json',
    'package-lock.json',
    'README.md',
    'tools/build_release_package.py',
    'tools/check_release_zip.py',
    'design_snapshot/SOURCE_DESIGN_PACK.txt',
    'docs/CHECK_ARCHITECTURE.md',
    'docs/ARCHITECTURE.md',
    'docs/CODE_CONTEXT_INDEX.md',
    'docs/IMPLEMENTATION_SCOPE.md',
    'docs/SOURCE_DESIGN_PACK.md',
    'src/cocos-app/README.md'
  ];
  for (const rel of copyRelPaths) {
    const dest = join(tempRoot, rel);
    mkdirSync(join(dest, '..'), { recursive: true });
    cpSync(join(root, rel), dest);
  }
  mkdirSync(join(tempRoot, 'tests'), { recursive: true });
  const staleBuildId = ['fixture_baseline', 'v0', '0', '2', '23'].join('_');
  writeFileSync(
    join(tempRoot, 'tests/sample.test.ts'),
    `export const staleBaseline = "${staleBuildId}";\n`
  );

  const result = runVersionConsistencyCheck({ rootDir: tempRoot });
  const staleBuildFindings = result.findings.filter((finding) => finding.code === 'STALE_BUILD_ID_MARKER');
  assert.ok(
    staleBuildFindings.some((finding) => finding.file === 'tests/sample.test.ts' && finding.actual === staleBuildId),
    `expected stale buildId finding for tests/sample.test.ts: ${JSON.stringify(staleBuildFindings)}`
  );
});

test('stale scan allowlist is path-level for negative contract files and does not skip all tests/**', () => {
  const surface = loadVersionSurface(root);
  const allowlist = pathAllowlistForStaleScan(surface.projectTarget);
  for (const rel of STALE_SCAN_NEGATIVE_CONTRACT_PATHS) {
    assert.ok(allowlist.includes(rel), `${rel} must be on stale scan allowlist`);
  }
  assert.equal(allowlist.some((rel) => rel === 'tests/**' || rel === 'tests'), false);
  assert.equal(STALE_SCAN_NEGATIVE_CONTRACT_PATHS.some((rel) => rel.endsWith('.test.mjs')), true);

  const result = runVersionConsistencyCheck({ rootDir: root });
  const staleOnAllowlisted = result.findings.filter(
    (finding) => finding.code.startsWith('STALE_') && allowlist.includes(finding.file)
  );
  assert.deepEqual(staleOnAllowlisted, []);
});

test('version surface contracts are registered for fast/full/blocker gates', () => {
  const registry = JSON.parse(readFileSync(join(root, 'tools/quality/test-registry.json'), 'utf8'));
  const task = registry.tests['test.version-surface-contracts'];
  assert.ok(task);
  assert.deepEqual(task.tags.sort(), ['blocker', 'fast', 'full', 'quality', 'version'].sort());
  assert.equal(existsSync(join(root, 'tests/version-surface-contracts.test.mjs')), true);
});
