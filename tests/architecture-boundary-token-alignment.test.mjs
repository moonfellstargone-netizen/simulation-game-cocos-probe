import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveGateTasks } from '../tools/quality/lib/resolveGateTasks.mjs';
import { runArchitectureBoundaryCheck } from '../tools/quality/plugins/architecture-boundary-check.mjs';

const root = process.cwd();
const readJson = (rel) => JSON.parse(readFileSync(join(root, rel), 'utf8'));

function writeFixtureRules(tempRoot, tokenMode = 'shadow_aligned') {
  mkdirSync(join(tempRoot, 'tools/quality/rules'), { recursive: true });
  writeFileSync(join(tempRoot, 'tools/quality/module-graph.json'), JSON.stringify({ version: 'test', modules: { sample: { roots: ['src/cocos-creator-adapter/**'] } } }, null, 2));
  writeFileSync(join(tempRoot, 'tools/quality/rules/architecture-boundary.rules.json'), JSON.stringify({
    version: 'test',
    defaultMode: 'shadow',
    rules: {
      importBoundaries: [
        {
          id: 'core-no-cocos-app',
          mode: 'authoritative',
          severity: 'error',
          roots: ['src/game-core/**'],
          includeExtensions: ['.ts'],
          forbiddenImports: ['src/cocos-app/'],
          description: 'authoritative fixture import rule'
        }
      ],
      tokenBoundaries: [
        {
          id: 'component-binding-no-savefile-state-leak',
          mode: tokenMode,
          severity: 'shadow_error',
          roots: ['src/cocos-creator-adapter/**'],
          includeExtensions: ['.ts'],
          includeFiles: ['**/*binding*.ts', '**/*component*.ts', '**/*view*.ts', '**/*scene*.ts'],
          excludeFiles: ['**/*.test.ts', '**/__fixtures__/**', '**/fixtures/**'],
          forbiddenTokens: ['SaveFile', 'GameState', 'inventory', 'orders', 'reservations', 'domain_events'],
          allowedPhrases: ['no SaveFile', 'state-leak boundary explanation'],
          ignore: { lineComments: true, blockComments: true, stringLiterals: false },
          description: 'fixture token boundary rule'
        }
      ],
      pathOwnership: []
    }
  }, null, 2));
}

function makeTempRoot() {
  const tempRoot = mkdtempSync(join(tmpdir(), 'arch-token-align-'));
  writeFixtureRules(tempRoot);
  mkdirSync(join(tempRoot, 'src/cocos-creator-adapter/component'), { recursive: true });
  mkdirSync(join(tempRoot, 'src/game-core'), { recursive: true });
  cpSync(join(root, 'tests/fixtures/architecture-boundary/token-alignment/clean-component-binding.ts'), join(tempRoot, 'src/cocos-creator-adapter/component/clean-component-binding.ts'));
  cpSync(join(root, 'tests/fixtures/architecture-boundary/token-alignment/allowed-comment-token.ts'), join(tempRoot, 'src/cocos-creator-adapter/component/allowed-comment-token-binding.ts'));
  cpSync(join(root, 'tests/fixtures/architecture-boundary/token-alignment/allowed-phrase.ts'), join(tempRoot, 'src/cocos-creator-adapter/component/allowed-phrase-binding.ts'));
  cpSync(join(root, 'tests/fixtures/architecture-boundary/token-alignment/allowed-test-context.test.ts'), join(tempRoot, 'src/cocos-creator-adapter/component/allowed-test-context.test.ts'));
  return tempRoot;
}

test('engine-neutral state-leak token rules remain non-authoritative and declare scope plus allowed context', () => {
  const rules = readJson('tools/quality/rules/architecture-boundary.rules.json');
  const tokenRules = rules.rules.tokenBoundaries.filter((rule) => rule.owner === 'cocos-creator-adapter');
  for (const id of ['component-binding-no-savefile-state-leak', 'scene-binding-no-internal-state-leak', 'adapter-no-direct-runtime-state-shape']) {
    assert.ok(tokenRules.some((rule) => rule.id === id), id + ' remains in the engine-neutral shadow policy');
  }
  assert.ok(tokenRules.length >= 3, 'token boundary policy should audit multiple token/state-leak rules');
  for (const rule of tokenRules) {
    assert.notEqual(rule.mode, 'authoritative', `${rule.id} must not be authoritative in token boundary shadow policy`);
    assert.ok(['shadow', 'shadow_aligned'].includes(rule.mode), `${rule.id} remains shadow or shadow_aligned`);
    assert.equal(rule.severity, 'shadow_error');
    assert.ok(Array.isArray(rule.includeFiles) && rule.includeFiles.length > 0, `${rule.id} must narrow file scope`);
    assert.ok(Array.isArray(rule.excludeFiles) && rule.excludeFiles.length > 0, `${rule.id} must exclude test/fixture contexts`);
    assert.ok(Array.isArray(rule.allowedPhrases) || Array.isArray(rule.allowedContexts), `${rule.id} must declare allowed context`);
    assert.equal(rule.ignore?.lineComments, true, `${rule.id} should ignore line comments`);
    assert.equal(rule.ignore?.blockComments, true, `${rule.id} should ignore block comments`);
  }
});

