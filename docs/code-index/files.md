# Code Index — Files — v0.0.3.0

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

trace.cocos.browser-local-save连接外层BrowserSaveStoragePort.ts、CocosWebProbe.ts、ProbeInteraction.ts及浏览器/固定来源工具；保留trace.cocos.web-save-load-recovery对既有Queue命令结果归属的追踪。既有三按钮AdvanceOneHour、SaveLocal、LoadLocal使用固定单槽web_probe和稳定项目key，启动不读写存储；同origin/profile刷新先创建新局，手动读取恢复保存状态。getter/读写拒绝和坏档保持当前会话，不回退内存。tests/cocos-browser-storage.test.ts与既有生命周期/交互回归由test.cocos-engine-probe-lifecycle实际执行，tests/cocos-web-serve-contracts.test.mjs由test.cocos-web-verification-contracts执行；files/covers、单文件affected及full/blocker闭合。ProbeInteraction保留本次反馈、busy和销毁后迟到保护；真实Creator/Chrome物理点击、刷新及同context新页面手动恢复独立验收，根typecheck只覆盖src，Node通过不能替代引擎或持久化证据。

## 浏览器本地存档与固定来源入口

| 文件 | 模块 | 职责 | 验证 |
|---|---|---|---|
| `apps/cocos-probe/template/assets/scripts/BrowserSaveStoragePort.ts` | cocos-engine-probe | 惰性Storage、稳定key、固定web_probe原始字符串端口 | `test:cocos-engine-probe-lifecycle`及真实Chrome |
| `tests/cocos-browser-storage.test.ts` | tests | Port故障、状态保护、健康恢复与启动无存储副作用 | 既有生命周期full/blocker任务实际执行 |
| `tools/cocos-probe/serve.mjs` | tools | 严格构建来源及显式固定端口启动 | `test:cocos-web-verification-contracts` |
| `tests/cocos-web-serve-contracts.test.mjs` | tests | 固定端口、来源与服务关闭契约 | 既有web-verification full/blocker任务实际执行 |

## 网页种植收获与操作反馈

| 文件 | 模块 | 职责 | 验证 |
|---|---|---|---|
| apps/cocos-probe/template/assets/scripts/ProbeFarming.ts | cocos-engine-probe | 公开选项副本、当前选择、播种数量及命令草稿 | test:cocos-engine-probe-lifecycle及真实点击 |
| apps/cocos-probe/template/assets/scripts/ProbeFarming.ts.meta | cocos-engine-probe | Creator脚本资源身份 | test:cocos-probe-preparation及实际Creator |
| tests/cocos-web-farming.test.ts | tests | 真实公开Host/Component农事行为与读档选择重建 | 既有生命周期full/blocker实际执行 |
| apps/cocos-probe/template/assets/scripts/ProbeInteraction.ts | cocos-engine-probe | 本次menu业务结果判定、单次受理与迟到保护 | 交互回归及真实Chrome |

trace.cocos.web-farming-loop连接上述路径与既有prepare/verify；Node登记与真实960×640农事闭环分开验收。

## 网页库存与储存转移

| 文件 | 模块 | 职责 | 验证 |
|---|---|---|---|
| `src/cocos-creator-adapter/menu/MenuActionBinding.ts` | cocos-creator-adapter | 当前公开MaterialLot/储存目标到正式store_item既有草稿的最小适配 | `test:cocos-menu`、单文件affected |
| `apps/cocos-probe/template/assets/scripts/ProbeInventory.ts`及`.meta` | cocos-engine-probe | 公开材料/储存目标副本、批次/目标选择和整批转移草稿 | `test:cocos-engine-probe-lifecycle`、真实Creator/Chrome |
| `tests/cocos-web-inventory.test.ts` | tests | 公开组件库存转移、拒绝后恢复、读档选择与数量/位置保护 | 既有生命周期full/blocker实际参数 |

trace.cocos.web-inventory-storage连接上述链路和verify-web/webProbeSupport；旧农事与存读档追踪保持。

## 加工必需输入与失败保护

- `src/game-core/processing/ProcessingSystem.ts`：按当前配置验证必需输入完整性，消耗和任务分配前拒绝缺料。
- `src/game-core/processing/ProcessingConfigResolver.ts`：现有方法与输入要求解析；不另建材料/阈值权威。
- `tests/stage1a-contract.test.ts`、`tests/action-preview-boundary.test.ts`、`tests/cocos-runtime-session.test.ts`、`tests/cocos-minimal-menu-binding.test.ts`：领域、预览、公开组件和存读档恢复回归。
- `tests/quality-affected-contracts.test.mjs`：实际触及测试单文件选择自身执行任务；本版不扩为全仓登记治理。
- `trace.processing.required-inputs`连接上述链路和processing模块卡。

## 共用ID恢复

- src/game-core/id/IdService.ts：observeExisting恢复可见ID高水位，next确定性递增。
- src/game-core/runtime/GameRuntime.ts：所有正式handler执行前同步完整GameState，不改变ActionPipeline。
- tests/stage1a-contract.test.ts、tests/action-preview-boundary.test.ts、tests/cocos-runtime-session.test.ts：直接核心/预览及公开Session跨实例恢复。
- trace.runtime.id-recovery连接实现、公共路径及相关模块卡。

