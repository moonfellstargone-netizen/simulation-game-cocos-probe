# Code Index — Public API — v0.0.3.0

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

- `Stage1ABootstrapResources`：外部已解析的`snapshot`、`schemas`、`storage`及明确的`buildId`、`nowIso8601`，以及可选`precompiledValidators`。
- `createStage1AHost(input): CocosSessionHost`（`src/cocos-creator-adapter/bootstrap/Stage1ABootstrap.ts`）：资源与契约就绪、新局校验成功后才返回已创建Session的Host；失败抛错，不进行存储读写或正式Action。
- 导出：bootstrap子目录及`src/cocos-creator-adapter/index.ts`。
- `RuntimeSchemaValidator.assertSchemasAvailable(ids)`：默认真实编译指定Schema及引用闭包；显式预编译模式确认已绑定的同步校验函数可用，不回退动态编译。
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

## 加工必需输入校验与失败保护

按当前加工方法配置校验全部必需输入，缺料在任何消耗、任务创建和任务ID分配前拒绝。公开preview与直接正式dispatch共享验证；preview不得改变完整游戏状态、事件、库存/储存缓存或正式对象ID。正式失败保留既有失败反馈，不要求ActionRequestBuilder请求序号回滚。

契约、预览和公开Host/Component回归分别核对缺白菜、缺盐、盐不足/阈值边界，以及合法不同数量的消耗、任务、推进和领取。失败后健康请求与存读档恢复继续；不通过私有SaveFile写入构造假通过，不新增重复同lot或多primary拒绝/聚合规则。trace.processing.required-inputs连接ProcessingSystem.ts、ProcessingConfigResolver.ts及现有test.stage1a-contract、test.action-preview、test.cocos-session和test.cocos-menu。

实际触及测试逐一登记args/files/covers并验证单文件affected真正执行自身任务；q:affected仍只用于反馈，版本完成和候选出包按q:full及无缓存q:release。核心进入Web bundle，真实Creator SDK/构建及既有built-web/editor-preview回归需独立执行。核心校验沿用既有实现；网页加工与真实输入由trace.cocos.web-processing-loop独立验收，不从核心Node通过推定。

## 持久ID恢复与预览一致性

IdService观察完整GameState的字符串值及记录键，恢复生成格式ID的每前缀高水位；这只决定技术ID分配，不用于判断材料身份。十进制字符串递增避免Number大后缀精度停滞。同一runtime高水位只升不降，GameRuntime包装全部已注册handler，使直接pipeline、Session和预览新runtime均在业务分配前恢复。ActionPipeline、存档结构与正式业务规则保持。

保证覆盖存档中仍存在的对象和任意历史引用，以及同一runtime已知分配；整个SaveFile已无任何记录的历史ID不能无新增持久化字段地恢复。预览不修改领域状态或正式ID服务；失败保持既有事务语义，不承诺请求序号或已分配ID回滚。

trace.runtime.id-recovery连接IdService.ts、GameRuntime.ts、CocosActionPreviewer.ts与Session；test.stage1a-contract、test.action-preview、test.cocos-session核对各对象/事件、历史引用、跨实例加载、极大后缀及合法恢复。该ID恢复能力不新增数量规则；网页拆分由outer单独提供，既有加工页独立消费正式加工，既有烹饪页消费既有cook_dish，不扩Stage1B或wx。真实Creator及既有built/editor浏览器回归独立执行，核心/Session回归与网页真实输入分别验收。

## 拆分数量、定义占用与失败保护

正式split_lot要求请求和源数量为有效正数/finite，count保持整数，各单位整数请求须按请求原值扣减，partial须实际减少源；不新增g/ml最小量或一律整数限制。连续小数沿用Number舍入，未引入任意精度十进制语义。全量保留既有成功语义，归零源移出active inventory，新的正量批次保留inventory_split来源、lineage和旧源ID审计；该策略是兼容实现选择，不是正式包唯一指定的全量规则。

InventorySystem经ConfigRepository读取当前已加载材料/种子定义，按ceil(quantity/base_quantity*footprint)、正数至少1slot_weight分别重算源余量和新批次占用；不从已取整旧占用继续按比例缩放，也不以直接数量比较容器容量。Runtime及Farming/Processing/Cooking只传播构造依赖，consume算法不改。数量/定义拒绝发生在修改及ID分配前；容量失败沿既有事务恢复领域状态，已消耗ID不要求回滚。

