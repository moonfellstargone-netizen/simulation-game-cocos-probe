# Module Contract：CocosUiShellSnapshotDiff

## 模块路径

```text
src/cocos-creator-adapter/shell/CocosUiShellSnapshotDiff.ts
```

## 职责

- 比较 before / after 两个 `CocosUiShellRenderSnapshot`。
- 输出稳定、轻量、可测试的 `CocosUiShellSnapshotDiff`。
- 为未来真实节点绑定提供“哪些区域需要刷新”的前置摘要。
- 固定比较 section：`lifecycle / menu / save_load / errors`。

## 允许依赖

- `CocosUiShellRenderSnapshot`。
- `CocosUiShellOperation`。

## 禁止依赖

- `cc / wx / fs / node:fs`。
- `game-core/dev-api`。
- `game-core/testing-api`。
- `Stage1AFixtureRunner`。
- `Stage1AHeadlessRuntime`。
- `Stage1AActionScriptRunner`。
- 直接读取、持有、暴露或修改 `GameState / SaveFile`。
- 真实节点、Prefab、Scene、动画或平台 storage API。

## 不变量

- Diff 是节点绑定前置摘要，不是 JSON Patch 引擎。
- Diff 只读比较 snapshot，不得修改输入。
- `changed_sections` 顺序必须稳定：`lifecycle -> menu -> save_load -> errors`。
- 相同 snapshot 必须返回空 `changed_sections`。
- preview、confirm、save、load、load 失败后的可见变化必须能被测试识别。

## 关联测试

```text
tests/cocos-ui-render-diff.test.ts
tests/cocos-ui-shell-composition.test.ts
```
