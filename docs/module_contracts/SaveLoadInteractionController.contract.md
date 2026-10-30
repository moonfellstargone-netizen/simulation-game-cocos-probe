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

## 存储故障展示与恢复

- 每次 save/load 开始前清除上次 save/load 成功摘要及错误；本次失败 snapshot 不得残留上次成功结果。
- 端口读写拒绝由既有错误展示器转换为只读错误 snapshot。普通错误没有 `ERR_` 标记时，code 为 `null`，仍保留 message。
- 失败后刷新当前 session 的公开视图与可选视图；不得为展示错误而替换或清空游戏状态。
- 恢复后的正常调用清除旧错误并呈现本次成功摘要；Controller 不补造成功、不承担底层写入回滚，也不新增稳定错误码。

## 关联测试

```text
tests/cocos-save-load-ui-binding.test.ts
tests/cocos-error-presentation.test.ts
```
