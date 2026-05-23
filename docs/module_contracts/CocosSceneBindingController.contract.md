# Module Contract：CocosSceneBindingController

## 模块路径

```text
src/cocos-creator-adapter/scene/CocosSceneBindingController.ts
src/cocos-creator-adapter/scene/index.ts
```

## 职责

- 组合 `CocosUiShellController`、`CocosUiShellCommandQueue`、`diffCocosUiShellSnapshots`、`CocosSceneBindingSnapshotApplier` 与 `CocosSceneBindingPort`。
- 在执行 shell command 前读取 before snapshot，在 Queue 执行后读取 after snapshot。
- 生成 snapshot diff，并把变化 section 转换为 scene binding updates。
- 将 updates 交给 binding port，并返回 command result、diff 与 applied updates。
- 作为真实 Cocos Component / Node Binding 前的 engine-neutral 边界桩。

## 允许依赖

- `CocosUiShellController`。
- `CocosUiShellCommandQueue`。
- `CocosUiShellCommandExecutionResult`。
- `diffCocosUiShellSnapshots`。
- `CocosSceneBindingPort`。
- `CocosSceneBindingSnapshotApplier`。

## 禁止依赖

- `cc / wx / fs / node:fs`。
- `game-core/dev-api`。
- `game-core/testing-api`。
- `Stage1AFixtureRunner`。
- `Stage1AHeadlessRuntime`。
- `Stage1AActionScriptRunner`。
- 直接读取、持有、暴露或修改 `GameState / SaveFile`。
- 核心业务集合字段。
- 直接调用 `ActionPipeline`、`SaveManager` 或任何 domain service 绕过 session/controller。
- 真实节点、Prefab、Scene、动画或平台 storage API。

## 不变量

- 正式状态变化仍由 `CocosUiShellCommandQueue -> CocosUiShellController -> CocosAppRuntimeSession -> ActionPipeline` 完成。
- Scene Binding Controller 只管“执行后如何把差异交给绑定端口”。
- Scene Binding Controller 不自行构造业务 action。
- Scene Binding Controller 不直接 mutate session / save / runtime state。
- load 失败不得污染当前 session；该不变量由既有 save/load/session 边界保证，Scene Binding 不得破坏。
- 命令失败后，绑定层必须能观察错误状态；后续命令仍可进入队列。

## 关联测试

```text
tests/cocos-scene-binding-boundary.test.ts
tests/cocos-scene-binding-application.test.ts
tests/cocos-ui-command-queue.test.ts
tests/cocos-ui-shell-composition.test.ts
```
