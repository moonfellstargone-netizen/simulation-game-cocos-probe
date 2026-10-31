# Code Index — Public API — v0.0.2.36

只记录公开入口与关键流程（非完整符号索引）。

## ActionPipeline

- 类：`ActionPipeline`（`src/game-core/action/ActionPipeline.ts`）
- 入口：`dispatch(state, request)` — 唯一正式状态变更管道
- 导出：`src/game-core/index.ts`

## Save / Load

- `SaveManager.serialize` / `deserializeSaveFile`（`src/game-core/save/SaveManager.ts`）
- `SaveStoragePort`（`src/game-core/save/SaveStoragePort.ts`）— 端口，由外层注入
  - `read(slotId): Promise<string | null>` — null 为空槽，Promise 拒绝表示读取失败
  - `write(slotId, serializedSave): Promise<void>` — 成功后 Session 才返回保存摘要；不在端口接口承诺真实存储原子回滚
- `NewGameBuilder.buildStage1A` — 新局构建

## Session / ViewModel / Port

- `CocosAppRuntimeSession`（`src/cocos-app/runtime/CocosAppRuntimeSession.ts`）
  - `dispatch(actionType, parameters)`
  - `preview(actionType, parameters)`
  - `save(slotId)` / `load(slotId)`
  - `getViewModel()` / `getSelectableViewModel()`
- `CocosActionSessionPort` — session dispatch 接口
- `CocosSessionHost`（`src/cocos-creator-adapter/CocosSessionHost.ts`）— 创建/require session

## 存储故障展示与命令恢复

- `SaveLoadInteractionController.save / load` — 清除旧成功结果、呈现现有错误，失败时保留 session；恢复后可正常重试。
- `CocosUiCommandQueue.enqueue / execute` — 串行等待当前命令，返回 completed / failed 与 snapshot；拒绝后的已排队命令继续执行。
- 契约与测试追踪：`trace.save.storage-failure-recovery`，ADR-0003与save-load模块卡；该组内存故障契约不新增业务公开API、稳定错误码或平台适配，浏览器外层适配另见trace.cocos.browser-local-save。

## Stage1A启动装配

已有启动装配与资源就绪能力继续作为公共边界。

- `Stage1ABootstrapResources`：外部已解析的`snapshot`、`schemas`、`storage`及明确的`buildId`、`nowIso8601`。
- `createStage1AHost(input): CocosSessionHost`（`src/cocos-creator-adapter/bootstrap/Stage1ABootstrap.ts`）：资源与契约就绪、新局校验成功后才返回已创建Session的Host；失败抛错，不进行存储读写或正式Action。
- 导出：bootstrap子目录及`src/cocos-creator-adapter/index.ts`。
- `RuntimeSchemaValidator.assertSchemasAvailable(ids)`：真实编译指定Schema及引用闭包。
- `RuntimeContractValidator.assertReady()`：由既有契约校验器集中维护的必需Schema映射检查操作契约就绪。
- 成功Host通过`requireSession()`或现有UI Shell/Queue使用，以`destroySession()`结束；不得再调用Probe.onLoad创建同一会话。
- 追踪：`trace.runtime.bootstrap-resources`；本地`test:stage1a-bootstrap` / registry `test.stage1a-bootstrap`。

## 场景绑定异步顺序与失败恢复

- `CocosSceneBindingController.execute(command)`：同一实例内按序完成读取快照、命令执行和端口批次。返回diff仍是Shell前后差异；失败重同步时applied_updates可全量四区。
- `CocosSceneBindingController.applyInitialSnapshot()`：经同一实例顺序全量刷新；与execute互不超车。
- `QinglanUiSceneProbeComponent.mount / refresh / execute / applyInitialSnapshot / unmount`：复用上述控制器；卸载成功后不被先前调用的旧更新覆盖。
- `CocosSceneBindingPort.applySceneBindingUpdate`与`CocosComponentNodeBindingPort.applyNodeBindingPatch`保留`void | Promise<void>`，同步抛错或异步拒绝原样可观察。后续绑定操作全量重同步当前视图，不重放或回滚正式Action。
- 顺序只覆盖同一实例管理的调用，不承诺跨controller全局锁或端口副作用回滚。追踪`trace.cocos.binding-async-recovery`，使用现有两个full/blocker绑定任务。

