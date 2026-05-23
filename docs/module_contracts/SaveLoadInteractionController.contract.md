# Module Contract：SaveLoadInteractionController

## 模块路径

`src/cocos-creator-adapter/save/SaveLoadInteractionController.ts`

## 职责

- 把 UI 存档槽位映射为 storage key。
- 通过 `CocosSessionHost` 获取 session。
- 通过 `session.save / session.load` 执行存档读写。
- 通过 presenter 输出只读 save/load 渲染快照。
- 将错误交给错误展示边界，不自行解释业务状态。

## 允许依赖

- `CocosSessionHost`。
- `SaveLoadPresenter`。
- `SaveSlotBinding`。
- `CocosErrorPresenter`。

## 禁止依赖

- `cc / wx / fs / node:fs`。
- `game-core/dev-api`。
- `game-core/testing-api`。
- `SaveFile / GameState` 直接读写。
- 直接调用 `SaveManager` 绕过 session。

## 不变量

- save/load UI 层不得接触 SaveFile。
- load 失败不得污染当前 session。
- load 成功后必须刷新 view/selectable snapshot。
- 错误展示只能呈现错误，不得改变业务结果。

## 关联测试

```text
tests/cocos-save-load-ui-binding.test.ts
tests/cocos-error-presentation.test.ts
```
