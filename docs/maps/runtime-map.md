# Runtime Map — v0.0.2.28

## 系统职责

运行时入口：GameRuntime、ActionPipeline、Session、headless dev runner。

## 涉及模块

- `game-core`
- `cocos-app`
- `scripts`

## 关键文件

- `src/game-core/runtime/GameRuntime.ts`
- `src/game-core/dev/Stage1AHeadlessRuntime.ts`
- `src/cocos-app/runtime/CocosAppRuntimeSession.ts`
- `scripts/run-stage1a-headless.ts`

## 关键测试

- `tests/stage1a-headless-runtime.test.ts`
- `tests/cocos-runtime-session.test.ts`
- `tests/dev-runner`（package script: `test:dev-runner`）

## 修改前必读

- [`module-cards/cocos-app.md`](../module-cards/cocos-app.md)
- [`code-index/public-api.md`](../code-index/public-api.md)

## 修改后必跑

- `npm run test:dev-runner`
- `npm run test:cocos-session`

## 常见风险

- load 失败污染当前 session（须保持 fail-closed）
- 读写 Promise 拒绝后状态或后续正常存读档不可恢复；验证须同时覆盖公开视图与完整序列化内容
- preview 路径产生正式状态变化

## 关联 module-cards

game-core, cocos-app, save-load

存储故障与恢复由 `trace.save.storage-failure-recovery` 连接 Session/UI/Queue 三个既有测试任务，详见 save-load 模块卡与 ADR-0003。