trace.inventory.split-quantity连接InventorySystem及配置调用方，现有test.stage1a-contract、test.action-preview、test.cocos-session、test.cocos-menu验证完整状态、正/负例、定义变化、连续拆分、全量来源、预留/容量保护、公开预览与失败后存读档/健康恢复。正式资源、SaveFile、管线和核心规则保持；真实Creator与现有built/editor回归独立执行，网页拆分由trace.cocos.web-inventory-split独立真实输入验收，不从核心测试推定。

## 网页拆分outer接口

ProbeInventory的setSplitQuantity、invalidateSplitPreview、splitPreviewCommand/splitConfirmCommand及acceptSplitResult管理本地数量与本次回传。ProbeCommand新增既有menu_preview和split_lot窄类型消费，未新增核心/Session/QueueAPI；确认仍走原菜单重预览。真实cc.EditBox属于CocosWebProbe，公开observer只读，准确字段以源码为准；trace.cocos.web-inventory-split追踪。

## 加工方法与完整任务只读选项

- CocosSelectableViewModelData.processing_method_options: CocosProcessingMethodOption[]，含id/label_key、input_requirements、只读tool_requirements、compatible_facility_ids和两个配置时间字段；无材料仍enabled可查看，工具要求只作说明，不新增选择或消耗行为。
- CocosProcessingInputRequirementOption含requirement_index、constraints（category/base_id、allowed_base_ids/allowed_forms、min_freshness）、min_quantity与lot_ids。索引仅用于本地UI，不进入正式input_lots；候选复用既有matcher，最低量仅按配置投影。
- processing_task_options: CocosProcessingTaskOption[]，含method/status/current_stage、start_world_minute/expected_finish_minute、facility_ref及expected_output:{base_id,quantity}|null。只有ready可领取，数组/嵌套引用复制；旧collectable_task_options的shape和过滤保持。
- ProbeProcessing.refresh/status、选择/数量设置、startPreviewCommand/startConfirmCommand/collectCommand及acceptProcessingResult仅管理outer状态，真实命令沿既有menu_preview/confirm。实际任务/产物关联当次created_objects，预计output不当作已获产物；见trace.cocos.web-processing-loop及engine模块卡。

源入口src/cocos-app/view-models/CocosSelectableViewModel.ts、apps/cocos-probe/template/assets/scripts/ProbeProcessing.ts；readiness与cocos-web-processing行为测试分层验证，真实Creator/浏览器另验。

## 烹饪公开只读选项与outer

CocosSelectableViewModel.cookable_recipe_options包含按当前CookingSystem合并的recipe/structure角色要求及候选；role增加allowed_base_ids并核单位。recipe的operation_constraints含heat_levels、required_heat_level、active_minutes硬边界、time_preference_minutes偏好及配置默认/时间/体力说明；tool_requirements、facility_requirements仅只读，fuel含base_id/cost/current_quantity/enabled，output_estimate明确为预计。准确字段以源码为准，不将配置默认自动填作本次选择，不追加消耗。既有submittable_dish_lot_options承载真实DishLot身份、份数与storage_ref，不增通用菜品搬运。

ProbeCooking.refresh/status与本地选择、数量/操作参数设置、preview/confirm草稿及本次结果接收只管理公开数据副本；真实写入沿既有MenuActionBinding.cook_dish和ActionPipeline。成功关联本次created_objects的真实DishLot，改输入/切页/其他命令/手动读档清旧预览；trace.cocos.web-cooking-loop连接readiness、outer行为及独立Creator/浏览器验收。

## 订单合法状态与截止语义

既有submit_order参数与Session/Queue接口保持。available/accepted且当前分钟不超过deadline可尝试，submitted只为同步事务内部短暂态；completed/failed/expired/cancelled及过期开放单拒绝，失败不改变领域状态。advance_time严格超过截止时将开放单结算为expired，旧failed不迁移。CocosSelectableViewModel.order_options既有字段含义保持，新增需求/截止/结果只读字段见下节；enabled/reason按状态和时限对齐，不保证需求匹配成功。

trace.orders.legal-state-deadline连接三源及核心、preview、Session手动读档与readiness测试；没有新增接单Action或SaveFile字段；网页入口由outer沿既有菜单提供。

## 网页订单公开消费

