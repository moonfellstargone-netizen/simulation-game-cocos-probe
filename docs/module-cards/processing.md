---
doc_type: module_card
status: active
applies_to: cocos-probe
source_of_truth: false
---

# processing

## 模块职责

加工系统：`ProcessingSystem`、`ProcessingConfigResolver` 与相关 formal action 处理。

## 不负责什么

- 烹饪逻辑（见 cooking）
- UI 绑定

## 允许依赖

- game-core 内部模块

## 禁止依赖

- cocos 层、wx、cc

## 关键文件

- `src/game-core/processing/ProcessingSystem.ts`
- `src/game-core/processing/ProcessingConfigResolver.ts`

## 关键测试

- `tests/stage1a-fixture-runner.test.ts`

## 修改前必须读取

- `docs/module-cards/game-core.md`

## 修改后必须运行

- `npm run test:fixture`

## 常见失败模式

- 加工 action 未注册到 ActionHandlerRegistry

## 代码—地图同步

domain-map 与 public-api（如有新 action 类型对外暴露）。