## 拆分数量与定义占用

- src/game-core/inventory/InventorySystem.ts：split_lot数量/定义校验、归零源移除及两侧占用重建；consume算法保持。
- src/game-core/runtime/GameRuntime.ts、src/game-core/farming/FarmingSystem.ts、src/game-core/processing/ProcessingSystem.ts、src/game-core/cooking/CookingSystem.ts：ConfigRepository构造依赖传播，其他业务保持。
- tests/stage1a-contract.test.ts、tests/action-preview-boundary.test.ts、tests/cocos-runtime-session.test.ts、tests/cocos-minimal-menu-binding.test.ts：现有四任务的拆分校验/回滚/恢复。
- trace.inventory.split-quantity连接实现、公开路径和地图，不替代正式契约。

| `tests/cocos-web-split.test.ts` | tests | 公开outer拆分、预览/失败保护/跨会话恢复 | 改数量输入或本次预览 | `test:cocos-engine-probe-lifecycle` |

## 网页加工开工与领取

- `src/cocos-app/view-models/CocosSelectableViewModel.ts`：最小方法要求/兼容设施与完整任务只读投影；`tests/cocos-ui-readiness.test.ts`验证配置、候选刷新、深层隔离与跨会话状态。
- `apps/cocos-probe/template/assets/scripts/ProbeProcessing.ts`、`.meta`：无cc的逐要求选料/数量、设施与任务本地状态和本次结果；登记准备/生命周期files。
- `tests/cocos-web-processing.test.ts`：公开Host/Component的缺料/合法加工与任务/恢复行为，进入既有生命周期实际args/files/covers。
- `ProbeLifetime.ts`、`ProbeInteraction.ts`、`CocosWebProbe.ts`消费既有正式加工命令；`verify-web.mjs`、`lib/webProbeSupport.mjs`及工具契约连接独立真实输入。导航trace.cocos.web-processing-loop，原所有能力与门禁保持。

## 网页烹饪选料与菜品反馈

- `src/cocos-app/view-models/CocosSelectableViewModel.ts`：最小配方/结构合并约束、操作硬边界/偏好与当前燃料只读投影；`tests/cocos-ui-readiness.test.ts`核来源、匹配及副本隔离。
- `apps/cocos-probe/template/assets/scripts/ProbeCooking.ts`、`.meta`：无cc的逐角色批次/数量、显式操作参数、储存及本次真实DishLot反馈，登记准备/生命周期files。
- `tests/cocos-web-cooking.test.ts`：公开Host/Component烹饪、预览/失败保护/健康恢复及跨新会话手动读取，进入既有生命周期实际args/files/covers。
- `ProbeLifetime.ts`、`ProbeInteraction.ts`、`CocosWebProbe.ts`消费已有cook_dish；`verify-web.mjs`、`lib/webProbeSupport.mjs`与工具契约连接独立真实输入。导航trace.cocos.web-cooking-loop，旧全部门禁保持。

## 订单合法状态与截止保护

- `src/game-core/demand/DemandResolver.ts`：开放状态和deadline检查、事务内submitted及既有成功结算。
- `src/game-core/runtime/GameRuntime.ts`：已有advance_time截止settlement覆盖两开放状态→expired。
- `src/cocos-app/view-models/CocosSelectableViewModel.ts`：公开order_options.enabled/reason只读对齐。
- `tests/stage1a-contract.test.ts`、`tests/action-preview-boundary.test.ts`、`tests/cocos-runtime-session.test.ts`、`tests/cocos-ui-readiness.test.ts`：分层行为验收；`trace.orders.legal-state-deadline`连接实际full/blocker任务。

## 网页酒馆订单文件

- `apps/cocos-probe/template/assets/scripts/ProbeOrders.ts`、`.meta`：公共订单/菜品副本、显式选择、预览与本次真实结算/历史结果，登记prepare/lifecycle。
- `tests/cocos-web-orders.test.ts`：完整Node订单页面消费、失败/陈旧回执、恢复和busy/销毁，进入既有lifecycle实际args。
- `src/cocos-app/view-models/CocosSelectableViewModel.ts`：最小订单需求/截止/真实结果投影，StateVM保持。
- `tools/cocos-probe/verify-web.mjs`、`lib/webProbeSupport.mjs`：正常网页订单真实点击、超时与手动读取恢复、实际消费/奖励及观察断言负例；不提供业务注入捷径。
- 追踪`trace.cocos.web-orders-loop`；正式资源/core及原有trace.orders.legal-state-deadline保持。

## 跨步骤恢复文件

- tests/stage1a-bootstrap.test.ts：正式资源公共Host/Queue五独立保存点与读取后真实续玩，沿test.stage1a-bootstrap执行。
- tools/cocos-probe/verify-web.mjs、tools/cocos-probe/lib/webProbeSupport.mjs：独立浏览器恢复链与完整真值断言；tests/cocos-web-verification-contracts.test.mjs沿既有web-verification任务执行负例。
- trace.cocos.cross-step-recovery连接上述文件及save-load/app/creator/engine模块卡；生产来源只作继承机制导航，本版不改。

