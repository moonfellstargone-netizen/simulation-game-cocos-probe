# Module Contract：CocosActionDraftBuilder

## 模块路径

`src/cocos-app/adapters/CocosActionDraftBuilder.ts`

## 职责

- 把 UI/selectable 选择转换为 formal Action parameters。
- 验证 action type 和参数基本形态。
- 只构造请求草稿，不执行业务状态变化。

## 允许依赖

- formal Stage 1A action catalog。
- public action request 类型。

## 禁止依赖

- fixture ID 作为业务默认。
- SaveFile 直接读写。
- `Stage1AFixtureRunner`。
- `cc / wx / fs`。

## 不变量

- 不得重复维护 formal action 列表。
- 不得把测试里的初始 ID 写成默认业务参数。
- 不得越过 selectable ViewModel 自行猜测对象。

## 关联测试

```text
tests/cocos-ui-readiness.test.ts
tests/action-request-builder.test.ts
```
