---
doc_type: module_card
status: active
applies_to: cocos-probe
source_of_truth: false
---

# inventory

## 模块职责

库存与物料批次：`InventorySystem`、`MaterialLotFactory`、存储占用与 reconciliation 相关逻辑。

## 不负责什么

- UI 展示
- 存档 IO（由 SaveManager + SaveStoragePort 负责）

## 允许依赖

- game-core 内部：domain、storage、shared

## 禁止依赖

- cocos-app、cocos-creator-adapter、cc、wx

## 关键文件

- `src/game-core/inventory/InventorySystem.ts`
- `src/game-core/inventory/MaterialLotFactory.ts`
- `src/game-core/storage/StorageSystem.ts`

## 关键测试

- `tests/stage1a-fixture-runner.test.ts`
- `tests/stage1a-baseline.test.ts`

## 修改前必须读取

- `docs/module-cards/game-core.md`

## 修改后必须运行

- `npm run test:fixture`

## 常见失败模式

- 存储状态与 SaveFile 不一致
- 绕过 ActionPipeline 改库存

## 代码—地图同步

更新 `docs/maps/domain-map.md` 关键文件列表（如有路径变更）。
