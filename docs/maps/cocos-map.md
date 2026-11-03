# Cocos Map — v0.0.2.46

## 系统职责

Cocos 试水适配与 Creator 探针：UI readiness、menu/save-load binding、scene/component binding。旧creator-adapter仍是**非真实 Cocos 工程**；新增cocos-engine-probe为真实Web外层源模板，派生工作副本位于仓库外。

## 涉及模块

- `cocos-app`
- `cocos-creator-adapter`
- `cocos-engine-probe`

## 关键文件

- `apps/cocos-probe/`（真实外层源模板）
- `apps/cocos-probe/template/assets/scripts/CocosWebProbe.ts`（cc组件、正式资源加载与Label/Button端口）
- `apps/cocos-probe/template/assets/scripts/ProbeLifetime.ts`（异步启动、销毁和迟到结果保护）
- `tools/cocos-probe/prepare.mjs`（仓库外派生准备）
- `tools/cocos-probe/build.mjs`（真实Creator构建入口）

- `src/cocos-creator-adapter/bootstrap/Stage1ABootstrap.ts`
- `src/cocos-creator-adapter/scene/CocosSceneBindingController.ts`
- `src/cocos-creator-adapter/component/QinglanUiSceneProbeComponent.ts`
- `src/cocos-app/runtime/CocosAppRuntimeSession.ts`
- `src/cocos-creator-adapter/CocosSessionHost.ts`
- `src/cocos-creator-adapter/shell/CocosUiShellController.ts`
- `src/cocos-creator-adapter/shell/CocosUiCommandQueue.ts`
- `src/cocos-creator-adapter/menu/MinimalMenuInteractionController.ts`
- `src/cocos-creator-adapter/save/SaveLoadInteractionController.ts`

## 关键测试

- `tests/cocos-probe-preparation.test.mjs`
- `tests/cocos-engine-probe-lifecycle.test.ts`

- `tests/stage1a-bootstrap.test.ts`（正式资源经公共入口的独立装配、失败保护与生命周期）
- `tests/cocos-ui-readiness.test.ts`
- `tests/cocos-minimal-menu-binding.test.ts`
- `tests/cocos-save-load-ui-binding.test.ts`
- `tests/cocos-runtime-session.test.ts`
- `tests/cocos-ui-command-queue.test.ts`（受控延迟读写拒绝和恢复）
- `tests/cocos-scene-binding-application.test.ts`
- `tests/cocos-component-node-binding-application.test.ts`
- `tests/support/controlledBindingPort.ts`（手动延迟/拒绝和实际端口状态）

## 修改前必读

- [`module-cards/cocos-creator-adapter.md`](../module-cards/cocos-creator-adapter.md)
- 遗留契约：`docs/module_contracts/*`（保留，非 module-card 主入口）

## 修改后必跑

- `npm run test:stage1a-bootstrap`
- `npm run test:cocos-scene-binding`
- `npm run test:cocos-component-node-binding`
- `npm run test:cocos-ui-readiness`
- 相关 cocos-ui 测试组

## 常见风险

- 在旧三层接入真实`cc`或任何层接wx（新outer只开放cc）
- 把探针写成 Stage 1B 已实现
- UI 层绕过 Session 直写 SaveFile
- 存储拒绝后仍展示旧成功摘要、队列超车或健康命令无法继续；追踪 `trace.save.storage-failure-recovery`
- 对createStage1AHost返回的已创建Host重复执行Probe.onLoad，或把装配验收当作真实Cocos工程运行证明
- 异步旧绑定覆盖新视图或卸载结果；失败后diff遗漏未应用区，恢复错误地重发正式Action

`trace.cocos.binding-async-recovery`覆盖同一绑定实例的完整顺序及失败后重同步；两项既有full/blocker任务登记tests覆盖和共享辅助，不修改affected算法。

## 关联 module-cards

cocos-app, cocos-creator-adapter

## 真实Web外层与后续范围

新增outer源模板由[引擎探针模块卡](../module-cards/cocos-engine-probe.md)导航，trace.cocos.web-bootstrap-probe连接自动准备与生命周期验证；真实Creator预览/构建独立验收。微信导出、真实wx storage及AOT仍未进入。

## 桌面Web视口与输入

`apps/cocos-probe/template/build-templates/web-desktop/`是页面容器/resize源模板；`tools/cocos-probe/build.mjs`记录产物摘要，`tools/cocos-probe/verify-web.mjs`与`tools/cocos-probe/lib/webProbeSupport.mjs`核对来源后运行真实鼠标矩阵。`tests/cocos-web-verification-contracts.test.mjs`登记full/blocker，仅验证Node工具边界，不能作为实际Creator或浏览器通过证据。

