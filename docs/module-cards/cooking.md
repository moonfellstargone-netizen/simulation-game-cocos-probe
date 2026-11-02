---
doc_type: module_card
status: active
applies_to: cocos-probe
source_of_truth: false
---

# cooking

## 模块职责

烹饪系统：`CookingSystem`、`CookingConfigResolver`。

## 不负责什么

- 订单提交与结算（见 orders）
- 表现层菜单

## 允许依赖

- game-core 内部

## 禁止依赖

- cocos、wx、cc

## 关键文件

- `src/game-core/cooking/CookingSystem.ts`
- `src/game-core/cooking/CookingConfigResolver.ts`

## 关键测试

- `tests/stage1a-fixture-runner.test.ts`

## 修改前必须读取

- `docs/module-cards/game-core.md`

## 修改后必须运行

- `npm run test:fixture`

## 常见失败模式

- cook_dish action 与配置 resolver 不一致

## 代码—地图同步

更新 domain-map 关键文件（路径变更时）。

拆分占用修复使InventorySystem接收ConfigRepository，本模块仅传播现有配置依赖，原consume和业务规则保持；追踪trace.inventory.split-quantity。

## 网页烹饪的领域消费

本版CookingSystem/CookingConfigResolver源码保持；app只读投影按当前合并角色约束、操作校验和燃料逻辑提供网页选择说明，outer经已有cook_dish执行。配置偏好与实际硬校验分开，不补扣时间/体力或新增工具设施消耗，不新增配方、补给或通用菜品搬运。

trace.cocos.web-cooking-loop连接CocosSelectableViewModel、ProbeCooking、readiness及公开Host/Component行为与独立真实输入；预览无副作用、储存/受控燃料失败回滚及健康恢复分层验证。普通网页只验证自然材料与燃料扣减，不能将受控Node燃料不足写成普通玩家耗尽。
