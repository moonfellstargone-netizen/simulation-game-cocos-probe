# Module Contract：CocosComponentNodeBindingPort

## 模块路径

```text
src/cocos-creator-adapter/component/CocosComponentNodeBindingPort.ts
src/cocos-creator-adapter/component/CocosComponentNodeBindingAdapter.ts
```

## 职责

- Component Node Binding Adapter Probe 是 `CocosSceneBindingPort` 之后、未来真实 Cocos 节点绑定之前的组件节点绑定适配层。
- 将 lifecycle / menu / save_load / errors 四个 scene section 映射为稳定 node target：`lifecycle_panel / menu_panel / save_load_panel / error_panel`。
- 将 `CocosSceneBindingUpdate` 转换为 `CocosComponentNodeBindingPatch`，交给外部节点绑定端口。
- 提供 `RecordingCocosComponentNodeBindingPort` 用于纯 TypeScript 测试与审计。
- 只表达“哪个 UI 节点区域应该刷新、是否可见、刷新载荷是什么”，不操作真实节点。

## 允许依赖

- `CocosSceneBindingPort`。
- `CocosSceneBindingUpdate`。
- `CocosUiShellOperation`。

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

- Component Node Binding Adapter 只能消费 scene binding updates，不得直接执行 shell command。
- Adapter 不得生成业务 action，不得解释业务成功或失败。
- Patch payload 必须拷贝，避免外部节点端口反向污染 shell snapshot。
- errors section 为空时 `error_panel` 应标记为不可见；非 error section 默认可见。
- section 到 target 的映射顺序和命名必须稳定，便于未来真实 Cocos 组件逐步接入。
- `applyNodeBindingPatch`允许同步或异步完成。适配器等待端口并保留原拒绝，不生成业务失败或尝试回滚已经提交的Action。
- 在同一场景控制器管理下，节点批次与命令共享顺序；部分patch失败后由下一绑定操作全量重同步当前视图。不保证撤销已经发生的节点副作用，直接调用adapter或多个控制器不具备共享全局锁。

## 关联测试

```text
tests/cocos-component-node-binding-boundary.test.ts
tests/cocos-component-node-binding-application.test.ts
tests/cocos-scene-binding-application.test.ts
```
