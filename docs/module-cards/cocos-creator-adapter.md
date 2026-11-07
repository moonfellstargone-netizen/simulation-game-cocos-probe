---
doc_type: module_card
status: active
applies_to: cocos-probe
source_of_truth: false
---

# cocos-creator-adapter

## 模块职责

纯TypeScript、engine-neutral的Creator适配探针：SessionHost、UI shell、menu/save-load binding、scene/component binding，以及从外部资源装配已ready宿主的bootstrap入口。

## 不负责什么

- 真实 Cocos 工程、Scene、Prefab
- wx 存储

## 允许依赖

- `cocos-app`、`game-core`（禁止 dev-api / testing-api 直接依赖）

## 禁止依赖

- `cc`、`wx`、`node:fs`

## 关键文件

- `src/cocos-creator-adapter/bootstrap/Stage1ABootstrap.ts`
- `src/cocos-creator-adapter/scene/CocosSceneBindingController.ts`
- `src/cocos-creator-adapter/component/QinglanUiSceneProbeComponent.ts`
- `src/cocos-creator-adapter/CocosSessionHost.ts`
- `src/cocos-creator-adapter/shell/CocosUiShellController.ts`
- `src/cocos-creator-adapter/shell/CocosUiCommandQueue.ts`
- `src/cocos-creator-adapter/menu/MinimalMenuInteractionController.ts`
- `src/cocos-creator-adapter/save/SaveLoadInteractionController.ts`

## 关键测试

- `tests/stage1a-bootstrap.test.ts`
- `tests/cocos-scene-binding-application.test.ts`
- `tests/cocos-component-node-binding-application.test.ts`
- `tests/support/controlledBindingPort.ts`（手动控制异步绑定，记录实际端口内容）
- `tests/cocos-ui-readiness.test.ts`
- `tests/cocos-minimal-menu-binding.test.ts`
- `tests/cocos-ui-shell-composition.test.ts`
- `tests/cocos-save-load-ui-binding.test.ts`
- `tests/cocos-ui-command-queue.test.ts`

## 修改前必须读取

- `docs/module_contracts/Stage1ABootstrap.contract.md`（装配边界说明；本模块卡仍为导航入口）
- `docs/maps/cocos-map.md`
- `docs/module_contracts/CocosSceneBindingController.contract.md`及scene/component端口与组件契约（按本模块卡定位边界说明）
- 相关 `docs/module_contracts/*.contract.md`

## 修改后必须运行

- `npm run test:stage1a-bootstrap`
- `npm run test:cocos-scene-binding`
- `npm run test:cocos-component-node-binding`
- `npm run test:cocos-ui-readiness`
- 涉及存储故障呈现与恢复时运行 `npm run test:cocos-save-load`、`npm run test:cocos-ui-command-queue`。

## 常见失败模式

- 把探针写成真实 Cocos 实现
- UI 命令队列当作业务事务
- 存储拒绝后旧成功结果未清除、错误未呈现或后续命令不再执行
- 资源未就绪即发布可用Host，或把Node集成结果当作真实Cocos兼容证明
- 对createStage1AHost返回的已创建Host再调用Probe.onLoad或createSession
- 异步绑定超出命令队列顺序、before在排队前读取或卸载被旧更新覆盖
- 绑定失败后普通diff漏掉未应用内容；将恢复错误地实现为重发Action或业务回滚
- 把实例级顺序承诺为全局锁，或端口重入等待同一控制器后续调用

## 绑定顺序与恢复

同一SceneBindingController实例的execute与applyInitialSnapshot按完整操作排序，组件生命周期复用该顺序。端口错误保持Promise拒绝，下一绑定操作全量同步当前四区；成功后恢复普通diff。diff仅表示Shell变化，恢复的applied_updates可全量，原因仍为initial_render。正式Action不重发、不回滚，端口部分副作用不保证撤销。

## 代码—地图同步

cocos-map、runtime-map、code-index/files.md与public-api.md；绑定顺序与恢复由`trace.cocos.binding-async-recovery`追踪，装配链路由`trace.runtime.bootstrap-resources`追踪。

## 跨操作结果归属

CocosUiCommandQueue按本次命令选择shell/menu/save_load错误来源，保留其他区历史错误；refresh和卸载不因历史面板失败而误报。本次失败返回独立且可观察，后续健康命令继续，不重发Action。Queue与公共bootstrap/component回归、外层本次反馈由trace.cocos.web-save-load-recovery连接，完整语义见CocosUiCommandQueue.contract.md。

## 正式store_item最小菜单适配

MenuActionBinding.ts从当前公开材料批次/储存目标解析选择，以MaterialLot object_ref和目标StorageRef调用cocos-app既有CocosActionDraftBuilder.storeItem；整批转移和split_lot适配均为既有公开能力，由既有outer消费。不直接修改SaveFile、不新增业务规则、不改变Session或Queue，不接cc/wx/fs。预览、执行和回滚沿现有MinimalMenuInteractionController路径。

