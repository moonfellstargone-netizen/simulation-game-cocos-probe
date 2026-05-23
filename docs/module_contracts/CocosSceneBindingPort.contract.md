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
- 初始渲染按 lifecycle / menu / save_load / errors 全量刷新；普通 diff 只刷新变化 section。
- 无变化快照不产生多余刷新。

## 关联测试

```text
tests/cocos-scene-binding-boundary.test.ts
tests/cocos-scene-binding-application.test.ts
tests/cocos-ui-render-diff.test.ts
```
