# Module Contract：CocosSceneBindingPort

## 模块路径

```text
src/cocos-creator-adapter/scene/CocosSceneBindingPort.ts
src/cocos-creator-adapter/scene/CocosSceneBindingSnapshotApplier.ts
```

## 职责

- 作为 UI Shell 与未来真实 Cocos Component / Node Binding 之间的抽象刷新端口。
- 消费 `CocosSceneBindingUpdate`，描述 lifecycle / menu / save_load / errors 四个 UI 区域的刷新意图。
- 提供 `RecordingCocosSceneBindingPort` 作为纯 TypeScript 测试记录端口。
- 由 `CocosSceneBindingSnapshotApplier` 将 `CocosUiShellSnapshotDiff` 转换为稳定顺序的 scene binding updates。
- 验证未来真实场景绑定前的更新粒度，不承担真实节点绑定。

## 允许依赖

- `CocosUiShellRenderSnapshot`。
- `CocosUiShellOperation`。
- `CocosUiShellSnapshotDiff`。

## 禁止依赖

- `cc / wx / fs / node:fs`。
- `game-core/dev-api`。
- `game-core/testing-api`。
- `Stage1AFixtureRunner`。
- `Stage1AHeadlessRuntime`。
- `Stage1AActionScriptRunner`。
- 直接读取、持有、暴露或修改 `GameState / SaveFile`。
- 核心业务集合字段。
- 真实节点、Prefab、Scene、动画或平台 storage API。

## 不变量

- Scene Binding Port 只表达 UI 区域刷新意图，不执行业务 action。
- Scene Binding Port 不负责存档读写。
- Scene Binding Port 不负责业务错误生成，只显示 shell / presenter 已提供的错误状态。
- `changed_sections` 转换后的 updates 顺序必须稳定。
- 初始渲染按 lifecycle / menu / save_load / errors 全量刷新；健康的普通diff只刷新变化section。失败后下一绑定操作也按同一顺序全量重同步，原因仍为`initial_render`。
- 无变化快照不产生多余刷新，适用于健康且无需重同步的普通diff；显式初始渲染及失败恢复允许全量更新。
- `applySceneBindingUpdate`允许同步完成或返回Promise。同步抛错和Promise拒绝均原样传回调用方，不被改写成业务Action失败，也不保证撤回已应用的section。
- 同一SceneBindingController等待整个批次完成后处理下一操作；直接操作端口或多个控制器不在该实例顺序保证内。端口不能等待自己触发的同实例后续调用，以免重入等待。

## 关联测试

```text
tests/cocos-scene-binding-boundary.test.ts
tests/cocos-scene-binding-application.test.ts
tests/cocos-ui-render-diff.test.ts
```
