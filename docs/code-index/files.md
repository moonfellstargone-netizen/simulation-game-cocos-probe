# Code Index — Files — v0.0.2.34

| 路径 | 所属模块 | 用途 | 什么时候读 | 相关测试/命令 |
|---|---|---|---|---|
| `README.md` | docs | 仓库入口、Task Intent Lock | 每轮开始 | `quality:contextDocSurface` |
| `package.json` | config | 版本与 scripts | 每轮开始 | `quality:version` |
| `docs/CODE_CONTEXT_INDEX.md` | docs | 必读顺序、预检要求 | 执行前 | `test:context-governance` |
| `docs/CHECK_ARCHITECTURE.md` | docs | 门禁与 affected 边界 | 改 quality/docs | `q:full` |
| `docs/ARCHITECTURE.md` | docs | 业务架构红线 | 改 game-core | `arch:check` |
| `docs/IMPLEMENTATION_SCOPE.md` | docs | 当前版本范围 | 每轮开始 | `test:context-governance` |
| `docs/GITHUB_WORKFLOW.md` | docs | GitHub 工作流 | 分支/PR 前 | `test:project-map-contracts` |
| `docs/PROJECT_MAP.md` | docs | L0–L5 地图导航 | 跨模块任务 | `test:project-map-contracts` |
| `docs/TRACEABILITY_MATRIX.md` | docs | 轻量可追踪矩阵（人工） | 跨链路追踪 | `test:traceability-contracts` |
| `docs/DOCS_GOVERNANCE.md` | docs | 文档治理 | 新增/改 docs | `test:project-map-contracts` |
| `docs/GLOSSARY.md` | docs | 术语 | 权威混淆时 | `test:project-map-contracts` |
| `docs/maps/` | docs | 领域地图 | 领域改动 | `test:project-map-contracts` |
| `docs/module-cards/` | docs | 模块卡（新导航层） | 模块改动 | `test:project-map-contracts` |
| `docs/module_contracts/` | docs | 遗留模块契约（保留） | 读 Cocos 边界 | `test:context-governance` |
| `docs/code-index/` | docs | 代码索引 | 找入口 | `test:project-map-contracts` |
| `tools/quality/rules/project-target.json` | quality-tools | 版本权威 | 版本 bump | `quality:version` |
| `tools/quality/rules/traceability-map.json` | quality-tools | 机器可读追踪矩阵 | 追踪登记 | `test:traceability-contracts` |
| `tools/quality/quality.config.json` | quality-tools | 质量配置（含 traceabilityMap） | 改 rules | `quality:config` |
| `tools/quality/lib/projectTarget.mjs` | quality-tools | project-target 读取 | 版本 bump | `test:version-surface-contracts` |
| `tools/quality/lib/versionSurface.mjs` | quality-tools | version/BuildId 派生 | 版本 bump | `test:version-surface-contracts` |
| `tools/quality/module-graph.json` | quality-tools | 模块图 | affected/arch | `arch:check` |
| `tools/quality/test-registry.json` | quality-tools | 测试登记 | 新测试 | `quality:test-registry` |
| `tools/quality/gate-policy.json` | quality-tools | 门禁策略 | 改 gate | `test:quality-gate-contracts` |
| `.github/workflows/quality.yml` | tools | PR 完整检查与报告保留 | 改 CI 触发/权限/执行步骤 | `test:ci-workflow-contracts` |
| `tests/ci-workflow-contracts.test.mjs` | tests | PR CI YAML 语义与负向约束 | 改工作流 | `test:ci-workflow-contracts` |
| `src/game-core/**` | game-core | 核心逻辑 | 玩法/状态 | `test:stage1a-baseline` |
| `src/cocos-app/**` | cocos-app | 应用适配 | Session/UI VM | `test:cocos-session` |
| `src/cocos-creator-adapter/**` | cocos-creator-adapter | Creator 探针 | UI binding | `test:cocos-ui-readiness` |
| `src/cocos-creator-adapter/scene/CocosSceneBindingController.ts` | cocos-creator-adapter | 实例内命令与端口完整顺序、失败后全量重同步 | 改异步绑定、初始渲染或恢复 | `test:cocos-scene-binding`、`test:cocos-component-node-binding` |
| `src/cocos-creator-adapter/component/QinglanUiSceneProbeComponent.ts` | cocos-creator-adapter | 公开mount/execute/refresh/初始渲染/unmount复用场景控制器 | 改组件生命周期及绑定交错 | `test:cocos-component-node-binding` |
| `tests/cocos-scene-binding-application.test.ts`、`tests/cocos-component-node-binding-application.test.ts` | tests | 手动延迟/拒绝、实际端口状态、恢复与卸载顺序回归 | 改场景/节点异步应用 | 两项现有full/blocker绑定任务 |
| `tests/support/controlledBindingPort.ts` | tests | 手动gate与实际绑定记录辅助，非运行时依赖 | 改绑定故障时序；单独变更也应选中绑定任务 | `test:cocos-scene-binding`、`test:cocos-component-node-binding` |
| `src/cocos-creator-adapter/bootstrap/Stage1ABootstrap.ts` | cocos-creator-adapter | 外部正式资源装配已创建Session的Host，失败不发布可用宿主 | 改资源输入、就绪或启动边界 | `test:stage1a-bootstrap` |
| `src/game-core/validation/RuntimeSchemaValidator.ts` | game-core | Schema校验及assertSchemasAvailable引用闭包就绪检查 | 改编译与Schema可用性 | `test:stage1a-bootstrap`、`test:cocos-session` |
| `src/game-core/validation/RuntimeContractValidator.ts` | game-core | 既有契约断言与集中Schema映射的assertReady | 改必要操作契约就绪 | `test:stage1a-bootstrap`、`test:contract` |
| `tests/stage1a-bootstrap.test.ts` | tests | 正式资源经公共入口的独立启动/失败/动作/存读档/生命周期验收 | 改装配与资源契约；不借用runtimeHarness构造 | `test:stage1a-bootstrap` / registry `test.stage1a-bootstrap` |
| `docs/module_contracts/Stage1ABootstrap.contract.md` | docs | 装配输入、失败保护和已ready宿主生命周期 | 以creator模块卡为主入口后补读边界契约 | `test:context-governance`、`test:stage1a-bootstrap` |
| `tools/quality/**` | quality-tools | 质量工具 | 门禁改动 | `q:full` |
| `tools/build_release_package.py` | release-tools | 打包 | release | `release:build` |
| `tools/check_release_zip.py` | release-tools | zip 复验 | release | `release:check` |
| `tests/traceability-contracts.test.mjs` | tests | traceability 契约 | 改 map/docs | `test:traceability-contracts` |
| `tests/cocos-runtime-session.test.ts` | tests | Session / ViewModel / SaveStoragePort / ActionPipeline 边界（registry `test.cocos-session`） | 改 Cocos app Session 边界 | `test:cocos-session` |
| `tests/cocos-save-load-ui-binding.test.ts` | tests | 存储拒绝时 UI 错误、旧成功清除及恢复（registry `test.cocos-save-load`） | 改 save/load UI 边界 | `test:cocos-save-load` |
| `tests/cocos-ui-command-queue.test.ts` | tests | 受控延迟拒绝、串行顺序和健康命令继续（registry `test.cocos-command-queue`） | 改命令队列和恢复边界 | `test:cocos-ui-command-queue` |
| `tests/support/controlledSaveStoragePort.ts` | tests | ControlledSaveStoragePort / PendingStorageOperation / captureSerializedSession，故障时序与完整状态捕获辅助 | 读写故障用例；不作为平台或玩法权威 | 上述三个存储故障任务，`trace.save.storage-failure-recovery` |
| `docs/adr/ADR-0003-load-failure-must-not-mutate-current-session.md` | docs | 失败不污染 session，区分调用方保护与底层写入保证 | 改存读档故障边界 | `test:context-governance`、上述三个存储故障任务 |
| `tests/**` | tests | 契约与回归 | 改代码/文档 | `q:full` |

