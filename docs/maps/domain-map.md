# Domain Map — v0.0.2.31

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