## Cocos Web外层与准备入口

- `prepareCocosProbe({rootDir, outputDir})` / `readProbeResources(rootDir)`（`tools/cocos-probe/prepare.mjs`）：校验正式资源并生成仓库外工程与probe-source-manifest.json，拒绝危险/非空输出，不建立第二源码权威。
- `cocos:prepare -- --output <绝对空目录>`；派生bundle公开createStage1AHost、QinglanUiSceneProbeComponent、InMemorySaveStoragePort。
- `cocos:build -- --creator <exe> --project <派生工程> --log-dir <外部目录>`：真实Creator3.8.8 Web构建，独立于无引擎CI；成功码36与产物检查后才成功。
- 新outer模块单向消费上述runtime，纯生命周期桥接管理异步加载失效；真实cc组件只负责资源与节点，不直接访问核心内部。
- Node准备与生命周期契约不等于Creator编译或Web运行证明。导航见[引擎探针模块卡](../module-cards/cocos-engine-probe.md)，追踪trace.cocos.web-bootstrap-probe。

## Cocos app runtime

- `GameRuntime` + `ActionPipeline`（`src/game-core/runtime/GameRuntime.ts`）
- `CocosActionDispatcher` / `CocosRuntimeFacade` — app 层适配

## Quality gate 入口

- CLI：`npm run q:fast` / `q:affected` / `q:full` / `q:release`
- 实现：`tools/quality/run-quality-gate.mjs`（本轮不改核心逻辑）
- 配置：`tools/quality/gate-policy.json`、`tools/quality/test-registry.json`、`tools/quality/quality.config.json`

## PR CI 入口（非业务 API）

- 工作流：`.github/workflows/quality.yml`（PR 到 main，另有 workflow_dispatch）
- 执行：Ubuntu 24.04、Node 24、Python 3.12，`npm ci` → `npm run q:full`
- 契约：`npm run test:ci-workflow-contracts` / registry `test.ci-workflow-contracts`
- 报告：成功或失败均尝试保留 `reports/quality/latest.json` / `latest.md`，7 天
- 追踪：`trace.quality.pr-ci`；操作说明见 `docs/GITHUB_WORKFLOW.md`

## Traceability / 文档治理入口（非业务 API）

- 人工矩阵：`docs/TRACEABILITY_MATRIX.md`
- 机器可读 map：`tools/quality/rules/traceability-map.json`（经 `quality.config.json` → `rules.traceabilityMap`）
- 契约：`npm run test:traceability-contracts`

## Release build / check 入口

- `npm run release:build` → `tools/build_release_package.py --project-target ...`
- `npm run release:check` → `tools/check_release_zip.py --project-target ...`
- release 根名见 `tools/quality/rules/project-target.json`

## 待后续增强

- 按符号自动索引 game-core 全部 export
- Stage 1B、wx及其他目标平台（当前未进入）；真实Cocos仅当前Web最小外层。

## Web视口与输入验证工具

- `verifyWebProbe({project, browser, reportDir, buildRecord, previewUrl?})`（`tools/cocos-probe/verify-web.mjs`）：显式路径运行真实浏览器，来源和构建字节匹配后检查真实鼠标点击；独立于无引擎CI。
- `cocos:verify:web -- --project <ABS> --browser <ABS> --report-dir <ABS> --build-record <ABS>`；可选`--preview-url <loopback HTTP URL>`，预览结果单独标记，不证明livepreview内容hash；其矩阵仅1440×1200/960×640与960→1440→960 resize，800及DPR2属于built-web范围。
- `tools/cocos-probe/lib/webProbeSupport.mjs`共享参数/HTTP/来源和`webTreeDigest`；build.mjs的Web产物清单与verify复算必须一致，篡改拒绝。
- `test:cocos-web-verification-contracts`是Node工具契约，不执行真实浏览器；`trace.cocos.web-viewport-input`追踪执行输入与独立验收边界。

## 浏览器本地存档与刷新恢复

