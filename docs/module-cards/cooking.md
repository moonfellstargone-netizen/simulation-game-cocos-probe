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
