# Module Contract：CocosUiShellController

## 模块路径

```text
src/cocos-creator-adapter/shell/CocosUiShellController.ts
src/cocos-creator-adapter/shell/CocosUiShellPresenter.ts
src/cocos-creator-adapter/shell/CocosUiShellRenderSnapshot.ts
src/cocos-creator-adapter/shell/CocosUiCommandQueue.ts
src/cocos-creator-adapter/shell/CocosUiShellSnapshotDiff.ts
src/cocos-creator-adapter/scene/CocosSceneBindingController.ts
```

## 职责

- 作为 TypeScript 层 engine-neutral UI Shell 组合探针。
- 组合 `CocosSessionHost`、`MinimalMenuInteractionController`、`SaveLoadInteractionController` 与 `CocosErrorPresenter`。
- 对外提供 create session、destroy session、refresh、menu preview、menu confirm、save、load 的统一壳层入口。
- 输出只读 `CocosUiShellRenderSnapshot`，合并 lifecycle、menu、save/load 与 shell-level errors。
- 允许由 `CocosUiShellCommandQueue` 作为外层 wrapper 串行化 UI shell 命令。
- 允许由 `diffCocosUiShellSnapshots` 比较前后 shell snapshot，生成轻量刷新摘要。
- 验证未来真实 Cocos Scene / Prefab 接入前的组合边界，不承担真实节点绑定。
- 允许 Scene Binding Boundary Stub 在外层消费 command result、snapshot diff 和 shell snapshot，并生成 UI 区域刷新意图。

## 允许依赖

- `CocosSessionHost`。
- `MinimalMenuInteractionController` 与 `MenuActionSelection`。
- `SaveLoadInteractionController` 与 `SaveSlotSelection`。
- `CocosErrorPresenter` 或由 shell presenter 间接使用的错误展示边界。
- `MenuRenderSnapshot`、`SaveLoadRenderSnapshot` 等只读表现层快照类型。
- `CocosUiShellCommandQueue` 与 `CocosUiShellSnapshotDiff` 只作为 shell 前置能力，不反向侵入 controller。

## 禁止依赖

- `cc / wx / fs / node:fs`。
- `game-core/dev-api`。
- `game-core/testing-api`。
- `Stage1AFixtureRunner`。
- `Stage1AHeadlessRuntime`。
- `Stage1AActionScriptRunner`。
- fixture ID、initial ID 或测试 step ID 作为业务默认。
- 直接读取、持有、暴露或修改 `GameState / SaveFile`。
- 直接调用 `ActionPipeline`、`SaveManager` 或任何 domain service 绕过 session/controller。

## 不变量

- UI Shell 只组合既有边界，不解释业务成功或失败。
- menu confirm 必须仍由 `MinimalMenuInteractionController -> session.dispatch -> ActionPipeline` 完成。
- save/load 必须仍由 `SaveLoadInteractionController -> session.save/load -> SaveManager -> SaveStoragePort` 完成。
- load 失败不得污染当前 session。
- shell-level error presenter 只呈现错误，不得修改业务结果。
- Shell 快照必须是只读渲染快照，不得暴露可变核心状态引用。
- Queue 是表现层命令排队，不是业务事务系统。
- Snapshot Diff 是节点绑定前置摘要，不是 JSON Patch 引擎。
- Scene Binding Boundary Stub 是抽象场景绑定边界，不是真实 Cocos 场景实现。

## 关联测试

```text
tests/cocos-ui-shell-composition.test.ts
tests/cocos-ui-command-queue.test.ts
tests/cocos-ui-render-diff.test.ts
tests/cocos-scene-binding-application.test.ts
tests/cocos-minimal-menu-binding.test.ts
tests/cocos-save-load-ui-binding.test.ts
tests/cocos-error-presentation.test.ts
tests/cocos-creator-lifecycle-probe.test.ts
```