- `CocosSelectableViewModel.order_options`扩展只读issuer、deadline_absolute_minute、signed minutes_until_deadline、正式需求与实际submitted refs/result_summary；hard/weighted分开，缺配置null且不可用，嵌套全部复制。
- `MenuActionBinding.submit_order`既有显式order_option_id/dish_lot_option_ids[]→正式submitted_object_refs路径保持，confirm仍重预览；UI单选不修改正式参数契约。
- `ProbeOrders`属于outer，只管理选择、回执前基线和本次反馈，不读取私有SaveFile、直接写状态或预测奖励；成功关联真实Order/菜品/经济结果，历史结果另示。
- `trace.cocos.web-orders-loop`连接readiness/menu/prepare/lifecycle/web-verification与独立真实Creator/浏览器。

## 跨步骤恢复公共入口

公共bootstrap→Host→既有菜单/Queue→Session save/load接口保持，无新增公开API。trace.cocos.cross-step-recovery以五个独立自然保存点的全新会话读取和真实续玩核既有保证；读取失败保留健康状态，加载清暂态，后续新对象/事件不覆盖存档仍有的ID或历史引用。真实浏览器通过按钮与键盘操作，observer只读；ID无记录历史恢复和请求序号回滚仍不作新承诺。

## 触摸与小屏公开诊断

outer的ProbeLayout.ts导出ProbePanelName、ProbeLayoutRect、ProbeLayoutPlan及createProbeLayout(width, height):ProbeLayoutPlan，只计算frame、viewport、固定区和页面节点几何，不读写Session或派发命令。CocosWebProbe仅增只读布局/滚动观察，resize不重建Host/observer/Button；trace.cocos.touch-small-screen连接纯布局行为与真实输入证据。

tools/cocos-probe/verify-web.mjs另导出工具函数touchLoop，供仓库外开发脚本复用同一原生触摸场景定位问题；它不是玩家API、observer setter或独立验收权威。开发subset结果必须标明来源和范围，不能当最终全回归。正式verifyWebProbe仍无条件执行全部既有鼠标/键盘/经营/恢复链和触摸场景，没有CLI skip选项。

tools/cocos-probe/lib/webProbeSupport.mjs实际导出NATIVE_CANCEL_DIAGNOSTIC和assertTouchBrowserDiagnostics(logs, touch)。它们只核受控touch-native-cancel的精确一次原生诊断、trusted/cancelable=false、取消保护及保存/推进/读取恢复；同全文出现在其他case或伪标missing-resource也拒绝。保留原始console，正常链error及全部pageerror仍为零，不提供一般错误忽略或运行态业务API。

## 微信M1外层与工具入口

- WechatProbeController/readCandidateIdentity属于apps/cocos-wechat-probe/template/assets/scripts/WechatProbeController.ts，身份只读，不是核心新API。
- prepareWechatProbe({rootDir?, outputDir, appId})位于tools/cocos-wechat-probe/prepare.mjs；CLI为cocos:prepare:wechat -- --output ABS_EMPTY_DIRECTORY --app-id PROJECT_APP_ID。
- buildWechatProbe({creator, project, logDir})位于tools/cocos-wechat-probe/build.mjs；CLI为cocos:build:wechat，rootDir仅受控fixture可传，不是CLI参数。
- tools/cocos-probe/lib/prepareProject.mjs固定内部web/wechat profile，旧Web wrapper签名、角色、manifest和CLI兼容；不公开自选runtime/template/role扩展口。
- candidate-identity.json由prepare生成，schema为wechat-candidate/v1，记录candidate_id、source_commit、short_commit、version和build_id；与SaveFile隔离。最终产物摘要及范围仅在包外。

test:cocos-wechat-preparation / test.cocos-wechat-preparation实际执行tests/cocos-wechat-preparation.test.mjs；test:cocos-wechat-runtime / test.cocos-wechat-runtime实际执行tests/cocos-wechat-runtime.test.ts，均为full/blocker。trace.cocos.wechat-m1连接新outer、共享生产者、微信构建、候选身份、架构负例和质量登记。Node只能证明受控准备/行为契约；真实Creator3.8.8/SDK、官方微信工具场景/输入/日志/重载、受影响Web回归和最终提交CI各自验收。旧全部追踪、权威架构禁令和Web功能/来源检查保留，不以修改阈值、预期、CI或affected算法通过门禁。