`trace.cocos.web-viewport-input`连接模板、工具、契约、affected与实际验收说明；支持范围见[引擎探针模块卡](../module-cards/cocos-engine-probe.md)。不能用observer.advance绕过物理点击；窗口变化保留原会话；浏览器本地存储仅由外层Port承担，不接微信。

## 浏览器本地存档与刷新恢复

trace.cocos.browser-local-save连接外层BrowserSaveStoragePort.ts、CocosWebProbe.ts、ProbeInteraction.ts及浏览器/固定来源工具；保留trace.cocos.web-save-load-recovery对既有Queue命令结果归属的追踪。既有三按钮AdvanceOneHour、SaveLocal、LoadLocal使用固定单槽web_probe和稳定项目key，启动不读写存储；同origin/profile刷新先创建新局，手动读取恢复保存状态。getter/读写拒绝和坏档保持当前会话，不回退内存。tests/cocos-browser-storage.test.ts与既有生命周期/交互回归由test.cocos-engine-probe-lifecycle实际执行，tests/cocos-web-serve-contracts.test.mjs由test.cocos-web-verification-contracts执行；files/covers、单文件affected及full/blocker闭合。ProbeInteraction保留本次反馈、busy和销毁后迟到保护；真实Creator/Chrome物理点击、刷新及同context新页面手动恢复独立验收，根typecheck只覆盖src，Node通过不能替代引擎或持久化证据。

## 网页农事闭环

trace.cocos.web-farming-loop连接纯outer选择辅助ProbeFarming.ts、窄公开消费类型ProbeLifetime.ts、本次结果协调ProbeInteraction.ts与真实CocosWebProbe.ts。只接既有plant_crop、advance_time、harvest_crop；当前公开收获列表只含可收获作物，不提供所有作物进度。挂载、动作后及手动load后刷新列表并清除失效选择。

tests/cocos-web-farming.test.ts与交互回归随既有生命周期full/blocker实际运行；真实960×640的built/preview物理点击分别验证超量拒绝、数量/占用、读档恢复、收获实际产量与再次种植。保留原三按钮视口/resize及本地存储回归，不重定义Queue.completed或扩大核心接口。

## 网页库存与正式整批转移

trace.cocos.web-inventory-storage连接MenuActionBinding.ts唯一最小store_item适配、outer ProbeInventory.ts/.meta、CocosWebProbe及公开结果反馈、tests/cocos-minimal-menu-binding.test.ts和tests/cocos-web-inventory.test.ts。库存辅助只复制公开批次/目标并管理本地选择，核心容量、形态、数量与Session/Queue规则保持。

库存行为测试加入既有test.cocos-engine-probe-lifecycle实际args/files/covers，菜单适配沿test.cocos-menu验证；prepare和工具契约继续full/blocker，新增helper/测试及唯一适配的单文件affected须闭合。真实库存点击至少独立960×640 built/editor验收，布局影响的农事、存读档/矩阵/resize和生命周期回归继续；Node不代替真实Creator/Chrome，未扩大门禁算法或平台范围。

## 网页批次拆分与操作反馈

ProbeInventory只复制公开材料选项并管理数量原文、不可编辑的来源单位和本次预览。完整解析数量，不使用parseFloat吞尾、静默取整或默认全部；count整数、g/ml小数、超量及容量沿既有正式预览校验。来源变化清空数量，改量/切页/其他命令/读档使旧预览失效；仍合法的普通拒绝输入保留供修改。

ProbeLifetime窄消费既有menu_preview/split_lot；ProbeInteraction显式区分preview、confirm和save/load，preview只认本次last_preview_result，不要求ActionResult；confirm仍经既有controller重预览，成功须本次双结果。新批次ID从本次created_objects关联刷新后的公开材料，数量/位置由公开结果取得，不从输入伪造。状态应用异常不自动重发Action；busy/销毁保护保持。

CocosWebProbe接真实cc.EditBox、单位/选择摘要、预览与确认Button；observer只读观察，不提供设置数量或派发业务捷径。既有拆分规则、Session/Queue、SaveFile、正式schema/config/fixture/expected、依赖版本与门禁算法保持。既有拆分不提供全量快捷按钮；既有加工页见trace.cocos.web-processing-loop，既有烹饪页见trace.cocos.web-cooking-loop，不扩Stage1B或wx。

