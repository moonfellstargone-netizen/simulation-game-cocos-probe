# Module Contract：CocosUiCommandQueue

## 模块路径

```text
src/cocos-creator-adapter/shell/CocosUiCommandQueue.ts
```

## 职责

- 作为 TypeScript 层 engine-neutral UI Shell 命令队列。
- 串行执行 `create_session / destroy_session / refresh / menu_preview / menu_confirm / save / load`。
- 统一同步与异步命令入口。
- 每个命令执行后返回 `CocosUiShellRenderSnapshot`。
- 记录最近一次命令状态：`idle / running / completed / failed`。
- 命令失败后暴露 failed 状态和错误 snapshot，但后续命令默认继续执行。

## 允许依赖

- `CocosUiShellController`。
- `CocosUiShellRenderSnapshot`。
- `MenuActionSelection`。
- `SaveSlotSelection`。

## 禁止依赖

- `cc / wx / fs / node:fs`。
- `game-core/dev-api`。
- `game-core/testing-api`。
- `Stage1AFixtureRunner`。
- `Stage1AHeadlessRuntime`。
- `Stage1AActionScriptRunner`。
- 直接读取、持有、暴露或修改 `GameState / SaveFile`。
- 直接调用 `ActionPipeline`、`SaveManager` 或任何 domain service 绕过 session/controller。
- fixture ID、initial ID 或测试 step ID 作为业务默认。

## 不变量

- Queue 是表现层命令排队，不是业务事务系统。
- Queue 不负责业务回滚、补偿、存档替换或玩法结算。
- confirm 必须最终走 `CocosUiShellController -> MinimalMenuInteractionController -> session.dispatch -> ActionPipeline`。
- save/load 必须最终走 `CocosUiShellController -> SaveLoadInteractionController -> session.save/load -> SaveManager -> SaveStoragePort`。
- load 失败不得污染当前 session；该不变量由既有 save/load/session 边界保证，Queue 不得破坏。
- 前一个命令失败后，后续命令默认继续按入队顺序执行。

## 关联测试

```text
tests/cocos-ui-command-queue.test.ts
tests/cocos-ui-shell-composition.test.ts
tests/cocos-save-load-ui-binding.test.ts
tests/cocos-minimal-menu-binding.test.ts
```