## Cocos Web探针

| 文件 | 模块 | 职责 | 何时读 | 验证 |
|---|---|---|---|---|
| `apps/cocos-probe/` | cocos-engine-probe | 真实Creator Web外层源模板 | 改资源加载、节点或外层生命周期 | `test:cocos-engine-probe-lifecycle`、真实Creator构建 |
| `tools/cocos-probe/prepare.mjs` | tools | 唯一来源派生仓库外工程及摘要 | 改准备/资源输入/产物 | `test:cocos-probe-preparation` |
| `tools/cocos-probe/build.mjs` | tools | 显式Creator的独立Web构建 | 真实引擎验收 | `cocos:build` |
| `tests/cocos-probe-preparation.test.mjs` | tests | 实际prepare、坏资源、来源及bundle验证 | 改工具或模板 | `test:cocos-probe-preparation` |
| `tests/cocos-engine-probe-lifecycle.test.ts` | tests | 加载中销毁与公开宿主生命周期 | 改新outer | `test:cocos-engine-probe-lifecycle` |
| `apps/cocos-probe/template/assets/scripts/CocosWebProbe.ts` | cocos-engine-probe | 真实cc组件、资源加载、Label/Button端口 | 改引擎节点和按钮动作 | 真实Creator类型检查、Web构建与浏览器冒烟 |
| `apps/cocos-probe/template/assets/scripts/ProbeLifetime.ts` | cocos-engine-probe | 无cc依赖的加载、挂载和销毁代际保护 | 改加载与宿主生命周期 | `test:cocos-engine-probe-lifecycle` |

