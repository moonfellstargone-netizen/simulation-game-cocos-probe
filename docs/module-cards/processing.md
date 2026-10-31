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
- `tests/stage1a-contract.test.ts`
- `tests/action-preview-boundary.test.ts`
- `tests/cocos-runtime-session.test.ts`
- `tests/cocos-minimal-menu-binding.test.ts`

## 修改前必须读取

- `docs/module-cards/game-core.md`

## 修改后必须运行

- `npm run test:fixture`
- `npm run test:contract`
- `npm run test:action-preview-boundary`
- `npm run test:cocos-session`
- `npm run test:cocos-menu`

## 常见失败模式

- 加工action未注册到ActionHandlerRegistry
- 只验证已提交输入而未核对全部配置必需项，导致缺料仍开工
- 缺料在材料消耗或任务对象ID分配之后才拒绝
- 仅核对公开Selectable而遗漏完整领域状态、缓存和事件变化

## 代码—地图同步

domain-map 与 public-api（如有新 action 类型对外暴露）。

必需输入校验及失败后健康加工/存读档恢复由trace.processing.required-inputs追踪。数量和材料门槛来自当前配置，重复输入语义不得由实现推断成新规则。
