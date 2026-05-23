import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = process.cwd();

const requiredProjectMapDocs = [
  'docs/GITHUB_WORKFLOW.md',
  'docs/PROJECT_MAP.md',
  'docs/DOCS_GOVERNANCE.md',
  'docs/GLOSSARY.md',
  'docs/maps/domain-map.md',
  'docs/maps/runtime-map.md',
  'docs/maps/quality-map.md',
  'docs/maps/cocos-map.md',
  'docs/code-index/files.md',
  'docs/code-index/public-api.md'
];

const requiredModuleCards = [
  'docs/module-cards/game-core.md',
  'docs/module-cards/inventory.md',
  'docs/module-cards/processing.md',
  'docs/module-cards/cooking.md',
  'docs/module-cards/orders.md',
  'docs/module-cards/save-load.md',
  'docs/module-cards/cocos-app.md',
  'docs/module-cards/cocos-creator-adapter.md',
  'docs/module-cards/quality-tools.md',
  'docs/module-cards/release-tools.md'
];

const moduleCardExplicitPaths = [
  'src/game-core/action/ActionPipeline.ts',
  'src/game-core/save/SaveManager.ts',
  'src/cocos-app/runtime/CocosAppRuntimeSession.ts',
  'tools/quality/run-quality-gate.mjs',
  'tools/build_release_package.py'
];

const codeIndexExplicitPaths = [
  'tools/quality/rules/project-target.json',
  'tools/quality/module-graph.json',
  'tools/quality/test-registry.json',
  'tools/quality/gate-policy.json'
];

const forbiddenMisauthorityPatterns = [
  /永远基于\s*v0\.0\.2\.22/,
  /q:affected\s*(可以|能|能够)?\s*替代\s*(q:full|q:release|release)/,
  /日志包.*代码生成依据/,
  /跳过预检.*直接/,
  /技术指导.*玩法权威/,
  /Cocos\s*日常开发权威.*zip/,
  /v0\.0\.2\.22.*永久当前版本/
];

const forbiddenModuleContractsAsPrimaryPatterns = [
  /项目地图主入口.*docs\/module_contracts/,
  /module-card.*docs\/module_contracts/,
  /新增.*docs\/module_contracts.*module.?card/i,
  /推荐使用\s*`?docs\/module_contracts\/`?\s*作为.*module.?card/i
];

test('project map governance documents exist', () => {
  for (const rel of [...requiredProjectMapDocs, ...requiredModuleCards]) {
    assert.equal(existsSync(join(root, rel)), true, `${rel} must exist`);
  }
});

test('README and CODE_CONTEXT_INDEX link to project map workflow entrypoints', () => {
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const index = readFileSync(join(root, 'docs/CODE_CONTEXT_INDEX.md'), 'utf8');

  assert.match(readme, /GITHUB_WORKFLOW\.md/);
  assert.match(readme, /PROJECT_MAP\.md/);
  assert.match(index, /PROJECT_MAP\.md/);
  assert.match(index, /GITHUB_WORKFLOW\.md/);
});

test('module-card and code-index explicit paths exist', () => {
  for (const rel of [...moduleCardExplicitPaths, ...codeIndexExplicitPaths]) {
    assert.equal(existsSync(join(root, rel)), true, `${rel} must exist`);
  }
});

test('project map docs do not misstate authority or skip precheck', () => {
  const scanned = collectMarkdown('docs').concat(readFileSync(join(root, 'README.md'), 'utf8'));

  for (const pattern of forbiddenMisauthorityPatterns) {
    assertForbiddenPositiveMisauthority(scanned, pattern);
  }
});

test('project map docs do not promote docs/module_contracts as new module-card primary entry', () => {
  const projectMapDocs = [
    'docs/GITHUB_WORKFLOW.md',
    'docs/PROJECT_MAP.md',
    'docs/DOCS_GOVERNANCE.md',
    'docs/GLOSSARY.md',
    'docs/CODE_CONTEXT_INDEX.md',
    'README.md'
  ].map((rel) => readFileSync(join(root, rel), 'utf8')).join('\n');

  for (const pattern of forbiddenModuleContractsAsPrimaryPatterns) {
    assertForbiddenPositiveMisauthority(projectMapDocs, pattern);
  }

  assert.match(projectMapDocs, /module-cards/);
  assert.match(projectMapDocs, /module_contracts.*保留|保留.*module_contracts/);
});

function assertForbiddenPositiveMisauthority(text, pattern) {
  for (const line of text.split(/\r?\n/)) {
    if (!pattern.test(line)) continue;
  if (/(不是|≠|非|禁止|不把|不得|错误理解|仅讨论|保留|legacy|遗留)/.test(line)) continue;
    assert.fail(`forbidden misauthority on line: ${line}`);
  }
}

test('current version is v0.0.2.23 in package metadata', () => {
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(packageJson.version, '0.0.2-23');

  const projectTarget = JSON.parse(readFileSync(join(root, 'tools/quality/rules/project-target.json'), 'utf8'));
  assert.equal(projectTarget.version.codePackageVersion, 'v0.0.2.23');
});

function collectMarkdown(relativeDir) {
  const dir = join(root, relativeDir);
  const files = [];

  function walk(current) {
    for (const name of readdirSync(current, { withFileTypes: true })) {
      const abs = join(current, name.name);
      if (name.isDirectory()) {
        if (name.name === 'adr' || name.name === 'module_contracts') continue;
        walk(abs);
      } else if (name.name.endsWith('.md')) {
        files.push(readFileSync(abs, 'utf8'));
      }
    }
  }

  walk(dir);
  return files.join('\n');
}

function markdownReferencedPaths(text) {
  const matches = [...text.matchAll(/`((?:docs|tests|tools|src)\/[A-Za-z0-9_./-]+)`/g)];
  const paths = matches.map((match) => match[1]).filter((rel) => !rel.includes('*'));
  return [...new Set(paths.map((rel) => rel.replace(/\/$/, '')))].filter((rel) => dirname(rel) !== '.');
}
