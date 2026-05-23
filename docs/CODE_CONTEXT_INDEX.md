# CODE_CONTEXT_INDEX — v0.0.2.22

版本：v0.0.2.22 / Affected Policy Hardening & Coverage Evidence。

## 执行前必读顺序

1. `package.json`
2. `tools/quality/rules/project-target.json`
3. `tools/quality/quality.config.json`
4. `tools/quality/module-graph.json`
5. `tools/quality/test-registry.json`
6. `tools/quality/gate-policy.json`
7. `tools/quality/affected/affectedPolicy.mjs`
8. `tools/quality/affected/resolveChangedFiles.mjs`
9. `tools/quality/affected/resolveAffectedModules.mjs`
10. `tools/quality/affected/resolveAffectedTasks.mjs`
11. `tools/quality/affected/writeAffectedReport.mjs`
12. `tools/quality/cache/qualityCache.mjs`
13. `docs/CHECK_ARCHITECTURE.md`
14. `docs/ARCHITECTURE.md`
15. `docs/IMPLEMENTATION_SCOPE.md`

## 预检报告必须包含

输入版本、目标版本、正式包 v1.5.2.2 来源、已读取文件证据、未覆盖模块声明、旧版本残留扫描、Task Intent Lock、本轮唯一目标、验收命令和执行前判断。

后续建议不是授权目标。外部执行指令必须说明任务意图；若版本号出现两个不同任务意图，先修任务锁，不继续写代码。当前任务上下文交接来自外部执行指令或开发日志包，代码包不保存每轮具体任务上下文，代码包只保存执行端上下文治理约束。

## v0.0.2.22 affected policy 索引

- `tools/quality/affected/affectedPolicy.mjs`：file risk classification、fallbackLevel、minimumRequiredTasks 与风险到任务的基础策略。
- `tools/quality/affected/resolveChangedFiles.mjs`：解析 CLI / file / git diff changed files。
- `tools/quality/affected/resolveAffectedModules.mjs`：解析 owning modules 与 reverse dependency closure。
- `tools/quality/affected/resolveAffectedTasks.mjs`：生成 selectedTasks、taskSelectionReasons、skippedTaskReasons、moduleToTaskMap、missingMinimumTasks。
- `tools/quality/affected/writeAffectedReport.mjs`：输出 affected coverage evidence report。
- `tools/quality/cache/qualityCache.mjs`：本地 report-only cache probe；release/full 不使用 cache。

## v0.0.2.22 测试索引

- `tests/quality-affected-contracts.test.mjs`
- `tests/quality-affected-policy-hardening.test.mjs`
- `tests/quality-cache-contracts.test.mjs`
- `tests/quality-gate-contracts.test.mjs`
- `tests/quality-plugin-contracts.test.mjs`
- `tests/quality-rule-authority-contracts.test.mjs`
- `tests/package-hygiene.test.mjs`
- `tests/context-governance-contracts.test.mjs`
- `tests/fixtures/quality-affected/**`

## 既有架构边界索引

不跳过 ActionPipeline，不直接改 SaveFile，不接真实 `cc / wx / fs`。`architecture-boundary.rules.json`、`architecture-boundary-check.mjs`、`architecture-boundary-plugin-contracts.test.mjs`、`architecture-boundary-authority-contracts.test.mjs`、`architecture-boundary-token-alignment.test.mjs`、`quality:architecture-boundary` 与 `loadArchitectureBoundaryRules` 继续有效；旧 validator 仍保留权威红线。

release zip 仍检查 UTF-8 metadata 与 mojibake 路径，并排除 `reports/quality`、`.cache/quality`、日志包、node_modules、coverage、dist。

## 检查命令别名索引

- `q:affected`
- `test:quality-affected-contracts`
- `test:quality-cache-contracts`
- `context-doc-surface.rules.json`
- `project-target.json`
- `loadArchitectureBoundaryRules`
- `UTF-8 metadata`
- `mojibake 路径`

## 架构边界测试补充索引

- `architecture-boundary-token-alignment.test.mjs`
- `旧 validator 仍保留权威红线`
