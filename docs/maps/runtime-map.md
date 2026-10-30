# Runtime Map — v0.0.2.30

## 系统职责

运行时入口：GameRuntime、ActionPipeline、Session、headless dev runner，以及外部正式资源经createStage1AHost装配宿主的入口。

## 涉及模块

- `game-core`
- `cocos-app`
- `scripts`
- `cocos-creator-adapter`

## 关键文件

- `src/cocos-creator-adapter/bootstrap/Stage1ABootstrap.ts`
- `src/cocos-creator-adapter/scene/CocosSceneBindingController.ts`
- `src/game-core/validation/RuntimeSchemaValidator.ts`
- `src/game-core/validation/RuntimeContractValidator.ts`
- `src/game-core/runtime/GameRuntime.ts`
- `src/game-core/dev/Stage1AHeadlessRuntime.ts`
- `src/cocos-app/runtime/CocosAppRuntimeSession.ts`
- `scripts/run-stage1a-headless.ts`

## 关键测试

- `tests/stage1a-bootstrap.test.ts`
- `tests/cocos-scene-binding-application.test.ts`、`tests/cocos-component-node-binding-application.test.ts`
- `tests/stage1a-headless-runtime.test.ts`
- `tests/cocos-runtime-session.test.ts`
- `tests/dev-runner`（package script: `test:dev-runner`）

## 修改前必读

- [`module-cards/cocos-app.md`](../module-cards/cocos-app.md)
- [`code-index/public-api.md`](../code-index/public-api.md)

## 修改后必跑

- `npm run test:stage1a-bootstrap`
- `npm run test:dev-runner`
- `npm run test:cocos-session`

## 常见风险

- load 失败污染当前 session（须保持 fail-closed）
- 读写 Promise 拒绝后状态或后续正常存读档不可恢复；验证须同时覆盖公开视图与完整序列化内容
- preview 路径产生正式状态变化
- 资源缺失或引用损坏后仍交付可操作宿主；对已ready的Host重复创建Session
- 命令已经提交但异步界面应用乱序或失败；绑定恢复不得重发Action或回滚业务

## 关联 module-cards

game-core, cocos-app, save-load

启动装配由`trace.runtime.bootstrap-resources`连接公共入口、两个校验器和独立集成验收。资源加载属于外部调用方，运行入口不依赖文件系统或测试辅助。

存储故障与恢复由 `trace.save.storage-failure-recovery` 连接 Session/UI/Queue 三个既有测试任务，详见 save-load 模块卡与 ADR-0003。

场景绑定的实例内完整顺序与失败后重同步由`trace.cocos.binding-async-recovery`追踪；仅管理同一控制器调用，不提供业务事务或跨实例全局锁。
