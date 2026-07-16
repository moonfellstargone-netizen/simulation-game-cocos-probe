# Code Index — Public API — v0.0.2.26

只记录公开入口与关键流程（非完整符号索引）。

## ActionPipeline

- 类：`ActionPipeline`（`src/game-core/action/ActionPipeline.ts`）
- 入口：`dispatch(state, request)` — 唯一正式状态变更管道
- 导出：`src/game-core/index.ts`

## Save / Load

- `SaveManager.serialize` / `deserializeSaveFile`（`src/game-core/save/SaveManager.ts`）
- `SaveStoragePort`（`src/game-core/save/SaveStoragePort.ts`）— 端口，由外层注入
- `NewGameBuilder.buildStage1A` — 新局构建

## Session / ViewModel / Port

- `CocosAppRuntimeSession`（`src/cocos-app/runtime/CocosAppRuntimeSession.ts`）
  - `dispatch(actionType, parameters)`
  - `preview(actionType, parameters)`
  - `save(slotId)` / `load(slotId)`
  - `getViewModel()` / `getSelectableViewModel()`
- `CocosActionSessionPort` — session dispatch 接口
- `CocosSessionHost`（`src/cocos-creator-adapter/CocosSessionHost.ts`）— 创建/require session

## Cocos app runtime

- `GameRuntime` + `ActionPipeline`（`src/game-core/runtime/GameRuntime.ts`）
- `CocosActionDispatcher` / `CocosRuntimeFacade` — app 层适配

## Quality gate 入口

- CLI：`npm run q:fast` / `q:affected` / `q:full` / `q:release`
- 实现：`tools/quality/run-quality-gate.mjs`（本轮不改核心逻辑）
- 配置：`tools/quality/gate-policy.json`、`tools/quality/test-registry.json`、`tools/quality/quality.config.json`

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
