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

## 拆分数量、定义占用与失败保护

正式split_lot要求请求和源数量为有效正数/finite，count保持整数，各单位整数请求须按请求原值扣减，partial须实际减少源；不新增g/ml最小量或一律整数限制。连续小数沿用Number舍入，未引入任意精度十进制语义。全量保留既有成功语义，归零源移出active inventory，新的正量批次保留inventory_split来源、lineage和旧源ID审计；该策略是兼容实现选择，不是正式包唯一指定的全量规则。

InventorySystem经ConfigRepository读取当前已加载材料/种子定义，按ceil(quantity/base_quantity*footprint)、正数至少1slot_weight分别重算源余量和新批次占用；不从已取整旧占用继续按比例缩放，也不以直接数量比较容器容量。Runtime及Farming/Processing/Cooking只传播构造依赖，consume算法不改。数量/定义拒绝发生在修改及ID分配前；容量失败沿既有事务恢复领域状态，已消耗ID不要求回滚。

trace.inventory.split-quantity连接InventorySystem及配置调用方，现有test.stage1a-contract、test.action-preview、test.cocos-session、test.cocos-menu验证完整状态、正/负例、定义变化、连续拆分、全量来源、预留/容量保护、公开预览与失败后存读档/健康恢复。正式资源、SaveFile、管线和核心规则保持；真实Creator与现有built/editor回归独立执行，网页拆分由trace.cocos.web-inventory-split独立真实输入验收，不从核心测试推定。

## 拆分只读校验与容量

InventorySystem.assertCanSplit与正式split复用同一拆分计划，按正式数量、单位、预留、定义和存储占用规则验证；只读校验不分配ID或提交状态。分发前的容量拒绝不会消耗拆分ID。StorageReconciler以相同占用顺序先计算再统一写回，成功规则保持；该共享对账也服务其他仓储动作和新局，异常时直接调用的中间写入行为与此前逐步写入不同，正式Action的异常依现有事务处理。

## 加工输入投影

InventorySystem.planConsumption以原有consume数量和占用算法按输入顺序构建只读库存投影；不改变正式重复批次语义。ProcessingSystem在实际消费前使用投影进行储存对账。
