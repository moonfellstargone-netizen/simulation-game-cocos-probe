# Module Contract：CocosActionPreviewer

## 模块路径

`src/cocos-app/adapters/CocosActionPreviewer.ts`

## 职责

- 在克隆状态和独立 runtime 中模拟 formal Action。
- 复用正式 ActionPipeline 校验。
- 返回 preview 摘要，不写真实 DomainEvent，不消耗真实 ID 序列。

## 允许依赖

- `GameRuntime`。
- `ActionPipeline`。
- `ActionRequestBuilder`。
- public runtime API。

## 禁止依赖

- 真实 session 可变 SaveFile。
- `preview_only` 作为正式 dispatch 捷径。
- `Stage1AFixtureRunner`。
- `cc / wx / fs`。

## 不变量

- preview 无副作用。
- preview 失败不能影响真实 session。
- preview 与正式 dispatch 必须共享业务校验路径。

## 关联测试

```text
tests/action-preview-boundary.test.ts
```
