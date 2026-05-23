---
doc_type: module_card
status: active
applies_to: cocos-probe
source_of_truth: false
---

# orders

## 模块职责

订单与需求解析：当前实现入口为 `DemandResolver`（`src/game-core/demand/`），处理 submit_order 等领域逻辑。

## 不负责什么

- UI 订单面板（未进入 Stage 1B）
- 外部支付 / wx 接口

## 允许依赖

- game-core 内部

## 禁止依赖

- cocos、wx

## 关键文件

- `src/game-core/demand/DemandResolver.ts`
- `src/game-core/action/FormalStage1AActionCatalog.ts`

## 关键测试

- `tests/stage1a-fixture-runner.test.ts`

## 修改前必须读取

- `docs/module-cards/game-core.md`
- 正式三包订单相关契约

## 修改后必须运行

- `npm run test:fixture`

## 常见失败模式

- 把未实现的订单 UI 写为已交付

## 代码—地图同步

本卡对应 demand 目录；若将来拆分 `orders/` 目录须更新本卡与 code-index。
