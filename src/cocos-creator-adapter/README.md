# cocos-creator-adapter 边界

本目录是 Cocos Creator 最小生命周期探针层，不是真实 Cocos Creator 场景或节点脚本。

## 当前职责

- `CocosSessionHost` 创建、持有、释放 `CocosAppRuntimeSession`。
- `QinglanSessionProbeComponent` 模拟 `onLoad / start / onDestroy` 生命周期。
- `CocosUiBindingPort` 只定义渲染端口，不承载业务逻辑。
- 生命周期层只能调用 session 的 `getViewModel / getSelectableViewModel / preview / dispatch / save / load`。

## 禁止事项

- 不导入 `cc`。
- 不导入 `wx`。
- 不导入 `game-core/dev-api`。
- 不导入 `game-core/testing-api`。
- 不调用 fixture runner 或 headless runner。
- 不直接读取、持有、暴露或修改 `GameState / SaveFile`。
- 不硬编码 fixture ID 作为业务默认。

测试可以使用固定 fixture ID 验证链路，但宿主组件不能把这些 ID 写成业务默认值。

## menu 子目录

`menu/` 是最小菜单 UI 绑定探针层，用于验证 selectable -> draft -> preview -> confirm dispatch -> refresh 流程。它仍不是 Scene、Prefab 或真实节点脚本。

菜单层只能通过 `CocosSessionHost` 与 session public 入口交互，不得导入 `cc / wx / dev-api / testing-api`，不得内置 fixture/初始 ID 作为业务默认。

## save 子目录

`save/` 是存档/读档 UI 绑定探针层，用于验证 save/load 如何通过 `CocosSessionHost -> CocosAppRuntimeSession -> SaveManager -> SaveStoragePort` 接入。它仍不是 Scene、Prefab 或真实节点脚本，也不接真实 `wx` storage。

存档/读档层不得直接读取、持有、暴露或修改 `GameState / SaveFile`，不得导入 `cc / wx / node:fs / fs / dev-api / testing-api`。

## errors 子目录

`errors/` 是错误提示探针层，只负责把错误转换为可展示摘要，不改变业务结果，不接触核心状态。


## scene 子目录

`scene/` 是 UI Shell 到未来真实 Cocos Component / Node Binding 之间的 Scene Binding Boundary Stub。它只生成 scene binding updates，不操作真实节点，不读取核心状态。

## component 子目录

`component/` 是组件节点绑定适配探针层，用于验证 `CocosSceneBindingUpdate -> CocosComponentNodeBindingPatch -> node binding port` 的边界。它不是真实 `cc.Component`，不导入 `cc / wx / fs`，也不接触 `GameState / SaveFile`。未来真实 Cocos 组件只能实现节点绑定端口或包一层薄适配，不得绕过 Shell / Session / ActionPipeline。