tests/cocos-web-split.test.ts进入现有test.cocos-engine-probe-lifecycle的实际args/files/covers，test.cocos-web-verification-contracts校验拆分观察断言负例。trace.cocos.web-inventory-split连接这些行为及独立Creator SDK/构建、built-web和editor-preview各960×640真实点击与键盘输入；旧矩阵/resize/农事/转移/存读档/故障及销毁回归保留。桌面输入不代表触摸或微信通过，版本完成仍按q:full及无缓存q:release和精确候选CI。

## 网页加工开工至领取

trace.cocos.web-processing-loop连接CocosSelectableViewModel最小只读投影、ProbeProcessing.ts/.meta、ProbeLifetime/Interaction、真实CocosWebProbe及verify-web/support。readiness验证配置/任务数据与隔离，cocos-web-processing.test.ts随现有生命周期实际运行；prepare/lifecycle/verification与menu保持full/blocker。方法与逐要求选料、预览开工、任务与领取沿既有Action；旧视口/resize、农事、库存/拆分与存读档回归保持。

## 网页烹饪页面

CocosSelectableViewModel公开现有recipe/structure合并角色、操作硬边界/偏好、工具设施说明及当前燃料→ProbeCooking.ts/.meta管理逐角色选择和原文输入→CocosWebProbe第四页真实Button/EditBox→既有MenuActionBinding.cook_dish。preview/confirm、失败和真实DishLot按本次回传核对，手动读档重建选择，observer只读。trace.cocos.web-cooking-loop连接readiness/prepare/lifecycle/menu/verification，Node不代替Creator/浏览器；既有农事、库存/拆分、加工与存读档保持。

## 网页订单导航与验证

SelectableVM.order_options复制issuer_id、deadline_absolute_minute、signed minutes_until_deadline、正式需求的hard/weighted/defects/threshold、submitted refs和实际result_summary。订单名来自正式Profile文本，缺配置为null并不可用，嵌套数据全部独立副本。enabled只表示状态/时限及配置允许尝试，不保证所选菜品匹配；正/零截止余量和负余量来自当前绝对时间，不从day Label反算。StateVM及核心摘要保持。

ProbeOrders.ts/.meta只消费公共数据，管理第五页的显式单订单/单菜品本地选择和本次反馈，不改正式submitted_object_refs数组规则。终态可浏览、无菜品显示真实空态；浏览/选择0命令。preview只认本次校验，不伪造预计奖励；base_reward明确只是配置参考。确认沿既有menu→DraftBuilder→ActionPipeline，并以本次合法preview/ActionResult、实际Order.result_summary、所选菜品真实移除及公共金钱/声望变化关联成功，其他菜品保持。

确认前捕获order/dish与经济基线，避免成功patch先移除选择后误拒本次回执；错误或陈旧结果在ProbeInteraction发布completed前拒绝，应用失败不重发Action。改选择、切页、其他命令和load清旧预览/本次成功，历史结算另行展示；普通拒绝保留合法选择供修正，失效对象清除，不自动换菜品。busy/销毁迟到及本地单槽手动存读档保持。

tests/cocos-web-orders.test.ts实际进入既有lifecycle的args/files/covers，helper/.meta及测试同时登记prepare/lifecycle；readiness、menu与web-verification继续full/blocker。trace.cocos.web-orders-loop连接这些测试与源/地图，全部旧追踪保持。真实Creator/SDK和built/editor各960×640订单链、实际图检另行验收，保留原视口/resize、农事、库存拆分、加工、烹饪、存读档/故障与销毁。网页禁用重交只记0事件，正式状态/安全/低分拒绝由合法受控Node另验，不冒称微信或手机通过。

## 五点手动恢复验证

既有五页Button/EditBox与SaveLocal/LoadLocal保持；verify-web独立recoveryLoop从自然玩家操作建立五保存点，刷新/同context新页后真实手动读取并继续。trace.cocos.cross-step-recovery连接工具负例、公共bootstrap和既有Session/Queue/lifecycle保护；不新增observer业务捷径，真实Creator/SDK与built/editor输入另验，不代表触摸或微信。

## 触摸与小屏交互

CocosWebProbe消费ProbeLayout纯几何，在约定小屏使用原生ScrollView/Mask并订阅/清理resize；模板probe-viewport.js/css同步可视区。点击、滑动取消、滚动后输入与切页通过真实Button/EditBox验证，observer只读布局/滚动。trace.cocos.touch-small-screen保留旧桌面/经营/恢复链，约定尺寸及editor原生WebpageFullScreen验收边界见engine卡/契约。