tests/cocos-minimal-menu-binding.test.ts / test:cocos-menu验证预览不写状态、整批位置和源/目标占用、数量/身份/时间保持、失效/禁用/不支持形态/容量拒绝及后续健康恢复。trace.cocos.web-inventory-storage连接该适配与outer库存、地图和真实点击；同步cocos/runtime地图、files/public-api索引。

## 网页拆分公开复用

既有outer复用MenuActionBinding.split_lot、MinimalMenuInteractionController.preview/confirm及Queue.menu_preview；此模块执行源码保持，确认仍重预览最新Session，不以outer旧预览替代。见trace.cocos.web-inventory-split及engine模块卡。

## 网页加工公开复用

既有加工页消费MenuActionBinding.start_processing/collect_processing_result及MinimalMenuInteractionController.preview/confirm；菜单绑定和Queue源码保持。input_lots仍只有lot_id与quantity，requirement_index不传播为正式角色；确认重预览当前Session。新增app只读投影与outer行为见trace.cocos.web-processing-loop，未就绪/重复领取正式拒绝继续由现有menu/core测试分层验证。

## 网页烹饪公开复用

outer复用既有MenuActionBinding.cook_dish，以recipe_option_id、按角色ingredient_options、operation_profile和target_storage_option_id形成原正式草稿；本模块执行源码和Queue保持。缺必需角色可在绑定层command failed，UI不能借旧preview；confirm仍重预览当前Session并核本次ActionResult。trace.cocos.web-cooking-loop连接app只读补齐、outer和独立验收，不新建设施/工具选择参数。

## 网页订单的既有显式菜单消费

MenuActionBinding.submit_order保持order_option_id与dish_lot_option_ids[]显式参数，经现有preview/confirm构造正式submitted_object_refs；单菜品仅是ProbeOrders界面范围，不给核心数组新增maxItems。确认重预览并取本次ActionResult，StateVM/Session/Queue接口保持。订单需求和实际结果来自最小SelectableVM投影，节点、选择和本次反馈属于outer，见trace.cocos.web-orders-loop。

## 跨步骤恢复集成入口

trace.cocos.cross-step-recovery的tests/stage1a-bootstrap.test.ts从正式资源经公共bootstrap/Host和既有菜单/Queue覆盖五保存点加载后真实续玩，不借runtimeHarness私写状态代替装配。Host、SaveLoadController和Queue生产代码保持；沿既有全状态失败保护、暂态清除和销毁迟到边界。真实Creator/SDK与built/editor恢复独立留证。

## 可选Schema预编译输入

createStage1AHost的Stage1ABootstrapResources接受可选precompiledValidators，并仅转交RuntimeSchemaValidator.fromSnapshotSchemas。宿主装配和新局初始化仍在资源/契约就绪后交付，不增加平台API或文件读取。

RuntimeSchemaValidator支持显式PrecompiledSchemaValidatorSet：format为runtime-precompiled-schemas/v1，schemaSources在源侧按完整资源路径保留JSON.stringify(schema)原JSON绑定，validators按正式$id记录ValidateFunction。运行期将源JSON解析后与实际Schema作完整JSON语义规范化比较，仅允许Creator的对象键重排；字段集合、数组次序和全部嵌套值必须一致，不忽略未知字段、数组或数值变化，坏JSON和非JSON内容拒绝。原始Schema、预编译生成物和工具/产物的字节SHA来源仍严格，不因运行期对象键规范化而放宽。Stage1ABootstrapResources的可选precompiledValidators字段透明转交该集合。显式提供集合时不创建Ajv、不回退动态编译；完整路径/ID/内容不匹配、重复或无$id、无效/异步函数及非布尔结果均拒绝。未提供时Node/Web维持原Ajv路径。核心仍不接cc/wx/fs、工具或资源读取。

tests/runtime-precompiled-schema.test.ts进入现有test:stage1a-bootstrap / registry test.stage1a-bootstrap实际args/files/covers，沿用full/blocker，不新增任务或降低门禁。该测试覆盖禁用动态Function后的正式启动/合法动作及坏请求、集合/内容拒绝；微信preparation契约覆盖实际facade、全部Schema、来源与生成物篡改，资源预检标记为node-aot-public-bootstrap-passed。Web旧resourcePreflight和默认动态路径保持。Node不替代新提交的Creator/SDK、微信真实输入/日志/重载、Web回归或审查/CI。

## 拆分独立确认通道

共享Queue的menu_confirm_split_direct仅接受split_lot选择；同步解析当前选项并通过Session只读校验后才dispatch，结果记录last_split_validation_result与真实last_action_result，不调用session.preview。前置拒绝有明确校验回执；分发后异常或失败不能据此断言状态未提交。原menu_confirm、其他动作及Web先预览交互保持。

## 微信加工直接确认

menu_confirm_processing_direct限定start_processing和collect_processing_result，构建当前正式参数并独立校验，再经Session正式分发。前置validation失败与dispatch后的不确定结果区分，原menu_confirm和Web路径保持。