## Web视口与输入

| 文件 | 模块 | 职责 | 何时读 | 验证 |
|---|---|---|---|---|
| `apps/cocos-probe/template/build-templates/web-desktop/index.ejs` | cocos-engine-probe | 官方Web构建模板及cocosTemplate注入 | 改视口或真实浏览器验收 | `test:cocos-web-verification-contracts`、真实`cocos:verify:web` |
| `apps/cocos-probe/template/build-templates/web-desktop/probe-viewport.css` | cocos-engine-probe | 可见桌面视口与无溢出的页面容器 | 改视口或真实浏览器验收 | `test:cocos-web-verification-contracts`、真实`cocos:verify:web` |
| `apps/cocos-probe/template/build-templates/web-desktop/probe-viewport.js` | cocos-engine-probe | 同步像素尺寸及窗口resize | 改视口或真实浏览器验收 | `test:cocos-web-verification-contracts`、真实`cocos:verify:web` |
| `tools/cocos-probe/verify-web.mjs` | tools | 真实Chrome鼠标/窗口矩阵验收CLI | 改视口或真实浏览器验收 | `test:cocos-web-verification-contracts`、真实`cocos:verify:web` |
| `tools/cocos-probe/lib/webProbeSupport.mjs` | tools | 参数、HTTP、来源及Web产物摘要共享辅助 | 改视口或真实浏览器验收 | `test:cocos-web-verification-contracts`、真实`cocos:verify:web` |
| `tests/cocos-web-verification-contracts.test.mjs` | tests | Node工具边界、HTTP、来源与失败契约 | 改视口或真实浏览器验收 | `test:cocos-web-verification-contracts`、真实`cocos:verify:web` |

Node契约只验证工具边界，真实输入与引擎表现另由Creator/Chrome独立验收；trace.cocos.web-viewport-input连接两者，不互相冒充。

## 浏览器本地存档与刷新恢复

trace.cocos.browser-local-save连接外层BrowserSaveStoragePort.ts、CocosWebProbe.ts、ProbeInteraction.ts及浏览器/固定来源工具；保留trace.cocos.web-save-load-recovery对既有Queue命令结果归属的追踪。真实三按钮AdvanceOneHour、SaveLocal、LoadLocal使用固定单槽web_probe和稳定项目key，启动不读写存储；同origin/profile刷新先创建新局，手动读取恢复保存状态。getter/读写拒绝和坏档保持当前会话，不回退内存。tests/cocos-browser-storage.test.ts与既有生命周期/交互回归由test.cocos-engine-probe-lifecycle实际执行，tests/cocos-web-serve-contracts.test.mjs由test.cocos-web-verification-contracts执行；files/covers、单文件affected及full/blocker闭合。ProbeInteraction保留本次反馈、busy和销毁后迟到保护；真实Creator/Chrome物理点击、刷新及同context新页面手动恢复独立验收，根typecheck只覆盖src，Node通过不能替代引擎或持久化证据。

## 浏览器本地存档与固定来源入口

| 文件 | 模块 | 职责 | 验证 |
|---|---|---|---|
| `apps/cocos-probe/template/assets/scripts/BrowserSaveStoragePort.ts` | cocos-engine-probe | 惰性Storage、稳定key、固定web_probe原始字符串端口 | `test:cocos-engine-probe-lifecycle`及真实Chrome |
| `tests/cocos-browser-storage.test.ts` | tests | Port故障、状态保护、健康恢复与启动无存储副作用 | 既有生命周期full/blocker任务实际执行 |
| `tools/cocos-probe/serve.mjs` | tools | 严格构建来源及显式固定端口启动 | `test:cocos-web-verification-contracts` |
| `tests/cocos-web-serve-contracts.test.mjs` | tests | 固定端口、来源与服务关闭契约 | 既有web-verification full/blocker任务实际执行 |
