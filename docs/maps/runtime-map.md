# Runtime Map — v0.0.3.0

## 系统职责

运行时入口：GameRuntime、ActionPipeline、Session、headless dev runner，以及外部正式资源经createStage1AHost装配宿主的入口。

## 涉及模块

- `game-core`
- `cocos-app`
- `scripts`
- `cocos-creator-adapter`

## 关键文件

- `src/cocos-creator-adapter/bootstrap/Stage1ABootstrap.ts`
- `src/cocos-creator-adapter/scene/CocosSceneBindingController.ts`
- `src/game-core/validation/RuntimeSchemaValidator.ts`
- `src/game-core/validation/RuntimeContractValidator.ts`
- `src/game-core/runtime/GameRuntime.ts`
- `src/game-core/dev/Stage1AHeadlessRuntime.ts`
- `src/cocos-app/runtime/CocosAppRuntimeSession.ts`
- `scripts/run-stage1a-headless.ts`

## 关键测试

- `tests/stage1a-bootstrap.test.ts`
- `tests/cocos-scene-binding-application.test.ts`、`tests/cocos-component-node-binding-application.test.ts`
- `tests/stage1a-headless-runtime.test.ts`
- `tests/cocos-runtime-session.test.ts`
- `tests/dev-runner`（package script: `test:dev-runner`）

## 修改前必读

- [`module-cards/cocos-app.md`](../module-cards/cocos-app.md)
- [`code-index/public-api.md`](../code-index/public-api.md)

## 修改后必跑

- `npm run test:stage1a-bootstrap`
- `npm run test:dev-runner`
- `npm run test:cocos-session`

## 常见风险

- load 失败污染当前 session（须保持 fail-closed）
- 读写 Promise 拒绝后状态或后续正常存读档不可恢复；验证须同时覆盖公开视图与完整序列化内容
- preview 路径产生正式状态变化
- 资源缺失或引用损坏后仍交付可操作宿主；对已ready的Host重复创建Session
- 命令已经提交但异步界面应用乱序或失败；绑定恢复不得重发Action或回滚业务

## 关联 module-cards

game-core, cocos-app, save-load

启动装配由`trace.runtime.bootstrap-resources`连接公共入口、两个校验器和独立集成验收。资源加载属于外部调用方，运行入口不依赖文件系统或测试辅助。

存储故障与恢复由 `trace.save.storage-failure-recovery` 连接 Session/UI/Queue 三个既有测试任务，详见 save-load 模块卡与 ADR-0003。

场景绑定的实例内完整顺序与失败后重同步由`trace.cocos.binding-async-recovery`追踪；仅管理同一控制器调用，不提供业务事务或跨实例全局锁。

真实Web宿主位于新cocos-engine-probe外层，准备工具从唯一运行源码和正式资源派生工程；异步加载期间销毁保护属于外层生命周期，不能由已有绑定队列代替。见[引擎探针模块卡](../module-cards/cocos-engine-probe.md)和trace.cocos.web-bootstrap-probe。

既有桌面视口和输入支持位于Web外层及构建模板，resize不重新创建Host、不重注册Action事件；`trace.cocos.web-viewport-input`和独立`cocos:verify:web`负责点击命中与公开时间/Label一致性，视口调整不改变运行会话。

## 浏览器本地存档与刷新恢复

trace.cocos.browser-local-save连接外层BrowserSaveStoragePort.ts、CocosWebProbe.ts、ProbeInteraction.ts及浏览器/固定来源工具；保留trace.cocos.web-save-load-recovery对既有Queue命令结果归属的追踪。既有三按钮AdvanceOneHour、SaveLocal、LoadLocal使用固定单槽web_probe和稳定项目key，启动不读写存储；同origin/profile刷新先创建新局，手动读取恢复保存状态。getter/读写拒绝和坏档保持当前会话，不回退内存。tests/cocos-browser-storage.test.ts与既有生命周期/交互回归由test.cocos-engine-probe-lifecycle实际执行，tests/cocos-web-serve-contracts.test.mjs由test.cocos-web-verification-contracts执行；files/covers、单文件affected及full/blocker闭合。ProbeInteraction保留本次反馈、busy和销毁后迟到保护；真实Creator/Chrome物理点击、刷新及同context新页面手动恢复独立验收，根typecheck只覆盖src，Node通过不能替代引擎或持久化证据。

## 网页农事公开消费

真实Web通过既有MenuActionBinding和公开Host/Component完成播种、时间推进、收获；ProbeFarming只管理外层选项与数量。ProbeInteraction检查本次preview及ActionResult，不把Queue.completed当成业务成功；load后重新校验外层选择，不解释残留菜单结果。trace.cocos.web-farming-loop追踪此消费链，核心ActionPipeline、Session和存档契约保持。

