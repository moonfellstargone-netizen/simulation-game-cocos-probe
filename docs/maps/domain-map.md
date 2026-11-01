# Domain Map — v0.0.2.38

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

trace.runtime.id-recovery连接IdService.ts、GameRuntime.ts、CocosActionPreviewer.ts与Session；test.stage1a-contract、test.action-preview、test.cocos-session核对各对象/事件、历史引用、跨实例加载、极大后缀及合法恢复。未新增拆分数量规则、网页拆分/加工、Stage1B或wx。真实Creator及既有built/editor浏览器回归独立执行，网页未覆盖的拆分路径由公开核心/Session验收。
