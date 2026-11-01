# Domain Map — v0.0.2.40

## 系统职责

game-core 领域逻辑：库存、加工、烹饪、订单（需求）、存档、时间、ActionPipeline。

## 涉及模块

- `game-core`（module-graph）
- 子领域见 [`module-cards/`](../module-cards/)

## 关键文件

- `src/game-core/action/ActionPipeline.ts`
- `src/game-core/inventory/InventorySystem.ts`
- `src/game-core/processing/ProcessingSystem.ts`
- `src/game-core/cooking/CookingSystem.ts`
- `src/game-core/demand/DemandResolver.ts`
- `src/game-core/save/SaveManager.ts`

## 关键测试

- `tests/stage1a-contract.test.ts`
- `tests/stage1a-baseline.test.ts`
- `tests/stage1a-fixture-runner.test.ts`

## 修改前必读

- [`ARCHITECTURE.md`](../ARCHITECTURE.md)
- [`module-cards/game-core.md`](../module-cards/game-core.md)
- 正式三包 v1.5.2.2（玩法权威）

## 修改后必跑

- `npm run test:stage1a-baseline`
- `npm run q:affected -- --changed-files <your-files>`
- 完成前 `npm run q:full`

## 常见风险

- 绕过 ActionPipeline 写状态
- 表现层直接改 SaveFile
- 把 Stage 1B 能力写成本轮已实现

## 关联 module-cards

game-core, inventory, processing, cooking, orders, save-load

启动资源装配导航见[runtime-map](runtime-map.md)；校验器就绪能力属于运行基础边界，不定义新的领域玩法或正式Action。

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
