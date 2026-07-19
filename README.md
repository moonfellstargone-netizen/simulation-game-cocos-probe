# 模拟游戏 Cocos 微信试水代码项目 v0.0.2.27

**Pull Request CI Quality Gate Baseline / PR 远端质量门禁基线版**

本仓库是 Cocos 微信试水代码项目**日常代码权威源**。正式玩法与契约权威仍为正式三包 v1.5.2.2。

- 代码包版本：`v0.0.2.27`
- npm package version：`0.0.2-27`
- release 根目录：`模拟游戏_Cocos微信试水代码包_v0_0_2_27`（权威源：`tools/quality/rules/project-target.json`）
- 设计来源：`模拟游戏_正式开发总设定包_v1_5_2_2_practical_ready.zip`
- 规则权威源：`tools/quality/rules/project-target.json`、`tools/quality/rules/context-doc-surface.rules.json`、`tools/quality/rules/architecture-boundary.rules.json`、`tools/quality/rules/traceability-map.json`
- 代码权威：本 GitHub 仓库（非 zip 归档包）

## 入口文档

- [`docs/GITHUB_WORKFLOW.md`](docs/GITHUB_WORKFLOW.md)
- [`docs/PROJECT_MAP.md`](docs/PROJECT_MAP.md)
- [`docs/TRACEABILITY_MATRIX.md`](docs/TRACEABILITY_MATRIX.md)
- [`docs/DOCS_GOVERNANCE.md`](docs/DOCS_GOVERNANCE.md)
- [`docs/GLOSSARY.md`](docs/GLOSSARY.md)
- [`docs/CODE_CONTEXT_INDEX.md`](docs/CODE_CONTEXT_INDEX.md)

## Task Intent Lock

本轮唯一目标是建立 GitHub Actions 远端 PR/main 质量门禁基线：在不修改业务源码、不改变现有 full/release gate 语义、不进入 Stage 1B 的前提下，为面向 `main` 的 Pull Request 和 `main` 推送配置 `.github/workflows/quality-gate.yml`，使 GitHub 在干净的远端环境中自动执行 `npm ci` 与 `npm run q:full`，并通过轻量契约测试防止 workflow 的触发范围、Node 版本、权限边界和正式检查命令发生静默回退。

边界说明：

- 远端 workflow **只**跑 `q:full`；`q:affected` **仍只**用于本地开发反馈，**不**作为 PR 正式门禁。
- 本轮**不**配置 GitHub branch protection。
- 本轮**不**自动 release / tag / merge。
- 本轮仍仅 Stage 1A：不进入 Stage 1B，不接真实 Cocos，不接 wx。

本轮只做该目标必需的版本面传播、workflow、契约测试与文档同步。

执行方使用 Cursor 时**必须先做预检报告**，用户或 GPT 确认后才可修改文件。复杂任务须先做 Scope Discovery。

## q:affected 与 release 边界

`q:affected` 用于开发反馈，**不替代** `q:full`、`q:release`、`release:build` 或 `release:check`。release gate 禁止 cache。

详见 [`docs/CHECK_ARCHITECTURE.md`](docs/CHECK_ARCHITECTURE.md) 与 [`docs/GITHUB_WORKFLOW.md`](docs/GITHUB_WORKFLOW.md)。

## 常用命令

- `npm run test:github-actions-workflow-contracts`
- `npm run test:traceability-contracts`
- `npm run test:project-map-contracts`
- `npm run test:version-surface-contracts`
- `npm run quality:version`
- `npm run q:full`
- `npm run q:release`
- `npm run arch:check`
- `npm run release:build`
- `npm run release:check`

## 架构边界

`game-core 独立于 Cocos / wx / 表现层` 仍是核心红线。`cocos-creator-adapter` 当前仍是纯 TypeScript、engine-neutral 探针，不接真实 Cocos、不接 wx。

`docs/module_contracts/` 为遗留上下文治理契约，**保留**；新版项目地图主入口为 `docs/module-cards/`。

后续建议不是授权目标。