## 触摸与小屏文件

- apps/cocos-probe/template/assets/scripts/ProbeLayout.ts及.meta：无cc纯几何计划，供CocosWebProbe应用。
- tests/cocos-web-layout.test.ts：实际lifecycle执行的布局/边界与无输入副作用行为。
- CocosWebProbe.ts、probe-viewport.js/css：原生滚动/触摸呈现、resize与视觉视口同步；verify-web/support与既有verification契约记录实际输入与负例。
- trace.cocos.touch-small-screen连接上述来源、engine模块卡及真实任务登记。

## 微信M1入口

| 路径 | 所属模块 | 用途 | 相关验证 |
|---|---|---|---|
| `apps/cocos-wechat-probe/template/assets/scripts/CocosWechatProbe.ts` | cocos-wechat-probe | 真实cc最小场景与输入 | 真实Creator/官方工具 |
| `apps/cocos-wechat-probe/template/assets/scripts/WechatProbeController.ts` | cocos-wechat-probe | 只读身份、公共推进与失败保护 | test:cocos-wechat-runtime |
| `tools/cocos-probe/lib/prepareProject.mjs` | tools | 固定profile共享生产者 | 两项preparation |
| `tools/cocos-wechat-probe/prepare.mjs` | tools | 微信独立准备 | test:cocos-wechat-preparation |
| `tools/cocos-wechat-probe/build.mjs` | tools | 独立微信构建与记录 | 工具契约/真实Creator |
| `tools/cocos-wechat-probe/lib/source.mjs` | tools | 微信来源/产物摘要 | test:cocos-wechat-preparation |
| `tools/cocos-wechat-probe/lib/sourceProvenance.mjs` | tools | 真实Git/依赖/工具字节 | test:cocos-wechat-preparation |
| `tests/cocos-wechat-preparation.test.mjs` | tests | 来源、配置、身份与篡改负例 | full/blocker |
| `tests/cocos-wechat-runtime.test.ts` | tests | 正式运行/失败/身份隔离 | full/blocker |
| `tests/cocos-wechat-m3-ui.test.ts` | tests | 微信种植、库存与拆分真实outer联动 | full/blocker |
| `docs/module-cards/cocos-wechat-probe.md` | docs | 新模块入口 | 治理/追踪契约 |
| `docs/adr/ADR-0005-independent-wechat-m1-outer.md` | docs | 最小平台边界决策 | 治理/追踪契约 |

## 微信Schema预编译入口

- `src/game-core/validation/RuntimeSchemaValidator.ts`：PrecompiledSchemaValidatorSet与完整资源/ID/内容绑定，默认动态路径保持。
- `src/cocos-creator-adapter/bootstrap/Stage1ABootstrap.ts`：可选precompiledValidators转交，不增加平台依赖。
- `tools/cocos-wechat-probe/lib/precompiledSchemas.mjs`：真实Ajv standalone、安全导出映射和实际编译器依赖闭包记录。
- `tests/runtime-precompiled-schema.test.ts`：显式集合、禁用动态Function的正式启动/动作及拒绝路径，由现test.stage1a-bootstrap执行。

## 微信DTO复制入口

- `apps/cocos-wechat-probe/runtime/WechatDataClone.ts`：bundle局部标准自由标识符适配，属于cocos-wechat-probe。
- `tests/cocos-wechat-data-clone.test.ts`：DTO原生对比、别名/循环/空位/特殊键与不支持输入拒绝，由原test.cocos-wechat-runtime实际执行。

## 微信M2存储入口

- `apps/cocos-wechat-probe/template/assets/scripts/WechatSaveStoragePort.ts`及同名meta：微信outer的单槽字符串存储、备份及恢复保护。
- `apps/cocos-wechat-probe/template/assets/scripts/WechatPriorSaveValidator.ts`及同名meta：隔离Host校验旧档与备份，避免改变玩家会话。
- `tests/cocos-wechat-storage.test.ts`：存储适配和故障保护契约，由test.cocos-wechat-runtime执行。
- `tests/cocos-wechat-schema-optimization.test.mjs`：58项Schema的受控校验结果及完整错误对比和来源参数拒绝契约，由test.cocos-wechat-runtime执行。


拆分独立校验路径：`src/game-core/inventory/InventorySystem.ts`（正式只读校验与拆分计划）、`src/game-core/storage/StorageReconciler.ts`（共享占用计算及写回）、`src/cocos-app/runtime/CocosAppRuntimeSession.ts`（当前会话只读校验）、`src/cocos-creator-adapter/menu/MinimalMenuInteractionController.ts`及`src/cocos-creator-adapter/shell/CocosUiCommandQueue.ts`（仅拆分的独立确认）。覆盖分别登记于原stage1a-contract、cocos-session、cocos-ui-command-queue及cocos-scene-binding-application任务。
