import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = process.cwd();

const requiredDocs = [
  'docs/CODE_CONTEXT_INDEX.md',
  'docs/adr/ADR-0001-game-core-independent-from-engine.md',
  'docs/adr/ADR-0002-actionpipeline-as-only-formal-state-entry.md',
  'docs/adr/ADR-0003-load-failure-must-not-mutate-current-session.md',
  'docs/adr/ADR-0004-context-governance-artifacts-are-versioned-contracts.md',
  'docs/module_contracts/CocosAppRuntimeSession.contract.md',
  'docs/module_contracts/CocosSessionHost.contract.md',
  'docs/module_contracts/MinimalMenuInteractionController.contract.md',
  'docs/module_contracts/SaveLoadInteractionController.contract.md',
  'docs/module_contracts/CocosActionPreviewer.contract.md',
  'docs/module_contracts/CocosActionDraftBuilder.contract.md',
  'docs/module_contracts/SaveStoragePort.contract.md',
  'docs/module_contracts/CocosErrorPresenter.contract.md',
  'docs/module_contracts/CocosUiShellController.contract.md',
  'docs/module_contracts/CocosUiCommandQueue.contract.md',
  'docs/module_contracts/CocosUiShellSnapshotDiff.contract.md',
  'docs/module_contracts/CocosSceneBindingPort.contract.md',
  'docs/module_contracts/CocosSceneBindingController.contract.md',
  'docs/module_contracts/CocosComponentNodeBindingPort.contract.md',
  'docs/module_contracts/QinglanUiSceneProbeComponent.contract.md',
  'docs/CHECK_ARCHITECTURE.md'
];

const forbiddenTaskContextFiles = [
  'docs/CURRENT_TASK_CONTEXT.md',
  'docs/CURRENT_TASK_CONTEXT_TEMPLATE.md',
  'docs/TASK_CONTEXT.md',
  'docs/TASK_HANDOFF.md',
  'docs/PLANNING_CONVERSATION_CONTEXT.md'
];

test('context governance documents exist and are versioned with the code package', () => {
  for (const rel of requiredDocs) {
    assert.equal(existsSync(join(root, rel)), true, `${rel} must exist`);
  }

  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(packageJson.version, '0.0.2-24');

  const sourceDesign = readFileSync(join(root, 'docs/SOURCE_DESIGN_PACK.md'), 'utf8');
  assert.match(sourceDesign, /code package version: `v0\.0\.2\.24`/);
});

test('context index preserves execution precheck and default decision rules', () => {
  const text = readFileSync(join(root, 'docs/CODE_CONTEXT_INDEX.md'), 'utf8');
  for (const required of [
    '执行前必读顺序',
    '预检报告必须包含',
    '未覆盖模块声明',
    '不跳过 ActionPipeline',
    '不直接改 SaveFile',
    '不接真实 `cc / wx / fs`',
    'Task Intent Lock',
    '本轮唯一目标',
    '后续建议不是授权目标',
    '外部执行指令',
    '版本号出现两个不同任务意图',
    'architecture-boundary.rules.json',
    'architecture-boundary-check.mjs',
    'quality:architecture-boundary',
    'loadArchitectureBoundaryRules',
    'project-target.json',
    'context-doc-surface.rules.json',
    'Quality Version Surface & BuildId Authority',
    'GITHUB_WORKFLOW.md',
    'PROJECT_MAP.md',
    'Scope Discovery'
  ]) {
    assert.equal(text.includes(required), true, `CODE_CONTEXT_INDEX missing ${required}`);
  }
});

test('Task Intent Lock rule is documented across user-facing context files', () => {
  const combined = [
    'README.md',
    'docs/CODE_CONTEXT_INDEX.md',
    'docs/ARCHITECTURE.md',
    'docs/IMPLEMENTATION_SCOPE.md'
  ].map((rel) => readFileSync(join(root, rel), 'utf8')).join('\n');

  for (const required of [
    'Task Intent Lock',
    '本轮唯一目标',
    '后续建议不是授权目标',
    '外部执行指令',
    '版本号出现两个不同任务意图'
  ]) {
    assert.equal(combined.includes(required), true, `Task Intent Lock rule missing ${required}`);
  }
});

