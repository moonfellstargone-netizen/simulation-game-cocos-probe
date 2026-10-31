# Runtime Map — v0.0.2.34

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

真实Web宿主位于新cocos-engine-probe外层，准备工具从唯一运行源码和正式资源派生工程；异步加载期间销毁保护属于外层生命周期，不能由已有绑定队列代替。见[引擎探针模块卡](../module-cards/cocos-engine-probe.md)和trace.cocos.web-bootstrap-probe。

桌面视口和输入修复仅在既有Web外层及构建模板，resize不重新创建Host、不重注册Action事件；`trace.cocos.web-viewport-input`和独立`cocos:verify:web`负责点击命中与公开时间/Label一致性，核心运行流程保持不变。

## 浏览器本地存档与刷新恢复

trace.cocos.browser-local-save连接外层BrowserSaveStoragePort.ts、CocosWebProbe.ts、ProbeInteraction.ts及浏览器/固定来源工具；保留trace.cocos.web-save-load-recovery对既有Queue命令结果归属的追踪。真实三按钮AdvanceOneHour、SaveLocal、LoadLocal使用固定单槽web_probe和稳定项目key，启动不读写存储；同origin/profile刷新先创建新局，手动读取恢复保存状态。getter/读写拒绝和坏档保持当前会话，不回退内存。tests/cocos-browser-storage.test.ts与既有生命周期/交互回归由test.cocos-engine-probe-lifecycle实际执行，tests/cocos-web-serve-contracts.test.mjs由test.cocos-web-verification-contracts执行；files/covers、单文件affected及full/blocker闭合。ProbeInteraction保留本次反馈、busy和销毁后迟到保护；真实Creator/Chrome物理点击、刷新及同context新页面手动恢复独立验收，根typecheck只覆盖src，Node通过不能替代引擎或持久化证据。
