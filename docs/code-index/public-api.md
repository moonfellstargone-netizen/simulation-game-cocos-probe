# Code Index — Public API — v0.0.2.32

只记录公开入口与关键流程（非完整符号索引）。

## ActionPipeline

- 类：`ActionPipeline`（`src/game-core/action/ActionPipeline.ts`）
- 入口：`dispatch(state, request)` — 唯一正式状态变更管道
- 导出：`src/game-core/index.ts`

## Save / Load

- `SaveManager.serialize` / `deserializeSaveFile`（`src/game-core/save/SaveManager.ts`）
- `SaveStoragePort`（`src/game-core/save/SaveStoragePort.ts`）— 端口，由外层注入
  - `read(slotId): Promise<string | null>` — null 为空槽，Promise 拒绝表示读取失败
  - `write(slotId, serializedSave): Promise<void>` — 成功后 Session 才返回保存摘要；不在端口接口承诺真实存储原子回滚
- `NewGameBuilder.buildStage1A` — 新局构建

## Session / ViewModel / Port

- `CocosAppRuntimeSession`（`src/cocos-app/runtime/CocosAppRuntimeSession.ts`）
  - `dispatch(actionType, parameters)`
  - `preview(actionType, parameters)`
  - `save(slotId)` / `load(slotId)`
  - `getViewModel()` / `getSelectableViewModel()`
- `CocosActionSessionPort` — session dispatch 接口
- `CocosSessionHost`（`src/cocos-creator-adapter/CocosSessionHost.ts`）— 创建/require session

## 存储故障展示与命令恢复

- `SaveLoadInteractionController.save / load` — 清除旧成功结果、呈现现有错误，失败时保留 session；恢复后可正常重试。
- `CocosUiCommandQueue.enqueue / execute` — 串行等待当前命令，返回 completed / failed 与 snapshot；拒绝后的已排队命令继续执行。
- 契约与测试追踪：`trace.save.storage-failure-recovery`，ADR-0003 与 save-load 模块卡；没有新增业务公开 API、稳定错误码或真实存储适配。

## Stage1A启动装配

已有启动装配与资源就绪能力继续作为公共边界。

- `Stage1ABootstrapResources`：外部已解析的`snapshot`、`schemas`、`storage`及明确的`buildId`、`nowIso8601`。
- `createStage1AHost(input): CocosSessionHost`（`src/cocos-creator-adapter/bootstrap/Stage1ABootstrap.ts`）：资源与契约就绪、新局校验成功后才返回已创建Session的Host；失败抛错，不进行存储读写或正式Action。
- 导出：bootstrap子目录及`src/cocos-creator-adapter/index.ts`。
- `RuntimeSchemaValidator.assertSchemasAvailable(ids)`：真实编译指定Schema及引用闭包。
- `RuntimeContractValidator.assertReady()`：由既有契约校验器集中维护的必需Schema映射检查操作契约就绪。
- 成功Host通过`requireSession()`或现有UI Shell/Queue使用，以`destroySession()`结束；不得再调用Probe.onLoad创建同一会话。
- 追踪：`trace.runtime.bootstrap-resources`；本地`test:stage1a-bootstrap` / registry `test.stage1a-bootstrap`。

## 场景绑定异步顺序与失败恢复

- `CocosSceneBindingController.execute(command)`：同一实例内按序完成读取快照、命令执行和端口批次。返回diff仍是Shell前后差异；失败重同步时applied_updates可全量四区。
- `CocosSceneBindingController.applyInitialSnapshot()`：经同一实例顺序全量刷新；与execute互不超车。
- `QinglanUiSceneProbeComponent.mount / refresh / execute / applyInitialSnapshot / unmount`：复用上述控制器；卸载成功后不被先前调用的旧更新覆盖。
- `CocosSceneBindingPort.applySceneBindingUpdate`与`CocosComponentNodeBindingPort.applyNodeBindingPatch`保留`void | Promise<void>`，同步抛错或异步拒绝原样可观察。后续绑定操作全量重同步当前视图，不重放或回滚正式Action。
- 顺序只覆盖同一实例管理的调用，不承诺跨controller全局锁或端口副作用回滚。追踪`trace.cocos.binding-async-recovery`，使用现有两个full/blocker绑定任务。

