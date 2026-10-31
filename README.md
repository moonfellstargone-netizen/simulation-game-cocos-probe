# 模拟游戏 Cocos 微信试水代码项目 v0.0.2.32

**Cocos Web Viewport & Input Reliability / Cocos网页视口与输入可靠性版**

本仓库是 Cocos 微信试水代码项目**日常代码权威源**。正式玩法与契约权威仍为正式三包 v1.5.2.2。

- 代码包版本：`v0.0.2.32`
- npm package version：`0.0.2-32`
- release 根目录：`模拟游戏_Cocos微信试水代码包_v0_0_2_32`（权威源：`tools/quality/rules/project-target.json`）
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

本轮唯一目标是让现有Cocos Web时间探针在约定桌面窗口和运行中resize后，显示区域与真实按钮命中保持一致，每次有效点击只提交一次既有advance_time并推进60分钟。先定位页面容器、画布与引擎输入关系，再修源模板或正式构建入口；不手改仓库外生成页面。

工具只读取仓库唯一src/design_snapshot派生的工作副本。prepare继续导出snapshot及全部58项Schema并记录Git来源/输入产物摘要；build记录实际Web产物清单摘要，verify核对构建关联和产物字节后才启动浏览器，拒绝替换或篡改的Web目录。工程、依赖、报告、缓存和构建仍位于仓库外，不形成第二源码权威。

保留准备/生命周期full/blocker回归，新增test:cocos-web-verification-contracts / registry test.cocos-web-verification-contracts验证浏览器工具的参数、来源、HTTP服务和断言失败保护；Node契约不执行真实浏览器。独立cocos:verify:web运行固定Creator构建产物的真实Chrome鼠标点击，记录Button事件、时间变化、Label同步与清理证据；根typecheck只覆盖src，不能代替实际Creator类型、构建或浏览器验收。

不进入 Stage 1B，不改变 ActionPipeline，不改变 SaveFile，不改变正式 fixture，不新增玩法、真实存储、wx、AOT或通用UI框架。旧game-core、cocos-app、cocos-creator-adapter仍不接真实 Cocos、不接 wx或fs；只有既有cocos-engine-probe外层使用cc。

构建网页矩阵含800×600、DPR2及四次resize点击；编辑器预览只承诺1440×1200和960×640/DPR1及960→1440→960三次resize点击，官方Default设备模拟器800裁剪场景未支持。具体范围见外层契约，不推导手机或微信适配。

导航与追踪：trace.cocos.web-viewport-input及既有trace.cocos.web-bootstrap-probe。实际失败先定位，不通过降低架构检查、跳过门禁或调用observer.advance代替物理点击制造通过。

执行方使用Cursor时必须先做预检报告，用户或GPT确认后才可修改文件。复杂任务须先做Scope Discovery。

## q:affected 与 release 边界

`q:affected` 用于开发反馈，**不替代** `q:full`、`q:release`、`release:build` 或 `release:check`。release gate 禁止 cache。

详见 [`docs/CHECK_ARCHITECTURE.md`](docs/CHECK_ARCHITECTURE.md) 与 [`docs/GITHUB_WORKFLOW.md`](docs/GITHUB_WORKFLOW.md)。

## 常用命令

- `npm run cocos:prepare -- --output <仓库外空目录>`
- `npm run cocos:build -- --creator <Creator绝对路径> --project <派生工程绝对路径> --log-dir <仓库外日志目录>`
- `npm run cocos:verify:web -- --project <工程绝对路径> --browser <浏览器绝对路径> --report-dir <仓库外报告目录> --build-record <构建result.json绝对路径>`
- `npm run test:cocos-web-verification-contracts`
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
