import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveGateTasks } from '../tools/quality/lib/resolveGateTasks.mjs';
import { runArchitectureBoundaryCheck } from '../tools/quality/plugins/architecture-boundary-check.mjs';

const root = process.cwd();
const readJson = (rel) => JSON.parse(readFileSync(join(root, rel), 'utf8'));

test('new engine layer permits cc while blocking internal imports and reverse dependencies', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'cocos-outer-boundary-'));
  for (const dir of ['tools/quality/rules', 'apps/cocos-probe', 'src/game-core', 'src/cocos-app', 'src/cocos-creator-adapter']) mkdirSync(join(tempRoot, dir), { recursive: true });
  writeFileSync(join(tempRoot, 'tools/quality/module-graph.json'), JSON.stringify(readJson('tools/quality/module-graph.json')));
  writeFileSync(join(tempRoot, 'tools/quality/rules/architecture-boundary.rules.json'), JSON.stringify(readJson('tools/quality/rules/architecture-boundary.rules.json')));
  writeFileSync(join(tempRoot, 'apps/cocos-probe/clean.ts'), "import { Component } from 'cc';\nexport const component = Component;\n");
  const clean = runArchitectureBoundaryCheck({ rootDir: tempRoot });
  assert.equal(clean.status, 'passed');
  const outerImports = ['wx', 'node:fs', '../../tests/helper', '../../tools/helper', '../../src/game-core/action/ActionPipeline', '../../src/game-core/dev-api'];
  outerImports.forEach((specifier, index) => writeFileSync(join(tempRoot, 'apps/cocos-probe/bad-' + index + '.ts'), "import x from '" + specifier + "';\nexport default x;\n"));
  for (const dir of ['game-core', 'cocos-app', 'cocos-creator-adapter']) writeFileSync(join(tempRoot, 'src/' + dir + '/reverse.ts'), "import x from '../../apps/cocos-probe/clean';\nexport default x;\n");
  writeFileSync(join(tempRoot, 'src/cocos-creator-adapter/engine.ts'), "import { Component } from 'cc';\nexport { Component };\n");
  writeFileSync(join(tempRoot, 'apps/cocos-probe/global.ts'), "export const storage = wx.getStorageSync('save');\n");
  const invalid = runArchitectureBoundaryCheck({ rootDir: tempRoot });
  assert.equal(invalid.status, 'failed');
  for (let index = 0; index < outerImports.length; index += 1) assert.ok(invalid.findings.some((finding) => finding.mode === 'authoritative' && finding.file === 'apps/cocos-probe/bad-' + index + '.ts'));
  for (const dir of ['game-core', 'cocos-app', 'cocos-creator-adapter']) assert.ok(invalid.findings.some((finding) => finding.mode === 'authoritative' && finding.file === 'src/' + dir + '/reverse.ts'));
  assert.ok(invalid.findings.some((finding) => finding.mode === 'authoritative' && finding.file === 'src/cocos-creator-adapter/engine.ts'));
  assert.ok(invalid.findings.some((finding) => finding.mode === 'authoritative' && finding.file === 'apps/cocos-probe/global.ts'));
});

test('low-risk architecture boundary rules are authoritative while existing state-leak tokens remain shadow', () => {
  const rules = readJson('tools/quality/rules/architecture-boundary.rules.json');
  const allRules = Object.values(rules.rules).flat();
  const byId = Object.fromEntries(allRules.map((rule) => [rule.id, rule]));
  assert.ok(allRules.some((rule) => rule.mode === 'authoritative'), 'at least one authoritative rule required');
  for (const id of [
    'game-core-no-presentation-or-platform',
    'cocos-creator-adapter-no-real-engine-or-platform',
    'tools-quality-not-business-runtime'
  ]) {
    assert.equal(byId[id]?.mode, 'authoritative', `${id} must be authoritative`);
    assert.equal(byId[id]?.severity, 'error', `${id} must block as error`);
  }
  assert.ok(['shadow', 'shadow_aligned'].includes(byId['component-binding-no-savefile-state-leak']?.mode));
  assert.equal(byId['component-binding-no-savefile-state-leak']?.severity, 'shadow_error');
  assert.equal(byId['cocos-engine-probe-no-wx-global']?.mode, 'authoritative');
  assert.equal(byId['cocos-engine-probe-no-wx-global']?.severity, 'error');
});