## 网页库存与正式整批转移

trace.cocos.web-inventory-storage连接MenuActionBinding.ts唯一最小store_item适配、outer ProbeInventory.ts/.meta、CocosWebProbe及公开结果反馈、tests/cocos-minimal-menu-binding.test.ts和tests/cocos-web-inventory.test.ts。库存辅助只复制公开批次/目标并管理本地选择，核心容量、形态、数量与Session/Queue规则保持。

库存行为测试加入既有test.cocos-engine-probe-lifecycle实际args/files/covers，菜单适配沿test.cocos-menu验证；prepare和工具契约继续full/blocker，新增helper/测试及唯一适配的单文件affected须闭合。真实库存点击至少独立960×640 built/editor验收，布局影响的农事、存读档/矩阵/resize和生命周期回归继续；Node不代替真实Creator/Chrome，未扩大门禁算法或平台范围。

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

## 网页批次拆分与操作反馈

ProbeInventory只复制公开材料选项并管理数量原文、不可编辑的来源单位和本次预览。完整解析数量，不使用parseFloat吞尾、静默取整或默认全部；count整数、g/ml小数、超量及容量沿既有正式预览校验。来源变化清空数量，改量/切页/其他命令/读档使旧预览失效；仍合法的普通拒绝输入保留供修改。

ProbeLifetime窄消费既有menu_preview/split_lot；ProbeInteraction显式区分preview、confirm和save/load，preview只认本次last_preview_result，不要求ActionResult；confirm仍经既有controller重预览，成功须本次双结果。新批次ID从本次created_objects关联刷新后的公开材料，数量/位置由公开结果取得，不从输入伪造。状态应用异常不自动重发Action；busy/销毁保护保持。

CocosWebProbe接真实cc.EditBox、单位/选择摘要、预览与确认Button；observer只读观察，不提供设置数量或派发业务捷径。既有拆分规则、Session/Queue、SaveFile、正式schema/config/fixture/expected、依赖版本与门禁算法保持。既有拆分不提供全量快捷按钮；既有加工页见trace.cocos.web-processing-loop，既有烹饪页见trace.cocos.web-cooking-loop，不扩Stage1B或wx。

tests/cocos-web-split.test.ts进入现有test.cocos-engine-probe-lifecycle的实际args/files/covers，test.cocos-web-verification-contracts校验拆分观察断言负例。trace.cocos.web-inventory-split连接这些行为及独立Creator SDK/构建、built-web和editor-preview各960×640真实点击与键盘输入；旧矩阵/resize/农事/转移/存读档/故障及销毁回归保留。桌面输入不代表触摸或微信通过，版本完成仍按q:full及无缓存q:release和精确候选CI。

## 网页加工运行链

公开processing_method_options/processing_task_options→ProbeProcessing本地选择→既有menu_preview/confirm→Session/ActionPipeline→本次created_objects及刷新公开任务/材料。requirement_index仅在UI使用，旧collectable列表仍只含ready；预计output不作实际产物。active手动保存→新Session/页面读取→正常advance_time→领取及再次开工由分层验证覆盖，trace.cocos.web-processing-loop连接；core时间、SaveFile、Session与Queue保持。

## 网页烹饪运行链

公开cookable_recipe_options与既有材料/储存/DishLot选项→ProbeCooking本地逐角色数量、显式操作参数和目标→既有menu_preview/confirm→Session/ActionPipeline→本次created_objects与刷新真实菜品/燃料。结构和recipe约束按当前核心合并，硬边界与偏好分开；不把time_cost_minutes当active_minutes或追加扣时。手动保存/新Host读取恢复真实DishLot列表并清旧预览，trace.cocos.web-cooking-loop连接；烹饪规则、Session/Queue、SaveFile保持，该烹饪子流程不负责补给或订单页，既有订单页另见下节，不接平台。

## 订单提交与过期路径

既有submit_order→DemandResolver检查available/accepted及now<=deadline→原需求匹配→事务内submitted→消费/储存审计/奖励→completed；失败由原管线保护完整领域状态。advance_time的既有截止settlement仅在now>deadline将两开放状态转expired；直接过期提交拒绝不改状态。order_options只读同步状态和截止，preview与新Session受控读档见trace.orders.legal-state-deadline，既有网页订单入口由下一节outer提供。

## 网页订单运行链

