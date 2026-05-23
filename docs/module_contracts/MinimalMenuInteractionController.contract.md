# Module Contract：MinimalMenuInteractionController

## 模块路径

`src/cocos-creator-adapter/menu/MinimalMenuInteractionController.ts`

## 职责

- 执行 `selectable -> draft -> preview -> confirm dispatch -> refresh` 的最小菜单交互流程。
- 通过 `CocosSessionHost` 获取 session。
- 通过 `MenuActionBinding` 把 selectable option 转为 formal action draft。
- 通过 presenter 输出只读菜单渲染快照。

## 允许依赖

- `CocosSessionHost`。
- `MenuActionBinding`。
- `MinimalMenuPresenter`。
- session public 方法：`getSelectableViewModel / preview / dispatch / getViewModel`。

## 禁止依赖

- `cc / wx / fs / node:fs`。
- `game-core/dev-api`。
- `game-core/testing-api`。
- `Stage1AFixtureRunner`。
- fixture / initial ID 作为业务默认。
- 直接修改 SaveFile 或业务集合。

## 不变量

- preview 必须无副作用。
- confirm 必须最终走 `session.dispatch -> ActionPipeline`。
- 菜单项必须来自 selectable ViewModel，不能硬编码当前 fixture ID。

## 关联测试

```text
tests/cocos-minimal-menu-binding.test.ts
tests/cocos-ui-readiness.test.ts
```
