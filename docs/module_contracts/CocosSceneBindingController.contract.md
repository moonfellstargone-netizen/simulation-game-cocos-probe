# Module Contract：CocosSceneBindingController

## 模块路径

```text
src/cocos-creator-adapter/scene/CocosSceneBindingController.ts
src/cocos-creator-adapter/scene/index.ts
```

## 职责

- 组合 `CocosUiShellController`、`CocosUiShellCommandQueue`、`diffCocosUiShellSnapshots`、`CocosSceneBindingSnapshotApplier` 与 `CocosSceneBindingPort`。
- 在本实例排队操作真正开始时、执行shell command前读取before snapshot，在Queue执行后读取after snapshot。
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
- 本实例的`execute`与`applyInitialSnapshot`共享完整操作顺序，直到全部端口更新结束后才处理下一调用；不是跨controller或外部Host调用的全局锁。
- 绑定端口同步抛错或Promise拒绝仍使当前调用以原错误拒绝，内部排队不被失败阻断。业务命令可能已提交，不能重发正式Action或回滚已提交状态。
- 端口批次失败后视图需要重同步，下一次绑定操作全量应用当前lifecycle/menu/save_load/errors四区；全部成功后恢复普通diff。恢复再次失败时仍需重同步。
- `diff`表示Shell前后差异，`applied_updates`表示实际提交给端口并完成的更新；恢复时可包含diff之外的全量四区，原因仍为`initial_render`。发生拒绝时不返回伪造成功的批次结果。
- 顺序保证不撤销端口已产生的部分副作用，也不保证取消永不完成的端口Promise。端口实现不能等待自己触发的同一控制器后续调用完成，否则会造成重入等待。

由`trace.cocos.binding-async-recovery`连接本控制器、creator模块卡和两个既有full/blocker绑定任务。测试通过手动延迟/拒绝记录端口实际内容，不以返回快照替代节点状态验证。

## 关联测试

```text
tests/cocos-scene-binding-boundary.test.ts
tests/cocos-scene-binding-application.test.ts
tests/cocos-ui-command-queue.test.ts
tests/cocos-ui-shell-composition.test.ts
```