trace.cocos.browser-local-save连接外层BrowserSaveStoragePort.ts、CocosWebProbe.ts、ProbeInteraction.ts及浏览器/固定来源工具；保留trace.cocos.web-save-load-recovery对既有Queue命令结果归属的追踪。既有三按钮AdvanceOneHour、SaveLocal、LoadLocal使用固定单槽web_probe和稳定项目key，启动不读写存储；同origin/profile刷新先创建新局，手动读取恢复保存状态。getter/读写拒绝和坏档保持当前会话，不回退内存。tests/cocos-browser-storage.test.ts与既有生命周期/交互回归由test.cocos-engine-probe-lifecycle实际执行，tests/cocos-web-serve-contracts.test.mjs由test.cocos-web-verification-contracts执行；files/covers、单文件affected及full/blocker闭合。ProbeInteraction保留本次反馈、busy和销毁后迟到保护；真实Creator/Chrome物理点击、刷新及同context新页面手动恢复独立验收，根typecheck只覆盖src，Node通过不能替代引擎或持久化证据。

## 浏览器本地存储外层

- `BrowserSaveStoragePort`（`apps/cocos-probe/template/assets/scripts/BrowserSaveStoragePort.ts`）在outer实现既有Port的read/write，仅操作固定槽web_probe和稳定项目key；惰性Storage getter、原始字符串透传、失败不回退内存。它不是game-core的新公开API。
- 构造可接收`() => BrowserStorage`，默认在操作时取globalThis.localStorage；BrowserStorage只要求getItem/setItem。导出BROWSER_SAVE_SLOT_ID和BROWSER_SAVE_STORAGE_KEY供同一外层使用；只读写固定槽，其他slot拒绝，不提供delete或解析/迁移接口。
- `tools/cocos-probe/serve.mjs`是固定来源最小本地启动入口；`cocos:serve:web -- --project <ABS> --build-record <ABS> --port <PORT>`要求明确固定端口，不自动更换地址。来源校验及HTTP保护复用webProbeSupport，详见README和外层模块卡。
- `trace.cocos.browser-local-save`连接本地存档adapter、实际执行的Node测试和独立浏览器验收；同origin/profile刷新及新页面恢复只在用户手动load后发生，不提供自动续档或迁移API。

## 网页农事外层消费接口

- ProbeFarming.refresh(menu: ProbeMenuSnapshot)复制当前公开选项并校验已有选择；selectNextField/Seed/Crop和adjustSeedAmount仅管理外层输入，不提交正式命令。
- ProbeFarming.plantCommand()/harvestCommand()返回当前有效选择对应的既有ProbeCommand或null；status()返回ProbeFarmingView，包含当前选项、选择ID、播种数量及canPlant/canHarvest。
- ProbeLifetime.ts声明ProbeMenuSnapshot、ProbeBusinessResult、ProbeQuantity、ProbeFieldOption、ProbeMaterialOption、ProbeHarvestableOption等窄消费类型，只观察公开菜单，不取得可变运行态。
- ProbeInteraction按本次命令区分menu的preview/ActionResult与save_load结果，completed不是业务成功契约。相关接口属于outer，不扩展game-core公开API；trace.cocos.web-farming-loop连接行为与真实点击验收。

## 网页库存公开消费与store_item适配

| API/入口 | 文件 | 消费边界 |
|---|---|---|
| `MenuActionSelection` / `MenuActionBinding.buildDraft`的`store_item`分支 | `src/cocos-creator-adapter/menu/MenuActionBinding.ts` | 当前公开材料批次与储存目标ID映射到既有storeItem；MaterialLot object_ref，整批移动 |
| `ProbeInventory` | `apps/cocos-probe/template/assets/scripts/ProbeInventory.ts` | 公开批次/目标副本、本地选择、转移草稿；不读写SaveFile |
| `ProbeMenuSnapshot` / `ProbeCommand`库存消费字段 | `apps/cocos-probe/template/assets/scripts/ProbeLifetime.ts` | 只描述既有公开材料位置、储存目标和正式store_item参数 |

准确类型/字段以源码为准；没有新增core或Session API。preview/ActionResult决定业务成功，手动读取后重建选择；trace.cocos.web-inventory-storage连接Node与独立真实点击。
