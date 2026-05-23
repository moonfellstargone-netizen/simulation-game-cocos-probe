# Module Contract：CocosSessionHost

## 模块路径

`src/cocos-creator-adapter/CocosSessionHost.ts`

## 职责

- 创建、持有、释放 `CocosAppRuntimeSession`。
- 为 Creator lifecycle probe 提供 session 宿主边界。
- 防止组件层直接构造或泄漏核心运行时状态。

## 允许依赖

- `CocosAppRuntimeSession`。
- 平台无关的构造选项与端口。

## 禁止依赖

- `cc / wx / fs / node:fs`。
- `game-core/dev-api`。
- `game-core/testing-api`。
- fixture runner / headless runner。
- `GameState / SaveFile` 直接类型或直接字段修改。

## 不变量

- 生命周期层只能通过 session public 方法交互。
- `destroy` 后不得继续返回可用 session。
- 不得把 fixture ID 写成业务默认。

## 关联测试

```text
tests/cocos-creator-lifecycle-probe.test.ts
```
