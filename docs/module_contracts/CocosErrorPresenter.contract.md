# Module Contract：CocosErrorPresenter

## 模块路径

`src/cocos-creator-adapter/errors/CocosErrorPresenter.ts`

## 职责

- 把未知错误和业务错误转换为 UI 可展示摘要。
- 保留错误 code / message / recoverable 等展示信息。
- 不改变业务状态，不吞掉架构错误。

## 允许依赖

- 普通 Error / unknown 处理。
- 表现层渲染快照类型。

## 禁止依赖

- SaveFile / GameState 直接读写。
- `ActionPipeline`。
- `SaveManager`。
- `cc / wx / fs`。

## 不变量

- 错误展示不是错误恢复。
- 错误 presenter 不得制造业务成功结果。
- load 失败后的状态保持由 session 负责，presenter 只呈现错误。

## 关联测试

```text
tests/cocos-error-presentation.test.ts
```