test('ADR-0004 references the real context governance test path', () => {
  const adr = readFileSync(join(root, 'docs/adr/ADR-0004-context-governance-artifacts-are-versioned-contracts.md'), 'utf8');
  assert.equal(adr.includes('tests/context-governance-contracts.test.ts'), false);
  assert.equal(adr.includes('tests/context-governance-contracts.test.mjs'), true);
  assert.equal(existsSync(join(root, 'tests/context-governance-contracts.test.mjs')), true);

  const referencedPaths = markdownReferencedPaths(adr);
  assert.ok(referencedPaths.includes('tests/context-governance-contracts.test.mjs'));
  for (const rel of referencedPaths) {
    assert.equal(existsSync(join(root, rel)), true, `ADR-0004 references missing path: ${rel}`);
  }
});

test('concrete task context handoff files are not stored in the code package', () => {
  for (const rel of forbiddenTaskContextFiles) {
    assert.equal(existsSync(join(root, rel)), false, `${rel} must not enter the code package`);
  }
});

test('ADRs preserve long-term architectural decisions and rationale', () => {
  const adrText = collectMarkdown('docs/adr');
  for (const required of [
    'game-core 必须保持 engine-neutral / platform-neutral',
    '所有正式状态变化必须通过',
    '读档失败不得污染当前 session',
    '上下文治理文件必须随代码包版本化',
    'Task Intent Lock',
    '后续建议不是授权目标',
    '## 后果',
    '## 禁止项',
    '## 验证'
  ]) {
    assert.equal(adrText.includes(required), true, `ADR set missing ${required}`);
  }
});

test('module contracts pin responsibilities, forbidden dependencies, invariants, and related tests', () => {
  const contractText = collectMarkdown('docs/module_contracts');
  for (const required of [
    'CocosAppRuntimeSession',
    'CocosSessionHost',
    'MinimalMenuInteractionController',
    'SaveLoadInteractionController',
    'CocosActionPreviewer',
    'CocosActionDraftBuilder',
    'SaveStoragePort',
    'CocosErrorPresenter',
    'CocosUiShellController',
    'CocosUiShellCommandQueue',
    'CocosUiShellSnapshotDiff',
    'CocosSceneBindingPort',
    'CocosSceneBindingController',
    'CocosComponentNodeBindingPort',
    'QinglanUiSceneProbeComponent',
    '## 职责',
    '## 允许依赖',
    '## 禁止依赖',
    '## 不变量',
    '## 关联测试',
    'load 失败不得污染当前 session',
    'confirm 必须最终走 `session.dispatch -> ActionPipeline`',
    'UI Shell 只组合既有边界',
    'Queue 是表现层命令排队，不是业务事务系统',
    'Diff 是节点绑定前置摘要，不是 JSON Patch 引擎',
    'Scene Binding Boundary Stub 是抽象场景绑定边界，不是真实 Cocos 场景实现',
    'Component Node Binding Adapter Probe',
    'Patch payload 必须拷贝'
  ]) {
    assert.equal(contractText.includes(required), true, `module contracts missing ${required}`);
  }
});

function collectMarkdown(relativeDir) {
  const dir = join(root, relativeDir);
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => readFileSync(join(dir, name), 'utf8'))
    .join('\n');
}

function markdownReferencedPaths(text) {
  const matches = [...text.matchAll(/`((?:docs|tests|tools)\/[A-Za-z0-9_./-]+)`/g)];
  const paths = matches.map((match) => match[1]).filter((rel) => !rel.includes('*'));
  return [...new Set(paths.map((rel) => rel.replace(/\/$/, '')))].filter((rel) => dirname(rel) !== '.');
}