test('token scanner detects real violations but ignores comments, allowed phrases, and excluded test files', () => {
  const tempRoot = makeTempRoot();
  writeFileSync(join(tempRoot, 'src/cocos-creator-adapter/component/violating-component-binding.ts'), 'export type UnsafeComponentBinding = { SaveFile: unknown };\n');
  const result = runArchitectureBoundaryCheck({ rootDir: tempRoot });
  assert.equal(result.status, 'passed', 'shadow_aligned token finding must not fail the plugin by itself');
  assert.equal(result.summary.authoritativeViolationCount, 0);
  assert.equal(result.summary.shadowFindingCount, 1);
  assert.equal(result.summary.shadowAlignedRuleCount, 1);
  assert.equal(result.summary.tokenRulesRemainNonAuthoritative, true);
  assert.equal(result.summary.tokenOccurrencesIgnoredCount, 1, 'comment token should be ignored');
  assert.equal(result.summary.tokenOccurrencesAllowedCount, 1, 'allowed phrase token should be counted as allowed');
  assert.ok(result.findings.some((finding) => finding.matchedToken === 'SaveFile' && finding.file.endsWith('violating-component-binding.ts')));
  assert.equal(result.findings.some((finding) => finding.file.endsWith('allowed-test-context.test.ts')), false, 'excludeFiles should exclude test context');
  assert.equal(result.findings.some((finding) => finding.file.endsWith('allowed-comment-token-binding.ts')), false, 'line comment token should be ignored');
  assert.equal(result.findings.some((finding) => finding.file.endsWith('allowed-phrase-binding.ts')), false, 'allowed phrase should not produce finding');
});

test('authoritative architecture boundary rules still fail while shadow_aligned token findings only report', () => {
  const tempRoot = makeTempRoot();
  writeFileSync(join(tempRoot, 'src/cocos-creator-adapter/component/violating-component-binding.ts'), 'export type UnsafeComponentBinding = { SaveFile: unknown };\n');
  writeFileSync(join(tempRoot, 'src/game-core/bad-import.ts'), "import x from '../cocos-app/runtime';\nexport default x;\n");
  const result = runArchitectureBoundaryCheck({ rootDir: tempRoot });
  assert.equal(result.status, 'failed');
  assert.equal(result.summary.authoritativeViolationCount, 1);
  assert.equal(result.summary.shadowFindingCount, 1);
  assert.ok(result.findings.some((finding) => finding.mode === 'authoritative' && finding.severity === 'error'));
  assert.ok(result.findings.some((finding) => finding.mode === 'shadow_aligned' && finding.severity === 'shadow_error'));
});

test('quality gates and package scripts cover token alignment and legacy authority remains registered', () => {
  const packageJson = readJson('package.json');
  const registry = readJson('tools/quality/test-registry.json');
  const policy = readJson('tools/quality/gate-policy.json');
  assert.equal(packageJson.scripts['test:architecture-boundary-token-alignment'], 'node --test tests/architecture-boundary-token-alignment.test.mjs');
  assert.ok(registry.tests['test.architecture-boundary-token-alignment']);
  const fullTasks = resolveGateTasks('full', policy, registry).map((task) => task.id);
  const releaseTasks = resolveGateTasks('release', policy, registry).map((task) => task.id);
  assert.ok(fullTasks.includes('test.architecture-boundary-token-alignment'));
  assert.ok(releaseTasks.includes('test.architecture-boundary-token-alignment'));
  assert.ok(fullTasks.includes('architecture.legacy'));
  assert.ok(fullTasks.includes('quality.architectureBoundary'));
});

test('legacy validator still guards high-risk token/state leak boundaries during double run', () => {
  const validator = readFileSync(join(root, 'tools/validate_code_architecture.py'), 'utf8');
  for (const required of [
    'ActionPipeline',
    'SaveFile',
    'GameState',
    'inventory',
    'orders',
    'reservations',
    'domain_events',
    '旧 validator 仍保留权威红线',
    'test:architecture-boundary-token-alignment'
  ]) {
    assert.equal(validator.includes(required), true, `legacy validator must retain or guard ${required}`);
  }
});
