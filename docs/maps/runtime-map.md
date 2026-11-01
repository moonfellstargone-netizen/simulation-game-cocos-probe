# Runtime Map — v0.0.2.40

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

桌面视口和输入修复仅在既有Web外层及构建模板，resize不重新创建Host、不重注册Action事件；`trace.cocos.web-viewport-input`和独立`cocos:verify:web`负责点击命中与公开时间/Label一致性，核心运行流程保持不变。

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

本版实际触及测试逐一登记args/files/covers并验证单文件affected真正执行自身任务；q:affected仍只用于反馈，版本完成和候选出包按q:full及无缓存q:release。核心进入Web bundle，真实Creator SDK/构建及既有built-web/editor-preview回归需独立执行。没有加工网页，浏览器不声明覆盖缺盐路径。

## 持久ID恢复与预览一致性

IdService观察完整GameState的字符串值及记录键，恢复生成格式ID的每前缀高水位；这只决定技术ID分配，不用于判断材料身份。十进制字符串递增避免Number大后缀精度停滞。同一runtime高水位只升不降，GameRuntime包装全部已注册handler，使直接pipeline、Session和预览新runtime均在业务分配前恢复。ActionPipeline、存档结构与正式业务规则保持。

保证覆盖存档中仍存在的对象和任意历史引用，以及同一runtime已知分配；整个SaveFile已无任何记录的历史ID不能无新增持久化字段地恢复。预览不修改领域状态或正式ID服务；失败保持既有事务语义，不承诺请求序号或已分配ID回滚。

trace.runtime.id-recovery连接IdService.ts、GameRuntime.ts、CocosActionPreviewer.ts与Session；test.stage1a-contract、test.action-preview、test.cocos-session核对各对象/事件、历史引用、跨实例加载、极大后缀及合法恢复。该ID恢复能力不新增数量规则；网页拆分由outer单独提供，不扩加工、Stage1B或wx。真实Creator及既有built/editor浏览器回归独立执行，核心/Session回归与本版网页拆分真实输入分别验收。

## 拆分数量、定义占用与失败保护

正式split_lot要求请求和源数量为有效正数/finite，count保持整数，各单位整数请求须按请求原值扣减，partial须实际减少源；不新增g/ml最小量或一律整数限制。连续小数沿用Number舍入，未引入任意精度十进制语义。全量保留既有成功语义，归零源移出active inventory，新的正量批次保留inventory_split来源、lineage和旧源ID审计；该策略是兼容实现选择，不是正式包唯一指定的全量规则。

InventorySystem经ConfigRepository读取当前已加载材料/种子定义，按ceil(quantity/base_quantity*footprint)、正数至少1slot_weight分别重算源余量和新批次占用；不从已取整旧占用继续按比例缩放，也不以直接数量比较容器容量。Runtime及Farming/Processing/Cooking只传播构造依赖，consume算法不改。数量/定义拒绝发生在修改及ID分配前；容量失败沿既有事务恢复领域状态，已消耗ID不要求回滚。

trace.inventory.split-quantity连接InventorySystem及配置调用方，现有test.stage1a-contract、test.action-preview、test.cocos-session、test.cocos-menu验证完整状态、正/负例、定义变化、连续拆分、全量来源、预留/容量保护、公开预览与失败后存读档/健康恢复。正式资源、SaveFile、管线和核心规则保持；真实Creator与现有built/editor回归独立执行，网页拆分由trace.cocos.web-inventory-split独立真实输入验收，不从核心测试推定。

## 网页批次拆分与操作反馈

ProbeInventory只复制公开材料选项并管理数量原文、不可编辑的来源单位和本次预览。完整解析数量，不使用parseFloat吞尾、静默取整或默认全部；count整数、g/ml小数、超量及容量沿既有正式预览校验。来源变化清空数量，改量/切页/其他命令/读档使旧预览失效；仍合法的普通拒绝输入保留供修改。

ProbeLifetime窄消费既有menu_preview/split_lot；ProbeInteraction显式区分preview、confirm和save/load，preview只认本次last_preview_result，不要求ActionResult；confirm仍经既有controller重预览，成功须本次双结果。新批次ID从本次created_objects关联刷新后的公开材料，数量/位置由公开结果取得，不从输入伪造。状态应用异常不自动重发Action；busy/销毁保护保持。

CocosWebProbe接真实cc.EditBox、单位/选择摘要、预览与确认Button；observer只读观察，不提供设置数量或派发业务捷径。核心、Session/Queue、SaveFile、正式schema/config/fixture/expected、依赖版本与门禁算法保持。不提供全量快捷按钮、加工界面、Stage1B或wx。

tests/cocos-web-split.test.ts进入现有test.cocos-engine-probe-lifecycle的实际args/files/covers，test.cocos-web-verification-contracts校验拆分观察断言负例。trace.cocos.web-inventory-split连接这些行为及独立Creator SDK/构建、built-web和editor-preview各960×640真实点击与键盘输入；旧矩阵/resize/农事/转移/存读档/故障及销毁回归保留。桌面输入不代表触摸或微信通过，版本完成仍按q:full及无缓存q:release和精确候选CI。
