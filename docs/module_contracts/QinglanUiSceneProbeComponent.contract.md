# Module Contract：QinglanUiSceneProbeComponent

## 模块路径

```text
src/cocos-creator-adapter/component/QinglanUiSceneProbeComponent.ts
src/cocos-creator-adapter/component/index.ts
```

## 职责

- 作为未来真实 Cocos Component 的 TypeScript 最小探针，不继承 `cc.Component`。
- 组合 `CocosUiShellController`、`CocosSceneBindingController` 与 `CocosComponentNodeBindingAdapter`。
- 提供 `mount / refresh / execute / applyInitialSnapshot / unmount`，验证组件层如何驱动 shell command 并把刷新结果交给节点绑定端口。
- 为真实 Cocos 节点脚本接入前提供可测试、可审计的组件边界。

## 允许依赖

- `CocosSessionHost`。
- `CocosUiShellController`。
- `CocosUiShellCommand`。
- `CocosSceneBindingController`。
- `CocosComponentNodeBindingAdapter`。
- `CocosComponentNodeBindingPort`。

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

- `mount` 必须通过 shell command `create_session` 建立 session，而不是直接操作 session 内部状态。
- `execute` 必须通过 `CocosSceneBindingController` 间接进入 Queue / Shell / Session / ActionPipeline 路径。
- `unmount` 必须通过 shell command `destroy_session` 释放 session。
- 组件探针不保存每轮具体任务上下文，也不承担正式玩法逻辑。
- load 失败不得污染当前 session；组件层只能观察并转发错误刷新 patch。

## 关联测试

```text
tests/cocos-component-node-binding-boundary.test.ts
tests/cocos-component-node-binding-application.test.ts
tests/cocos-scene-binding-application.test.ts
```
