# CODE_CONTEXT_INDEX — v0.0.2.27

版本：v0.0.2.27 / PR Quality Gate / PR 自动质量验证版。

## 执行前必读顺序

1. `package.json`
2. `tools/quality/rules/project-target.json`
3. `tools/quality/quality.config.json`（含 `rules.traceabilityMap`）
4. `docs/GITHUB_WORKFLOW.md`
5. `docs/PROJECT_MAP.md`
6. `docs/TRACEABILITY_MATRIX.md`
7. `docs/DOCS_GOVERNANCE.md`
8. `docs/GLOSSARY.md`
9. `docs/CODE_CONTEXT_INDEX.md`
10. `docs/CHECK_ARCHITECTURE.md`
11. `docs/ARCHITECTURE.md`
12. `docs/IMPLEMENTATION_SCOPE.md`
13. `tools/quality/module-graph.json`
14. `tools/quality/test-registry.json`
15. `tools/quality/gate-policy.json`
16. `tools/quality/rules/traceability-map.json`
17. 本轮 Scope Discovery 指定的 module-cards / maps / code-index

## 预检报告必须包含

输入版本、目标版本、正式包 v1.5.2.2 来源、已读取文件证据、未覆盖模块声明、旧版本残留扫描、Task Intent Lock、本轮唯一目标、验收命令和执行前判断。

复杂任务必须先做 Scope Discovery；项目超出上下文时必须分层读取（见 PROJECT_MAP L0–L5）。Cursor 不得只依赖更新指导摘要；新增/修改/删除代码必须同步维护受影响层级项目地图与 traceability active entries。

后续建议不是授权目标。外部执行指令必须说明任务意图；若版本号出现两个不同任务意图，先修任务锁，不继续写代码。当前任务上下文交接来自外部执行指令或开发日志包；代码包不保存每轮具体任务上下文；代码包只保存执行端上下文治理约束。

## v0.0.2.27 测试索引

- `tests/ci-workflow-contracts.test.mjs`（`test:ci-workflow-contracts` / registry `test.ci-workflow-contracts`）
- `tests/cocos-runtime-session.test.ts`（`test:cocos-session` / registry `test.cocos-session`）
- `tests/traceability-contracts.test.mjs`
- `tests/project-map-contracts.test.mjs`
- `tests/context-governance-contracts.test.mjs`
- `tests/quality-gate-contracts.test.mjs`
- `tests/quality-affected-policy-hardening.test.mjs`
- `tests/version-surface-contracts.test.mjs`
- `tests/package-hygiene.test.mjs`

## PR CI 入口

先读 `.github/workflows/quality.yml` 与 `docs/GITHUB_WORKFLOW.md`，再核对 YAML 契约、test-registry 和 `trace.quality.pr-ci`。CI 在 PR 到 main 时使用 Ubuntu 24.04、Node 24、Python 3.12，`npm ci` 后执行现有 q:full；成功或失败均尝试保留 JSON / Markdown 报告 7 天。具体云端通过记录、报告及分支保护状态应现场核对，不能由本地通过推定。

## 既有架构边界索引

不跳过 ActionPipeline，不直接改 SaveFile，不接真实 `cc / wx / fs`。`architecture-boundary.rules.json`、`architecture-boundary-check.mjs`、`quality:architecture-boundary` 与 `loadArchitectureBoundaryRules` 继续有效；旧 validator 仍保留权威红线。

release zip 仍检查 UTF-8 metadata 与 mojibake 路径，并排除 `reports/quality`、`.cache/quality`、日志包、node_modules、coverage、dist。

## 检查命令别名索引

- `q:affected`
- `q:full`
- `q:release`
- `test:ci-workflow-contracts`
- `test:traceability-contracts`
- `test:project-map-contracts`
- `traceability-map.json`
- `context-doc-surface.rules.json`
- `project-target.json`

## 遗留 module_contracts 说明

`docs/module_contracts/` 保留为上下文治理契约，不是新版 module-card 主入口。新版导航见 `docs/module-cards/`。
