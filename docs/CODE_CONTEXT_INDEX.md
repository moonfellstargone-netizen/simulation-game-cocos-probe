# CODE_CONTEXT_INDEX — v0.0.2.24

版本：v0.0.2.24 / Quality Version Surface & BuildId Authority。

## 执行前必读顺序

1. `package.json`
2. `tools/quality/rules/project-target.json`
3. `docs/GITHUB_WORKFLOW.md`
4. `docs/PROJECT_MAP.md`
5. `docs/DOCS_GOVERNANCE.md`
6. `docs/GLOSSARY.md`
7. `docs/CODE_CONTEXT_INDEX.md`
8. `docs/CHECK_ARCHITECTURE.md`
9. `docs/ARCHITECTURE.md`
10. `docs/IMPLEMENTATION_SCOPE.md`
11. `tools/quality/module-graph.json`
12. `tools/quality/test-registry.json`
13. `tools/quality/gate-policy.json`
14. 本轮 Scope Discovery 指定的 module-cards / maps / code-index

## 预检报告必须包含

输入版本、目标版本、正式包 v1.5.2.2 来源、已读取文件证据、未覆盖模块声明、旧版本残留扫描、Task Intent Lock、本轮唯一目标、验收命令和执行前判断。

复杂任务必须先做 Scope Discovery；项目超出上下文时必须分层读取（见 PROJECT_MAP L0–L5）。Cursor 不得只依赖更新指导摘要；新增/修改/删除代码必须同步维护受影响层级项目地图。

后续建议不是授权目标。外部执行指令必须说明任务意图；若版本号出现两个不同任务意图，先修任务锁，不继续写代码。当前任务上下文交接来自外部执行指令或开发日志包，代码包不保存每轮具体任务上下文，代码包只保存执行端上下文治理约束。

## v0.0.2.24 测试索引

- `tests/project-map-contracts.test.mjs`
- `tests/context-governance-contracts.test.mjs`
- `tests/quality-gate-contracts.test.mjs`
- `tests/quality-affected-policy-hardening.test.mjs`
- `tests/version-surface-contracts.test.mjs`
- `tests/package-hygiene.test.mjs`

## 既有架构边界索引

不跳过 ActionPipeline，不直接改 SaveFile，不接真实 `cc / wx / fs`。`architecture-boundary.rules.json`、`architecture-boundary-check.mjs`、`quality:architecture-boundary` 与 `loadArchitectureBoundaryRules` 继续有效；旧 validator 仍保留权威红线。

release zip 仍检查 UTF-8 metadata 与 mojibake 路径，并排除 `reports/quality`、`.cache/quality`、日志包、node_modules、coverage、dist。

## 检查命令别名索引

- `q:affected`
- `q:full`
- `q:release`
- `test:project-map-contracts`
- `context-doc-surface.rules.json`
- `project-target.json`

## 遗留 module_contracts 说明

`docs/module_contracts/` 保留为上下文治理契约，不是新版 module-card 主入口。新版导航见 `docs/module-cards/`。