## 显式预编译Schema接口

RuntimeSchemaValidator支持显式PrecompiledSchemaValidatorSet：format为runtime-precompiled-schemas/v1，schemaSources在源侧按完整资源路径保留JSON.stringify(schema)原JSON绑定，validators按正式$id记录ValidateFunction。运行期将源JSON解析后与实际Schema作完整JSON语义规范化比较，仅允许Creator的对象键重排；字段集合、数组次序和全部嵌套值必须一致，不忽略未知字段、数组或数值变化，坏JSON和非JSON内容拒绝。原始Schema、预编译生成物和工具/产物的字节SHA来源仍严格，不因运行期对象键规范化而放宽。Stage1ABootstrapResources的可选precompiledValidators字段透明转交该集合。显式提供集合时不创建Ajv、不回退动态编译；完整路径/ID/内容不匹配、重复或无$id、无效/异步函数及非布尔结果均拒绝。未提供时Node/Web维持原Ajv路径。核心仍不接cc/wx/fs、工具或资源读取。

微信compileWechatSchemas位于tools/cocos-wechat-probe/lib/precompiledSchemas.mjs，在唯一prepare生产链冻结outputs前生成wechat-precompiled-validators.mjs、wechat-schema-precompile.json及wechat-runtime-entry.mjs。前两者记录安全schema_NNN导出/ID映射、完整Schema内容、编译器版本与选项、实际CommonJS编译器依赖闭包及生成摘要；Node编译器依赖通过Ajv入口的require.cache闭包记录，不能冒称由esbuild运行bundle的metafile捕获。facade显式注入precompiledValidators后再打包到assets/generated/probe-runtime.js，Cocos不直接导入额外standalone文件。核心的绑定检查不以自声明元数据证明函数可信；真实Ajv生成代码及工具/源/依赖字节由prepare和构建来源记录约束。

tests/runtime-precompiled-schema.test.ts进入现有test:stage1a-bootstrap / registry test.stage1a-bootstrap实际args/files/covers，沿用full/blocker，不新增任务或降低门禁。该测试覆盖禁用动态Function后的正式启动/合法动作及坏请求、集合/内容拒绝；微信preparation契约覆盖实际facade、全部Schema、来源与生成物篡改，资源预检标记为node-aot-public-bootstrap-passed。Web旧resourcePreflight和默认动态路径保持。Node不替代新提交的Creator/SDK、微信真实输入/日志/重载、Web回归或审查/CI。

## 微信目标DTO复制辅助

`structuredClone<T>(value: T, options?: unknown): T`位于apps/cocos-wechat-probe/runtime/WechatDataClone.ts，供固定wechat profile的esbuild inject使用，不是game-core新API。

WechatDataClone.ts提供微信目标内的纯DTO复制适配，导出structuredClone供wechat profile的esbuild inject局部绑定runtime中的标准自由标识符。不修改globalThis或Cocos引擎，不在src中新增指向apps的源import，也不改变默认Node/Web路径；它不是通用Web API polyfill。支持数组、普通对象/空原型DTO输入及原始值，保留undefined、数组空位、共享引用/别名、循环和特殊属性键；非DTO对象、函数、Symbol与options（包括transfer）明确DataCloneError拒绝，不用JSON往返静默丢失数据。

源位于apps/cocos-wechat-probe/runtime/WechatDataClone.ts，仍由新outer已有module roots和authoritative .ts规则扫描；无cc/wx/fs依赖。helper经prepare实际onLoad进入manifest.inputs，并由sourceProvenance要求存在，源与依赖/生成物字节校验不放宽。微信facade受控预检同时禁用动态Function并移除原生structuredClone，正式启动/动作/坏请求仍须经过公共运行时；这不能替代最终候选的Creator/微信真实输入或手机验收。

## 微信M2外层入口

- `WechatSaveStoragePort`位于`apps/cocos-wechat-probe/template/assets/scripts/WechatSaveStoragePort.ts`，提供单逻辑槽存取与外层恢复保护，不是game-core新增平台API。
- `createWechatPriorSaveValidator`位于`apps/cocos-wechat-probe/template/assets/scripts/WechatPriorSaveValidator.ts`，通过独立Host校验序列化存档，不提供存储写入。
- `WechatProbeController`通过既有公开Binding提供手动存读档与前后台输入保护，candidate_id继续来自运行包。
