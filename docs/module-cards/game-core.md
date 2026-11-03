---
doc_type: module_card
status: active
applies_to: cocos-probe
source_of_truth: false
---

# game-core

## 模块职责

核心游戏逻辑：ActionPipeline、GameRuntime、库存/加工/烹饪/需求/存档等领域系统。必须 engine-neutral、platform-neutral。

## 不负责什么

- UI 渲染、Cocos 生命周期、wx 存储
- 直接暴露给表现层的 SaveFile 写入口

## 允许依赖

- game-core 内部模块
- 标准库、ajv 等已声明依赖

## 禁止依赖

- `src/cocos-app/**`、`src/cocos-creator-adapter/**`
- `cc`、`wx`、`node:fs`、`fs`（见 module-graph）

## 关键文件

- `src/game-core/validation/RuntimeSchemaValidator.ts`
- `src/game-core/validation/RuntimeContractValidator.ts`
- `src/game-core/action/ActionPipeline.ts`
- `src/game-core/runtime/GameRuntime.ts`
- `src/game-core/index.ts`

## 关键测试

- `tests/stage1a-bootstrap.test.ts`（既有Schema和操作契约的就绪边界）
- `tests/stage1a-contract.test.ts`
- `tests/stage1a-baseline.test.ts`
- `tests/api-boundary.test.ts`

## 修改前必须读取

- `docs/ARCHITECTURE.md`
- `docs/adr/ADR-0002-actionpipeline-as-only-formal-state-entry.md`

## 修改后必须运行

- `npm run test:stage1a-bootstrap`
- `npm run test:stage1a-baseline`
- `npm run q:affected -- --changed-files src/game-core/<file>`

## 常见失败模式

- 新增非 formal action 路径
- 绕过 ActionPipeline 改状态
- Schema只注册未编译，导致资源引用或必要操作契约在运行后才暴露缺失

## 代码—地图同步

改动公开API或目录结构时更新`docs/code-index/public-api.md`与本卡。`assertSchemasAvailable(ids)`及`assertReady()`只检查既有契约可用性，不向game-core引入宿主、平台或资源读取依赖。

加工必需输入完整性见[processing模块卡](processing.md)及trace.processing.required-inputs；ProcessingSystem在消耗和任务ID分配前拒绝缺料，预览与正式执行沿既有ActionPipeline，保持领域状态及合法加工恢复。

## 持久ID恢复与预览一致性

IdService观察完整GameState的字符串值及记录键，恢复生成格式ID的每前缀高水位；这只决定技术ID分配，不用于判断材料身份。十进制字符串递增避免Number大后缀精度停滞。同一runtime高水位只升不降，GameRuntime包装全部已注册handler，使直接pipeline、Session和预览新runtime均在业务分配前恢复。ActionPipeline、存档结构与正式业务规则保持。

保证覆盖存档中仍存在的对象和任意历史引用，以及同一runtime已知分配；整个SaveFile已无任何记录的历史ID不能无新增持久化字段地恢复。预览不修改领域状态或正式ID服务；失败保持既有事务语义，不承诺请求序号或已分配ID回滚。

trace.runtime.id-recovery连接IdService.ts、GameRuntime.ts、CocosActionPreviewer.ts与Session；test.stage1a-contract、test.action-preview、test.cocos-session核对各对象/事件、历史引用、跨实例加载、极大后缀及合法恢复。该ID恢复能力不新增数量规则；网页拆分由outer单独提供，既有加工页独立消费正式加工，既有烹饪页消费既有cook_dish，不扩Stage1B或wx。真实Creator及既有built/editor浏览器回归独立执行，核心/Session回归与网页真实输入分别验收。

## 拆分数量、定义占用与失败保护

正式split_lot要求请求和源数量为有效正数/finite，count保持整数，各单位整数请求须按请求原值扣减，partial须实际减少源；不新增g/ml最小量或一律整数限制。连续小数沿用Number舍入，未引入任意精度十进制语义。全量保留既有成功语义，归零源移出active inventory，新的正量批次保留inventory_split来源、lineage和旧源ID审计；该策略是兼容实现选择，不是正式包唯一指定的全量规则。

InventorySystem经ConfigRepository读取当前已加载材料/种子定义，按ceil(quantity/base_quantity*footprint)、正数至少1slot_weight分别重算源余量和新批次占用；不从已取整旧占用继续按比例缩放，也不以直接数量比较容器容量。Runtime及Farming/Processing/Cooking只传播构造依赖，consume算法不改。数量/定义拒绝发生在修改及ID分配前；容量失败沿既有事务恢复领域状态，已消耗ID不要求回滚。

trace.inventory.split-quantity连接InventorySystem及配置调用方，现有test.stage1a-contract、test.action-preview、test.cocos-session、test.cocos-menu验证完整状态、正/负例、定义变化、连续拆分、全量来源、预留/容量保护、公开预览与失败后存读档/健康恢复。正式资源、SaveFile、管线和核心规则保持；真实Creator与现有built/editor回归独立执行，网页拆分由trace.cocos.web-inventory-split独立真实输入验收，不从核心测试推定。

## 订单合法状态与截止

DemandResolver与GameRuntime按[orders模块卡](orders.md)对齐available/accepted提交及now>deadline过期→expired，submitted仅在同步事务内部。失败保持提交前完整领域状态与事件，旧failed不迁移，ActionPipeline与SaveFile保持。trace.orders.legal-state-deadline连接既有核心、预览、Session和readiness测试；没有新增接单、聚合或页面业务。

## 显式预编译Schema集合

RuntimeSchemaValidator支持显式PrecompiledSchemaValidatorSet：format为runtime-precompiled-schemas/v1，schemaSources按完整资源路径记录JSON.stringify(schema)，validators按正式$id记录ValidateFunction。Stage1ABootstrapResources的可选precompiledValidators字段透明转交该集合。显式提供集合时不创建Ajv、不回退动态编译；完整路径/ID/内容不匹配、重复或无$id、无效/异步函数及非布尔结果均拒绝。未提供时Node/Web维持原Ajv路径。核心仍不接cc/wx/fs、工具或资源读取。

tests/runtime-precompiled-schema.test.ts进入现有test:stage1a-bootstrap / registry test.stage1a-bootstrap实际args/files/covers，沿用full/blocker，不新增任务或降低门禁。该测试覆盖禁用动态Function后的正式启动/合法动作及坏请求、集合/内容拒绝；微信preparation契约覆盖实际facade、全部Schema、来源与生成物篡改，资源预检标记为node-aot-public-bootstrap-passed。Web旧resourcePreflight和默认动态路径保持。Node不替代新提交的Creator/SDK、微信真实输入/日志/重载、Web回归或审查/CI。

函数实现的来源由构建生产链约束；核心只接收已解析Schema与函数集合，不导入Ajv standalone工具或读取生成文件。公开类型沿现有index.ts的export *自然导出，既有动态校验不变。