## Cocos Web外层与准备入口

- `prepareCocosProbe({rootDir, outputDir})` / `readProbeResources(rootDir)`（`tools/cocos-probe/prepare.mjs`）：校验正式资源并生成仓库外工程与probe-source-manifest.json，拒绝危险/非空输出，不建立第二源码权威。
- `cocos:prepare -- --output <绝对空目录>`；派生bundle公开createStage1AHost、QinglanUiSceneProbeComponent、InMemorySaveStoragePort。
- `cocos:build -- --creator <exe> --project <派生工程> --log-dir <外部目录>`：真实Creator3.8.8 Web构建，独立于无引擎CI；成功码36与产物检查后才成功。
- 新outer模块单向消费上述runtime，纯生命周期桥接管理异步加载失效；真实cc组件只负责资源与节点，不直接访问核心内部。
- Node准备与生命周期契约不等于Creator编译或Web运行证明。导航见[引擎探针模块卡](../module-cards/cocos-engine-probe.md)，追踪trace.cocos.web-bootstrap-probe。

## Cocos app runtime

- `GameRuntime` + `ActionPipeline`（`src/game-core/runtime/GameRuntime.ts`）
- `CocosActionDispatcher` / `CocosRuntimeFacade` — app 层适配

## Quality gate 入口

- CLI：`npm run q:fast` / `q:affected` / `q:full` / `q:release`
- 实现：`tools/quality/run-quality-gate.mjs`（本轮不改核心逻辑）
- 配置：`tools/quality/gate-policy.json`、`tools/quality/test-registry.json`、`tools/quality/quality.config.json`

## PR CI 入口（非业务 API）

- 工作流：`.github/workflows/quality.yml`（PR 到 main，另有 workflow_dispatch）
- 执行：Ubuntu 24.04、Node 24、Python 3.12，`npm ci` → `npm run q:full`
- 契约：`npm run test:ci-workflow-contracts` / registry `test.ci-workflow-contracts`
- 报告：成功或失败均尝试保留 `reports/quality/latest.json` / `latest.md`，7 天
- 追踪：`trace.quality.pr-ci`；操作说明见 `docs/GITHUB_WORKFLOW.md`

## Traceability / 文档治理入口（非业务 API）

- 人工矩阵：`docs/TRACEABILITY_MATRIX.md`
- 机器可读 map：`tools/quality/rules/traceability-map.json`（经 `quality.config.json` → `rules.traceabilityMap`）
- 契约：`npm run test:traceability-contracts`

## Release build / check 入口

- `npm run release:build` → `tools/build_release_package.py --project-target ...`
- `npm run release:check` → `tools/check_release_zip.py --project-target ...`
- release 根名见 `tools/quality/rules/project-target.json`

## 待后续增强

- 按符号自动索引 game-core 全部 export
- Stage 1B、wx及其他目标平台（当前未进入）；真实Cocos仅当前Web最小外层。

## Web视口与输入验证工具

- `verifyWebProbe({project, browser, reportDir, buildRecord, previewUrl?})`（`tools/cocos-probe/verify-web.mjs`）：显式路径运行真实浏览器，来源和构建字节匹配后检查真实鼠标点击；独立于无引擎CI。
- `cocos:verify:web -- --project <ABS> --browser <ABS> --report-dir <ABS> --build-record <ABS>`；可选`--preview-url <loopback HTTP URL>`，预览结果单独标记，不证明livepreview内容hash；其矩阵仅1440×1200/960×640与960→1440→960 resize，800及DPR2属于built-web范围。
- `tools/cocos-probe/lib/webProbeSupport.mjs`共享参数/HTTP/来源和`webTreeDigest`；build.mjs的Web产物清单与verify复算必须一致，篡改拒绝。
- `test:cocos-web-verification-contracts`是Node工具契约，不执行真实浏览器；`trace.cocos.web-viewport-input`追踪执行输入与独立验收边界。
