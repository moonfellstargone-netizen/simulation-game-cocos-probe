# 模拟游戏 Cocos 微信试水代码项目 v0.0.2.23

**Project Map & Git Workflow Readiness / 项目分级地图与 Git 工作流准备版**

本仓库是 Cocos 微信试水代码项目**日常代码权威源**。正式玩法与契约权威仍为正式三包 v1.5.2.2。

- 代码包版本：`v0.0.2.23`
- npm package version：`0.0.2-23`
- release 根目录：`模拟游戏_Cocos微信试水代码包_v0_0_2_23`
- 设计来源：`模拟游戏_正式开发总设定包_v1_5_2_2_practical_ready.zip`
- 规则权威源：`tools/quality/rules/project-target.json`、`tools/quality/rules/context-doc-surface.rules.json`、`tools/quality/rules/architecture-boundary.rules.json`
- 代码权威：本 GitHub 仓库（非 zip 归档包）

## 入口文档

- [`docs/GITHUB_WORKFLOW.md`](docs/GITHUB_WORKFLOW.md)
- [`docs/PROJECT_MAP.md`](docs/PROJECT_MAP.md)
- [`docs/DOCS_GOVERNANCE.md`](docs/DOCS_GOVERNANCE.md)
- [`docs/GLOSSARY.md`](docs/GLOSSARY.md)
- [`docs/CODE_CONTEXT_INDEX.md`](docs/CODE_CONTEXT_INDEX.md)

## Task Intent Lock

本轮唯一目标是建立 GitHub 工作流、项目分级地图、文档治理与 `project-map-contracts` 契约测试。

本轮明确不进入 Stage 1B，不接真实 Cocos，不接 wx storage，不创建真实 Cocos Component/Scene/Prefab，不新增玩法，不新增 formal action，不修改 ActionPipeline，不修改 SaveFile，不修改正式 fixture。

执行方使用 Cursor 时**必须先做预检报告**，用户或 GPT 确认后才可修改文件。复杂任务须先做 Scope Discovery。

## q:affected 与 release 边界

`q:affected` 用于开发反馈，**不替代** `q:full`、`q:release`、`release:build` 或 `release:check`。release gate 禁止 cache。

详见 [`docs/CHECK_ARCHITECTURE.md`](docs/CHECK_ARCHITECTURE.md) 与 [`docs/GITHUB_WORKFLOW.md`](docs/GITHUB_WORKFLOW.md)。

## 常用命令

- `npm run test:project-map-contracts`
- `npm run q:affected -- --changed-files docs/PROJECT_MAP.md`
- `npm run q:full`
- `npm run q:release`
- `npm run arch:check`
- `npm run release:build`
- `npm run release:check`

## 架构边界

`game-core 独立于 Cocos / wx / 表现层` 仍是核心红线。`cocos-creator-adapter` 当前仍是纯 TypeScript、engine-neutral 探针，不接真实 Cocos、不接 wx。

`docs/module_contracts/` 为遗留上下文治理契约，**保留**；新版项目地图主入口为 `docs/module-cards/`。

后续建议不是授权目标。
