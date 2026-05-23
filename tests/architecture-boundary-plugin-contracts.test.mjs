import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveGateTasks } from '../tools/quality/lib/resolveGateTasks.mjs';
import { runArchitectureBoundaryCheck } from '../tools/quality/plugins/architecture-boundary-check.mjs';

const root = process.cwd();
const readJson = (rel) => JSON.parse(readFileSync(join(root, rel), 'utf8'));

test('architecture boundary rule files, plugin, scripts, and registry entries exist', () => {
  const packageJson = readJson('package.json');
  const registry = readJson('tools/quality/test-registry.json');
  const policy = readJson('tools/quality/gate-policy.json');
  assert.equal(existsSync(join(root, 'tools/quality/rules/architecture-boundary.rules.json')), true);
  assert.equal(existsSync(join(root, 'tools/quality/plugins/architecture-boundary-check.mjs')), true);
  assert.equal(packageJson.scripts['quality:architecture-boundary'], 'node tools/quality/plugins/architecture-boundary-check.mjs');
  assert.equal(packageJson.scripts['test:architecture-boundary-plugin-contracts'], 'node --test tests/architecture-boundary-plugin-contracts.test.mjs');
  assert.ok(registry.tests['quality.architectureBoundary']);
  assert.ok(registry.tests['test.architecture-boundary-plugin-contracts']);
  const fullTasks = resolveGateTasks('full', policy, registry).map((task) => task.id);
  const releaseTasks = resolveGateTasks('release', policy, registry).map((task) => task.id);
  assert.ok(fullTasks.includes('quality.architectureBoundary'));
  assert.ok(fullTasks.includes('test.architecture-boundary-plugin-contracts'));
  assert.ok(releaseTasks.includes('quality.architectureBoundary'));
  assert.ok(releaseTasks.includes('test.architecture-boundary-plugin-contracts'));
  assert.ok(releaseTasks.includes('architecture.legacy'));
});

test('architecture boundary rules are structured, unique, and use per-rule modes', () => {
  const rules = readJson('tools/quality/rules/architecture-boundary.rules.json');
  assert.equal(rules.defaultMode, 'shadow');
  const ids = [];
  for (const groupName of ['importBoundaries', 'tokenBoundaries', 'pathOwnership']) {
    assert.ok(Array.isArray(rules.rules[groupName]), `${groupName} must be an array`);
    for (const rule of rules.rules[groupName]) {
      ids.push(rule.id);
      assert.ok(rule.id, 'rule id required');
      assert.ok(rule.description, `${rule.id} description required`);
      assert.ok(rule.mode, `${rule.id} mode required`);
      assert.ok(rule.severity, `${rule.id} severity required`);
      assert.ok(Array.isArray(rule.roots) && rule.roots.length > 0, `${rule.id} roots required`);
      if (rule.mode === 'authoritative') assert.equal(rule.severity, 'error', `${rule.id} authoritative severity`);
      if (rule.mode === 'shadow' || rule.mode === 'shadow_aligned') assert.equal(rule.severity, 'shadow_error', `${rule.id} shadow severity`);
      if (groupName === 'tokenBoundaries') assert.ok(Array.isArray(rule.forbiddenTokens) && rule.forbiddenTokens.length > 0);
      else assert.ok(Array.isArray(rule.forbiddenImports) && rule.forbiddenImports.length > 0);
    }
  }
  assert.equal(new Set(ids).size, ids.length, 'architecture boundary rule ids must be unique');
  assert.ok(ids.includes('game-core-no-presentation-or-platform'));
  assert.ok(ids.includes('component-binding-no-savefile-state-leak'));
  assert.ok(ids.includes('tools-quality-not-business-runtime'));
});

