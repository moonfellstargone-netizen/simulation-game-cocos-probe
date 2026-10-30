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

## 通过启动装配入口取得的宿主

`createStage1AHost`成功返回的Host已完成Session创建与既有新局校验，调用方可requireSession或交给现有UI Shell/Queue使用，结束时调用destroySession。不要再直接调用host.createSession，也不要让`QinglanSessionProbeComponent.onLoad`对同一Host二次创建会话。

现有未初始化Host的组件探针生命周期保持原有行为；装配入口的资源检查和失败边界见[Stage1ABootstrap契约](Stage1ABootstrap.contract.md)。本Host不读取资源，不成为正式配置或Schema权威。

## 关联测试

```text
tests/cocos-creator-lifecycle-probe.test.ts
tests/stage1a-bootstrap.test.ts
```
