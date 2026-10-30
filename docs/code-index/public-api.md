# Code Index — Public API — v0.0.2.28

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
- Stage 1B wx / 真实 Cocos API（当前未进入）