SelectableVM.order_options复制issuer_id、deadline_absolute_minute、signed minutes_until_deadline、正式需求的hard/weighted/defects/threshold、submitted refs和实际result_summary。订单名来自正式Profile文本，缺配置为null并不可用，嵌套数据全部独立副本。enabled只表示状态/时限及配置允许尝试，不保证所选菜品匹配；正/零截止余量和负余量来自当前绝对时间，不从day Label反算。StateVM及核心摘要保持。

ProbeOrders.ts/.meta只消费公共数据，管理第五页的显式单订单/单菜品本地选择和本次反馈，不改正式submitted_object_refs数组规则。终态可浏览、无菜品显示真实空态；浏览/选择0命令。preview只认本次校验，不伪造预计奖励；base_reward明确只是配置参考。确认沿既有menu→DraftBuilder→ActionPipeline，并以本次合法preview/ActionResult、实际Order.result_summary、所选菜品真实移除及公共金钱/声望变化关联成功，其他菜品保持。

确认前捕获order/dish与经济基线，避免成功patch先移除选择后误拒本次回执；错误或陈旧结果在ProbeInteraction发布completed前拒绝，应用失败不重发Action。改选择、切页、其他命令和load清旧预览/本次成功，历史结算另行展示；普通拒绝保留合法选择供修正，失效对象清除，不自动换菜品。busy/销毁迟到及本地单槽手动存读档保持。

tests/cocos-web-orders.test.ts实际进入既有lifecycle的args/files/covers，helper/.meta及测试同时登记prepare/lifecycle；readiness、menu与web-verification继续full/blocker。trace.cocos.web-orders-loop连接这些测试与源/地图，全部旧追踪保持。真实Creator/SDK和built/editor各960×640订单链、实际图检另行验收，保留原视口/resize、农事、库存拆分、加工、烹饪、存读档/故障与销毁。网页禁用重交只记0事件，正式状态/安全/低分拒绝由合法受控Node另验，不冒称微信或手机通过。

## 跨步骤恢复运行链

正式资源新局→公共玩家入口九Action→五独立保存点→手动Save→新Host/刷新/同context新页手动Load→真实续玩。trace.cocos.cross-step-recovery连接公共bootstrap测试、verify-web/support与既有错误保护；加工继续领取再开工、已完成订单保持不可重交并继续创建对象。生产机制与既有ID保证边界保持，恢复列表和静态Label不冒充本次Action。

## 触摸与小屏运行边界

原生触摸/EditBox→既有ProbeInteraction/菜单→Host/Queue→Session/ActionPipeline保持。ProbeLayout仅描述frame几何，原生ScrollView/Mask管理表现滚动；切页/resize不重建会话或重绑业务CLICK。trace.cocos.touch-small-screen连接布局与实际输入证据，不新增SaveFile或core状态入口。

## 微信M1装配

apps/cocos-wechat-probe外层通过createStage1AHost、QinglanUiSceneProbeComponent公共runtime装配会话；WechatProbeController经公开菜单提交播种、推进、收获、整批转移、拆分预览确认和手动存读档命令，并维护busy、前后台及销毁保护。candidate-identity生成资源与SaveFile隔离，真实微信读档及前后台结果须独立验收；完整M3和M4尚未完成。trace.cocos.wechat-m1连接preparation/runtime测试及独立平台证据，核心入口与事务不变。

## 微信显式Schema预编译装配

RuntimeSchemaValidator支持显式PrecompiledSchemaValidatorSet：format为runtime-precompiled-schemas/v1，schemaSources在源侧按完整资源路径保留JSON.stringify(schema)原JSON绑定，validators按正式$id记录ValidateFunction。运行期将源JSON解析后与实际Schema作完整JSON语义规范化比较，仅允许Creator的对象键重排；字段集合、数组次序和全部嵌套值必须一致，不忽略未知字段、数组或数值变化，坏JSON和非JSON内容拒绝。原始Schema、预编译生成物和工具/产物的字节SHA来源仍严格，不因运行期对象键规范化而放宽。Stage1ABootstrapResources的可选precompiledValidators字段透明转交该集合。显式提供集合时不创建Ajv、不回退动态编译；完整路径/ID/内容不匹配、重复或无$id、无效/异步函数及非布尔结果均拒绝。未提供时Node/Web维持原Ajv路径。核心仍不接cc/wx/fs、工具或资源读取。

微信compileWechatSchemas位于tools/cocos-wechat-probe/lib/precompiledSchemas.mjs，在唯一prepare生产链冻结outputs前生成wechat-precompiled-validators.mjs、wechat-schema-precompile.json及wechat-runtime-entry.mjs。前两者记录安全schema_NNN导出/ID映射、完整Schema内容、编译器版本与选项、实际CommonJS编译器依赖闭包及生成摘要；Node编译器依赖通过Ajv入口的require.cache闭包记录，不能冒称由esbuild运行bundle的metafile捕获。facade显式注入precompiledValidators后再打包到assets/generated/probe-runtime.js，Cocos不直接导入额外standalone文件。核心的绑定检查不以自声明元数据证明函数可信；真实Ajv生成代码及工具/源/依赖字节由prepare和构建来源记录约束。

