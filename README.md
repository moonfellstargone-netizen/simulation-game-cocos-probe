# 模拟游戏 Cocos 微信试水代码项目 v0.0.2.30

**Async Scene Binding Ordering & Recovery / 场景绑定异步顺序与失败恢复版**

本仓库是 Cocos 微信试水代码项目**日常代码权威源**。正式玩法与契约权威仍为正式三包 v1.5.2.2。

- 代码包版本：`v0.0.2.30`
- npm package version：`0.0.2-30`
- release 根目录：`模拟游戏_Cocos微信试水代码包_v0_0_2_30`（权威源：`tools/quality/rules/project-target.json`）
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

本轮唯一目标是场景绑定异步顺序与失败恢复：同一绑定实例中的命令、界面应用及初始渲染按调用顺序完成，卸载完成后不被先前调用的旧更新覆盖。绑定端口拒绝时保留原Promise失败，后续调用仍可继续，并重新同步当前视图；恢复不重放正式Action、不回滚已提交业务。

由`trace.cocos.binding-async-recovery`连接场景控制器、两个既有full/blocker绑定任务和边界契约。受控端口用手动信号验证延迟、拒绝、恢复及卸载交错，检查实际节点内容。测试登记补齐两项任务对tests模块及共享辅助的覆盖，不改变affected算法。

既有公共启动入口与`trace.runtime.bootstrap-resources`、存储故障回归、PR自动完整检查和报告保留继续有效。顺序保证只适用于同一绑定实例管理的调用，不覆盖多个controller或外部直接调用Host；不撤回端口已产生的部分副作用。Node验收不证明真实Cocos兼容。

本轮明确不进入 Stage 1B，不接真实 Cocos，不接 wx storage，不新增玩法，不新增 formal action，不修改 ActionPipeline，不修改 SaveFile，不修改正式 fixture，不做 Nightly 实装，不做完整 AST/symbol 自动索引。

执行方使用 Cursor 时**必须先做预检报告**，用户或 GPT 确认后才可修改文件。复杂任务须先做 Scope Discovery。

## q:affected 与 release 边界

`q:affected` 用于开发反馈，**不替代** `q:full`、`q:release`、`release:build` 或 `release:check`。release gate 禁止 cache。

详见 [`docs/CHECK_ARCHITECTURE.md`](docs/CHECK_ARCHITECTURE.md) 与 [`docs/GITHUB_WORKFLOW.md`](docs/GITHUB_WORKFLOW.md)。

## 常用命令

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

模块导航主入口为[creator模块卡](docs/module-cards/cocos-creator-adapter.md)。

[装配边界契约](docs/module_contracts/Stage1ABootstrap.contract.md)保留为资源输入、失败保护及生命周期的边界说明，不替代模块卡导航。

`game-core 独立于 Cocos / wx / 表现层` 仍是核心红线。`cocos-creator-adapter` 当前仍是纯 TypeScript、engine-neutral 探针，不接真实 Cocos、不接 wx。

`docs/module_contracts/` 为遗留上下文治理契约，**保留**；新版项目地图主入口为 `docs/module-cards/`。

后续建议不是授权目标。
