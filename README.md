# 模拟游戏 Cocos 微信试水代码项目 v0.0.2.31

**Cocos Web Bootstrap Probe / Cocos网页端最小启动探针版**

本仓库是 Cocos 微信试水代码项目**日常代码权威源**。正式玩法与契约权威仍为正式三包 v1.5.2.2。

- 代码包版本：`v0.0.2.31`
- npm package version：`0.0.2-31`
- release 根目录：`模拟游戏_Cocos微信试水代码包_v0_0_2_31`（权威源：`tools/quality/rules/project-target.json`）
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

本轮唯一目标是在固定Creator3.8.8的真实Web预览与构建中，从仓库唯一正式资源经公共bootstrap建立会话，真实节点显示时间、按钮提交已有advance_time并正确卸载。资源加载失败与加载中销毁必须明确处理，不能发布迟到Host或更新失效节点。

仓库内apps/cocos-probe保存最小工程源模板及外层桥接；tools/cocos-probe/prepare.mjs从现有src/design_snapshot派生浏览器runtime与全部58个声明Schema，在仓库外生成可打开工作副本。probe-source-manifest.json记录sourceCommit、sourceDirty、输入/产物摘要及project-target派生BuildId，副本不成为第二套代码或配置权威。

旧game-core、cocos-app、cocos-creator-adapter仍不接真实 Cocos、不接 wx或fs；只有新增cocos-engine-probe外层可导入cc，并受单向公开runtime边界约束。不进入 Stage 1B，不改变 ActionPipeline，不改变 SaveFile，不改变正式 fixture，不新增玩法、微信存储、AOT或资源热更新。

Node中的准备契约和外层生命周期测试登记为full/blocker，由trace.cocos.web-bootstrap-probe追踪；它们验证实际派生产物、资源完整性、异常路径和确定性生命周期，不冒充引擎运行证据。根typecheck仍仅覆盖src。真实Creator预览与Web构建另行执行，缺引擎时明确失败或未执行，不能静默skip或使用假cc类型声称通过。既有启动、绑定恢复、存储故障回归与PR质量验证继续有效。

执行方使用 Cursor 时**必须先做预检报告**，用户或 GPT 确认后才可修改文件。复杂任务须先做 Scope Discovery。

## q:affected 与 release 边界

`q:affected` 用于开发反馈，**不替代** `q:full`、`q:release`、`release:build` 或 `release:check`。release gate 禁止 cache。

详见 [`docs/CHECK_ARCHITECTURE.md`](docs/CHECK_ARCHITECTURE.md) 与 [`docs/GITHUB_WORKFLOW.md`](docs/GITHUB_WORKFLOW.md)。

## 常用命令

- `npm run cocos:prepare -- --output <仓库外空目录>`
- `npm run cocos:build -- --creator <Creator绝对路径> --project <派生工程绝对路径> --log-dir <仓库外日志目录>`
- `npm run test:cocos-probe-preparation`
- `npm run test:cocos-engine-probe-lifecycle`

- `npm run test:cocos-scene-binding`
- `npm run test:cocos-component-node-binding`
- `npm run test:stage1a-bootstrap`
- `npm run test:cocos-session`
- `npm run test:cocos-save-load`
- `npm run test:cocos-ui-command-queue`
- `npm run typecheck`
- `npm run test:ci-workflow-contracts`
- `npm run test:traceability-contracts`
- `npm run test:project-map-contracts`
- `npm run test:version-surface-contracts`
- `npm run quality:version`
- `npm run q:full`
- `npm run q:release`
- `npm run arch:check`
- `npm run release:build`
- `npm run release:check`

## PR 自动质量验证

入口为 [`.github/workflows/quality.yml`](.github/workflows/quality.yml)，单个 Ubuntu 24.04 job 使用 Node 24、Python 3.12，按 `npm ci` → `npm run q:full` 执行。PR 不按路径跳过检查；也提供 `workflow_dispatch` 手动入口。质量报告 `latest.json` / `latest.md` 在成功或失败时均尝试上传，保留 7 天。

CI 使用只读仓库权限、固定官方 Action 提交，不持久化 checkout 凭据。同一 PR 的新提交取消旧运行。工作流及测试登记由 `trace.quality.pr-ci` 追踪，操作和失败定位见 [`docs/GITHUB_WORKFLOW.md`](docs/GITHUB_WORKFLOW.md)。实际 GitHub 运行结果须查看对应 PR 的 Checks / Actions；工作流文件不代表分支保护已启用，也不替代发布门禁。

## 架构边界

启动入口为`src/cocos-creator-adapter/bootstrap/Stage1ABootstrap.ts`中的`createStage1AHost`。成功返回的Host已创建Session，可交给现有UI Shell/Queue或通过requireSession使用；结束时调用destroySession，不再执行Probe.onLoad二次创建。

模块导航主入口为[creator模块卡](docs/module-cards/cocos-creator-adapter.md)，真实引擎外层见[引擎探针模块卡](docs/module-cards/cocos-engine-probe.md)。

[装配边界契约](docs/module_contracts/Stage1ABootstrap.contract.md)保留为资源输入、失败保护及生命周期的边界说明，不替代模块卡导航。

`game-core 独立于 Cocos / wx / 表现层` 仍是核心红线。`cocos-creator-adapter` 当前仍是纯 TypeScript、engine-neutral 探针，不接真实 Cocos、不接 wx。

`docs/module_contracts/` 为遗留上下文治理契约，**保留**；新版项目地图主入口为 `docs/module-cards/`。

后续建议不是授权目标。
