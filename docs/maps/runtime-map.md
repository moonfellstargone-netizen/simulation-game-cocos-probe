# Runtime Map — v0.0.2.26

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
- preview 路径产生正式状态变化

## 关联 module-cards

game-core, cocos-app, save-load