test('arch:check covers both legacy validator and architecture-boundary authoritative rules', () => {
  const packageJson = readJson('package.json');
  const runner = readFileSync(join(root, 'tools/run-architecture-check.mjs'), 'utf8');
  assert.equal(packageJson.scripts['arch:check'], 'node tools/run-architecture-check.mjs');
  assert.equal(packageJson.scripts['arch:legacy'], 'python3 tools/validate_code_architecture.py');
  assert.equal(runner.includes('tools/validate_code_architecture.py'), true);
  assert.equal(runner.includes('tools/quality/plugins/architecture-boundary-check.mjs'), true);
  assert.equal(runner.includes('process.exit(failed ? 1 : 0)'), true);
});

test('q:full and q:release include architecture boundary authority coverage and legacy architecture', () => {
  const registry = readJson('tools/quality/test-registry.json');
  const policy = readJson('tools/quality/gate-policy.json');
  const fullTasks = resolveGateTasks('full', policy, registry).map((task) => task.id);
  const releaseTasks = resolveGateTasks('release', policy, registry).map((task) => task.id);
  for (const required of [
    'architecture.legacy',
    'quality.architectureBoundary',
    'test.architecture-boundary-plugin-contracts',
    'test.architecture-boundary-authority-contracts'
  ]) {
    assert.ok(fullTasks.includes(required), `full gate must include ${required}`);
    assert.ok(releaseTasks.includes(required), `release gate must include ${required}`);
  }
});

test('authoritative violation fails, shadow-only finding reports without failing', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'arch-authority-'));
  mkdirSync(join(tempRoot, 'tools/quality/rules'), { recursive: true });
  mkdirSync(join(tempRoot, 'src/game-core'), { recursive: true });
  mkdirSync(join(tempRoot, 'src/cocos-creator-adapter/component'), { recursive: true });
  writeFileSync(join(tempRoot, 'tools/quality/module-graph.json'), JSON.stringify({ version: 'test', modules: { sample: { roots: ['src/game-core/**'] } } }, null, 2));
  writeFileSync(join(tempRoot, 'tools/quality/rules/architecture-boundary.rules.json'), JSON.stringify({
    version: 'test',
    defaultMode: 'shadow',
    rules: {
      importBoundaries: [{ id: 'core-no-ui', mode: 'authoritative', roots: ['src/game-core/**'], includeExtensions: ['.ts'], forbiddenImports: ['src/cocos-app/'], severity: 'error', description: 'test import rule' }],
      tokenBoundaries: [{ id: 'component-no-state', mode: 'shadow', roots: ['src/cocos-creator-adapter/**'], includeExtensions: ['.ts'], includeFiles: ['**/*token*.ts', '**/*component*.ts'], excludeFiles: ['**/*.test.ts', '**/fixtures/**'], forbiddenTokens: ['SaveFile'], allowedPhrases: ['no SaveFile'], ignore: { lineComments: true, blockComments: true, stringLiterals: false }, severity: 'shadow_error', description: 'test token rule' }],
      pathOwnership: []
    }
  }, null, 2));
  writeFileSync(join(tempRoot, 'src/game-core/clean.ts'), 'export const clean = 1;\n');
  writeFileSync(join(tempRoot, 'src/cocos-creator-adapter/component/bad-token.ts'), 'type Local = { SaveFile: unknown };\n');
  const shadowOnly = runArchitectureBoundaryCheck({ rootDir: tempRoot });
  assert.equal(shadowOnly.status, 'passed');
  assert.equal(shadowOnly.summary.authoritativeViolationCount, 0);
  assert.equal(shadowOnly.summary.shadowFindingCount, 1);

  writeFileSync(join(tempRoot, 'src/game-core/bad-import.ts'), "import x from '../cocos-app/runtime';\nexport default x;\n");
  const withAuthoritative = runArchitectureBoundaryCheck({ rootDir: tempRoot });
  assert.equal(withAuthoritative.status, 'failed');
  assert.equal(withAuthoritative.summary.authoritativeViolationCount, 1);
});

test('legacy validator still contains high-risk architecture red lines', () => {
  const validator = readFileSync(join(root, 'tools/validate_code_architecture.py'), 'utf8');
  for (const required of [
    'ActionPipeline',
    'SaveFile',
    'FormalStage1AActionValidator',
    'ProcessingSystem',
    'CookingSystem',
    'DemandResolver',
    'system action',
    'Stage 1A'
  ]) {
    assert.equal(validator.includes(required), true, `legacy validator must still mention/check ${required}`);
  }
});