test('architecture boundary plugin uses runtime helpers, stays read-only, and avoids runtime imports', () => {
  const plugin = readFileSync(join(root, 'tools/quality/plugins/architecture-boundary-check.mjs'), 'utf8');
  assert.equal(plugin.includes('../plugin-runtime/'), true);
  assert.equal(/writeFileSync|appendFileSync|rmSync|unlinkSync|mkdirSync/.test(plugin), false);
  assert.equal(/from ['"][^'"]*src\/(game-core|cocos-app|cocos-creator-adapter)|import\([^)]*src\/(game-core|cocos-app|cocos-creator-adapter)/.test(plugin), false);
  assert.equal(plugin.includes('v0.0.2.22'), false);
  assert.equal(plugin.includes('模拟游戏_Cocos微信试水代码包_v0_0_2_22'), false);
});

test('legacy validator remains authority for high-risk rules while architecture boundary owns low-risk blockers', () => {
  const validator = readFileSync(join(root, 'tools/validate_code_architecture.py'), 'utf8');
  for (const required of [
    'ActionPipeline',
    'SaveFile',
    'game-core',
    'cocos-creator-adapter',
    'FormalStage1AActionValidator',
    'architecture-boundary.rules.json',
    'architecture-boundary-check.mjs',
    'quality:architecture-boundary',
    '旧 validator 仍保留权威红线'
  ]) {
    assert.equal(validator.includes(required), true, `legacy validator must retain or guard ${required}`);
  }
  const docs = readFileSync(join(root, 'docs/CHECK_ARCHITECTURE.md'), 'utf8') + readFileSync(join(root, 'docs/IMPLEMENTATION_SCOPE.md'), 'utf8');
  assert.equal(docs.includes('authoritative'), true);
  assert.equal(docs.includes('shadow findings'), true);
  assert.equal(docs.includes('legacy validator'), true);
  assert.equal(docs.includes('architecture-boundary-check.mjs'), true);
  assert.equal(docs.includes('architecture-boundary.rules.json'), true);
  assert.match(docs, /不删除旧 validator 核心红线|高风险红线/);
});

test('architecture boundary plugin distinguishes authoritative violations from shadow findings', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'arch-boundary-'));
  mkdirSync(join(tempRoot, 'tools/quality/rules'), { recursive: true });
  mkdirSync(join(tempRoot, 'src/game-core'), { recursive: true });
  mkdirSync(join(tempRoot, 'src/cocos-creator-adapter/component'), { recursive: true });
  mkdirSync(join(tempRoot, 'tools/quality/plugins'), { recursive: true });
  writeFileSync(join(tempRoot, 'tools/quality/module-graph.json'), JSON.stringify({ version: 'test', modules: { sample: { roots: ['src/game-core/**'] } } }, null, 2));
  writeFileSync(join(tempRoot, 'tools/quality/rules/architecture-boundary.rules.json'), JSON.stringify({
    version: 'test',
    defaultMode: 'shadow',
    rules: {
      importBoundaries: [{ id: 'core-no-ui', mode: 'authoritative', roots: ['src/game-core/**'], includeExtensions: ['.ts'], forbiddenImports: ['src/cocos-app/'], severity: 'error', description: 'test import rule' }],
      tokenBoundaries: [{ id: 'component-no-state', mode: 'shadow', roots: ['src/cocos-creator-adapter/**'], includeExtensions: ['.ts'], includeFiles: ['**/*token*.ts', '**/*component*.ts'], excludeFiles: ['**/*.test.ts', '**/fixtures/**'], forbiddenTokens: ['SaveFile'], allowedPhrases: ['no SaveFile'], ignore: { lineComments: true, blockComments: true, stringLiterals: false }, severity: 'shadow_error', description: 'test token rule' }],
      pathOwnership: [{ id: 'quality-no-core', mode: 'authoritative', roots: ['tools/quality/**'], includeExtensions: ['.mjs'], forbiddenImports: ['src/game-core/action/'], severity: 'error', description: 'test ownership rule' }]
    }
  }, null, 2));
  writeFileSync(join(tempRoot, 'src/game-core/clean.ts'), 'export const clean = 1;\n');
  writeFileSync(join(tempRoot, 'src/game-core/bad-import.ts'), "import { something } from '../cocos-app/runtime';\nexport const bad = something;\n");
  writeFileSync(join(tempRoot, 'src/cocos-creator-adapter/component/bad-token.ts'), 'type Local = { SaveFile: unknown };\n');
  writeFileSync(join(tempRoot, 'tools/quality/plugins/bad-owner.mjs'), "import x from '../../../src/game-core/action/ActionPipeline';\nexport default x;\n");
  const result = runArchitectureBoundaryCheck({ rootDir: tempRoot });
  assert.equal(result.status, 'failed', 'authoritative import/path ownership violations should fail temp fixture');
  assert.equal(result.summary.authoritativeViolationCount, 2);
  assert.equal(result.summary.shadowFindingCount, 1);
  assert.ok(result.findings.some((finding) => finding.mode === 'authoritative' && finding.severity === 'error'));
  assert.ok(result.findings.some((finding) => ['shadow', 'shadow_aligned'].includes(finding.mode) && finding.severity === 'shadow_error'));
});
