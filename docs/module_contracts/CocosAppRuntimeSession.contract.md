# Module Contract：CocosAppRuntimeSession

## 模块路径

`src/cocos-app/runtime/CocosAppRuntimeSession.ts`

## 职责

- 持有当前运行时 session 状态。
- 暴露 `dispatch / preview / getViewModel / getSelectableViewModel / save / load`。
- 通过 `CocosActionDispatcher -> ActionPipeline` 提交正式状态变化。
- 通过 `SaveManager + SaveStoragePort` 完成平台无关存档读写。
- 在 `dispatch` 和成功 `load` 后执行 SaveFile schema validation 与 StorageAudit。

## 允许依赖

- `src/game-core/index.ts` public runtime API。
- `CocosActionDispatcher`、`CocosRuntimeFacade`、`CocosActionPreviewer`。
- `SaveManager`、`SaveStoragePort`。

## 禁止依赖

- `game-core/dev-api`。
- `game-core/testing-api`。
- `Stage1AFixtureRunner`。
- `Stage1AHeadlessRuntime`。
- `cc / wx / fs / node:fs`。

## 不变量

- 正式状态变化只能走 ActionPipeline。
- `preview` 不得改变真实 SaveFile。
- `load` 失败不得污染当前 session。
- 不得向 UI 暴露可变 SaveFile 引用。

## 关联测试

```text
tests/cocos-runtime-session.test.ts
tests/cocos-save-load-ui-binding.test.ts
tests/action-preview-boundary.test.ts
tests/stage1a-baseline.test.ts
```