## 微信DTO复制目标适配

WechatDataClone.ts提供微信目标内的纯DTO复制适配，导出structuredClone供wechat profile的esbuild inject局部绑定runtime中的标准自由标识符。不修改globalThis或Cocos引擎，不在src中新增指向apps的源import，也不改变默认Node/Web路径；它不是通用Web API polyfill。支持数组、普通对象/空原型DTO输入及原始值，保留undefined、数组空位、共享引用/别名、循环和特殊属性键；非DTO对象、函数、Symbol与options（包括transfer）明确DataCloneError拒绝，不用JSON往返静默丢失数据。

源位于apps/cocos-wechat-probe/runtime/WechatDataClone.ts，仍由新outer已有module roots和authoritative .ts规则扫描；无cc/wx/fs依赖。helper经prepare实际onLoad进入manifest.inputs，并由sourceProvenance要求存在，源与依赖/生成物字节校验不放宽。微信facade受控预检同时禁用动态Function并移除原生structuredClone，正式启动/动作/坏请求仍须经过公共运行时；这不能替代最终候选的Creator/微信真实输入或手机验收。

## M2微信存储与生命周期

M2运行时改动集中于独立微信outer，并同步构建来源、测试和文档：手动单逻辑槽经Creator sys.localStorage接入平台存储，保存与读取沿既有Session/SaveManager及校验；前后台事件只限制输入与维护会话，不自动存档或补算时间。旧三层及outer直接wx/fs禁令保持，正式SaveFile和玩法不变。

备份恢复先以隔离Session校验，port内部再次校验并复核标记与备份字节，持久提升后再经Binding读取主槽。准备/提升失败和Session读档校验失败的受控场景保留原会话；Binding的UI补丁可能在Session提交后失败，不能将此类错误一概表述为原会话未改变。

备份与中断保护须同时考虑失败前后可能发生写入：备份、主档与恢复信息分开；读取、恢复和失败路径以源码及针对性测试为准，不能将异常等同于未落盘。故障保护依赖存储键相互独立和可读回一致的有限模型，真实微信断电、设备故障及底层原子性未证明。备份恢复不等于跨平台导入或自动存档。

tests/cocos-wechat-storage.test.ts登记进既有test:cocos-wechat-runtime的args/files，相关源及meta也进入preparation/runtime登记和trace.cocos.wechat-m1。受控Node契约不替代真实Creator、官方微信工具输入/存储/生命周期、最终提交CI或手机验收；具体结果以仓库外证据为准。

## M3微信库存拆分

M3微信库存拆分支持可选预览；玩家可直接确认当前批次和数量。共享队列以menu_confirm_split_direct调用独立只读校验，通过后才同步提交正式split_lot，校验与执行共用正式数量、预留、定义及容量规则，不依赖preview。切换材料、数量或会话使旧预览失效，预览不成为确认的前置条件；提交后异常或无法核实回执提示结果待确认，不自动重试。原Web菜单确认仍先预览。M2存读档与M3种植库存能力继续保留；不修改SaveFile、正式Schema、配置或玩法规则。PR25、PR26、PR27依赖须随候选核对，本包不包含M3完整经营、M4或Stage1B。

## M3微信加工

公开方法、批次、设施与任务→微信outer选择→可选menu_preview或menu_confirm_processing_direct→Session独立校验→正式ActionPipeline；推进及领取仍为现有正式Action。提交后异常或无法验证结果提示核实，不自动重试。原Web菜单路径保持。

## 加工只读核对路径

WechatProbeController.refreshProcessingView→既有Queue refresh→当前Session公开菜单投影；该路径不读写存档、不提交正式Action，不自动领取。UI实例锁定疑似重复领取，失败、缺任务、后台或过期回执不能解除；开工不确定须先只读刷新并查看当前任务/库存，再由玩家重新选材；领取只在任务状态与可领取列表一致时解除锁，依最新任务状态开放手动操作。

## 播种数量闭合

plant_crop→FarmingSystem预检查库存/预留/配置容量→单事务创建N株/扣N粒/占N格→Runtime逐株回执与事件→SelectableVM剩余格投影→Web/微信农事页面。harvest_crop仍逐株收获及释放1格。trace.farming.seed-quantity连接核心/预览/Session/readiness和真实两端消费。
