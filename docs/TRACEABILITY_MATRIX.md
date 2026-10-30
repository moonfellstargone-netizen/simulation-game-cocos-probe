---
doc_type: traceability
status: active
applies_to: cocos-probe
source_of_truth: false
related:
  - docs/PROJECT_MAP.md
  - tools/quality/rules/traceability-map.json
  - tools/quality/test-registry.json
---

# TRACEABILITY_MATRIX — v0.0.2.30

**Async Scene Binding Ordering & Recovery / 场景绑定异步顺序与失败恢复版**

## 1. 定位

本文件是**项目地图追踪层**：在 `PROJECT_MAP`、module-card、code-index、test-registry 与 gate-policy 之间提供轻量可追踪矩阵。

- **不替代**源码、正式三包 v1.5.2.2、module-card 或 `test-registry.json`。
- **不替代** `tools/quality/rules/traceability-map.json`（机器可读权威）；人工矩阵须与其 active entries 对齐。
- 本轮沿用**轻量追踪地基**，新增场景绑定异步顺序与失败恢复链路，保留启动装配、存储故障和PR CI追踪；完整AST / symbol自动索引、Nightly实装、wx storage、真实Cocos均**不是**当前实现。

## 2. 状态语义

| 状态 | 含义 | 可否作为当前 gate 验收依据 |
|---|---|---|
| `active` | 当前 Stage 1A / quality / release 核心链路已登记 | 是（须满足 map 与契约测试） |
| `planned` | 预留扩展；`notCurrentAuthority: true` | **否** |
| `deprecated` | 已弃用追踪项（本轮未使用） | 否 |

`planned` 与 `futureExtensions` **不等于当前实现**，**不授权**进入 Stage 1B、wx storage、不接真实 Cocos、不接 wx 或 Nightly gate 实装。

**后续建议不是授权目标。**

## 3. 与质量门禁关系

- `q:affected` 仅开发反馈，**不可**作为 release 验收权威。
- 当前 `full` / `release` 必需追踪集合见 `traceability-map.json` 的 `currentFullReleaseTraceIds`（仅 `active`）。
- `test:traceability-contracts` 校验 map、registry、module-graph 与 gate 一致性。

## 4. Active entries（与 traceability-map.json 对齐）

### trace.cocos.binding-async-recovery

| 维度 | 内容 |
|---|---|
| 契约/系统 | 同一绑定实例内完整命令/端口顺序；失败后重新同步当前四区，卸载完成后不被先前更新覆盖 |
| 源码模块 | `cocos-creator-adapter`, `tests` |
| 关键路径 | `src/cocos-creator-adapter/scene/CocosSceneBindingController.ts` |
| 测试任务 | `test.cocos-scene-binding`, `test.cocos-component-node-binding`（既有full/blocker；共享`tests/support/controlledBindingPort.ts`） |
| 文档入口 | `docs/module-cards/cocos-creator-adapter.md`, `docs/module_contracts/CocosSceneBindingController.contract.md`, `docs/module_contracts/QinglanUiSceneProbeComponent.contract.md` |
| gate | `full`, `release` |
| 当前状态 | `active` |

端口错误仍通过Promise拒绝可观察，后续操作不被阻断。恢复仅重新渲染，不重发或回滚正式Action；diff保持Shell差异语义，恢复applied_updates可全量。两项任务登记tests覆盖及辅助files，实际选择由quality-affected-contracts验证，执行关系由traceability-contracts验证，不修改门禁算法。

### trace.runtime.bootstrap-resources

| 维度 | 内容 |
|---|---|
| 契约/系统 | 外部正式运行资源经公共入口形成可操作Stage1A宿主；资源缺失、无效或引用不可解析时失败，不发布可用结果 |
| 源码模块 | `game-core`, `cocos-app`, `cocos-creator-adapter`, `tests` |
| 关键路径 | `src/cocos-creator-adapter/bootstrap/Stage1ABootstrap.ts`, `src/game-core/validation/RuntimeSchemaValidator.ts`, `src/game-core/validation/RuntimeContractValidator.ts` |
| 测试任务 | `test.stage1a-bootstrap`, `test.cocos-session`（full/blocker；新增集成测试不借用runtimeHarness构造对象） |
| 文档入口 | `docs/module_contracts/Stage1ABootstrap.contract.md`, `docs/module-cards/cocos-creator-adapter.md` |
| gate | `full`, `release` |
| 当前状态 | `active` |

成功返回的Host已创建Session；通过现有公开接口使用并以destroySession结束，不再调用Probe.onLoad重复创建。该项不证明真实Cocos资源交付和依赖兼容。

### trace.stage1a.actionpipeline

| 维度 | 内容 |
|---|---|
| 契约/系统 | Stage 1A 正式状态变化须经 ActionPipeline |
| 源码模块 | `game-core` |
| 关键路径 | `src/game-core/action/ActionPipeline.ts` |
| 测试任务 | `test.stage1a-contract`, `test.smoke` |
| 文档入口 | `docs/module-cards/game-core.md`, `docs/ARCHITECTURE.md` |
| gate | `full` |
| 当前状态 | `active` |

### trace.stage1a.save-load

| 维度 | 内容 |
|---|---|
| 契约/系统 | SaveManager / SaveStoragePort；表现层不得直写 SaveFile |
| 源码模块 | `game-core` |
| 关键路径 | `src/game-core/save/SaveManager.ts`, `SaveStoragePort.ts` |
| 测试任务 | `test.stage1a-fixture`, `test.cocos-save-load` |
| 文档入口 | `docs/module-cards/save-load.md` |
| gate | `full` |
| 当前状态 | `active` |

### trace.save.storage-failure-recovery

| 维度 | 内容 |
|---|---|
| 契约/系统 | 现有 SaveStoragePort 读写拒绝时的状态保护、错误展示及后续健康命令恢复 |
| 源码模块 | `game-core`, `cocos-app`, `cocos-creator-adapter`, `tests` |
| 关键路径 | `src/game-core/save/SaveStoragePort.ts`, `src/cocos-app/runtime/CocosAppRuntimeSession.ts`, `src/cocos-creator-adapter/save/SaveLoadInteractionController.ts`, `src/cocos-creator-adapter/shell/CocosUiCommandQueue.ts` |
| 测试任务 | `test.cocos-session`, `test.cocos-save-load`, `test.cocos-command-queue`（既有 `full`+`blocker`；受控故障辅助见 `tests/support/controlledSaveStoragePort.ts`） |
| 文档入口 | `docs/module-cards/save-load.md`, `docs/module_contracts/SaveStoragePort.contract.md`, `docs/adr/ADR-0003-load-failure-must-not-mutate-current-session.md` |
| gate | `full`, `release` |
| 当前状态 | `active` |

本项验证即时或延迟读写拒绝、旧成功结果清除、命令顺序及健康重试；不新增平台错误码、真实 wx 接入或底层持久化原子回滚保证。既有 `trace.stage1a.save-load` 与 `trace.cocos.session-viewmodel-port` 保留各自职责。

### trace.stage1a.baseline-runtime

| 维度 | 内容 |
|---|---|
| 契约/系统 | Stage 1A headless + 多模块 baseline 运行时 |
| 源码模块 | `game-core`, `cocos-app`, `cocos-creator-adapter` |
| 关键路径 | `GameRuntime.ts`, `CocosAppRuntimeSession.ts` |
| 测试任务 | `test.stage1a-baseline` |
| 文档入口 | `docs/maps/runtime-map.md` |
| gate | `full` |
| 当前状态 | `active` |

### trace.cocos.session-viewmodel-port

| 维度 | 内容 |
|---|---|
| 契约/系统 | Session / ViewModel / Port 访问 game-core |
| 源码模块 | `cocos-app`, `game-core` |
| 关键路径 | `src/cocos-app/runtime/CocosAppRuntimeSession.ts` |
| 测试任务 | `test.cocos-adapter`、`test.cocos-session`（均为 registry `full`+`blocker`；`test.cocos-session` 覆盖 `tests/cocos-runtime-session.test.ts`） |
| 文档入口 | `docs/module-cards/cocos-app.md` |
| gate | `full` |
| 当前状态 | `active` |

### trace.cocos.creator-adapter-probe

| 维度 | 内容 |
|---|---|
| 契约/系统 | engine-neutral Creator 探针（非真实 Cocos 工程） |
| 源码模块 | `cocos-creator-adapter` |
| 关键路径 | `CocosSessionHost.ts`, `QinglanSessionProbeComponent.ts` |
| 测试任务 | `test.cocos-lifecycle` |
| 文档入口 | `docs/module-cards/cocos-creator-adapter.md` |
| gate | `full` |
| 当前状态 | `active` |

### trace.quality.version-surface

| 维度 | 内容 |
|---|---|
| 契约/系统 | project-target / BuildId / release root·zip 权威 |
| 源码模块 | `tools` |
| 关键路径 | `versionSurface.mjs`, `project-target.json` |
| 测试任务 | `test.version-surface-contracts`, `quality.versionConsistency` |
| 文档入口 | `docs/CHECK_ARCHITECTURE.md`, `docs/maps/quality-map.md` |
| gate | `full` |
| 当前状态 | `active` |

### trace.quality.affected-full-release-boundary

| 维度 | 内容 |
|---|---|
| 契约/系统 | q:affected ≠ release；full/release 权威边界 |
| 源码模块 | `tools` |
| 关键路径 | `affectedPolicy.mjs`, `gate-policy.json` |
| 测试任务 | `test.quality-affected-policy-hardening`, `test.quality-affected-contracts` |
| 文档入口 | `docs/CHECK_ARCHITECTURE.md`, `docs/GITHUB_WORKFLOW.md` |
| gate | `affected`, `full`, `release`（affected **非** release 权威） |
| 当前状态 | `active` |

### trace.quality.pr-ci

| 维度 | 内容 |
|---|---|
| 契约/系统 | PR 自动复用 q:full，保留失败语义和本轮质量报告 |
| 源码模块 | `tools`, `tests` |
| 关键路径 | `.github/workflows/quality.yml` |
| 测试任务 | `test.ci-workflow-contracts`（`full`+`blocker`；`tests/ci-workflow-contracts.test.mjs`） |
| 文档入口 | `docs/GITHUB_WORKFLOW.md`, `docs/maps/quality-map.md`, `docs/module-cards/quality-tools.md` |
| gate | `full`, `release`（PR CI 本身执行 full，release 继承契约检查） |
| 当前状态 | `active` |

### trace.release.zip-hygiene

| 维度 | 内容 |
|---|---|
| 契约/系统 | release zip 打包与复验卫生 |
| 源码模块 | `release-tools`, `tools` |
| 关键路径 | `build_release_package.py`, `check_release_zip.py` |
| 测试任务 | `test.package-hygiene`, `release.build`, `release.check` |
| 文档入口 | `docs/module-cards/release-tools.md` |
| gate | `release` |
| 当前状态 | `active` |

## 5. Planned entries（非当前实现）

| id | 说明 | notCurrentAuthority |
|---|---|---|
| `trace.stage1b.wx-storage-port` | wx storage / 平台 SaveStoragePort 预留 | `true` — **不进入 Stage 1B**，不接 wx |
| `trace.quality.nightly-profile` | Nightly gate 配置预留 | `true` — **不做 Nightly 实装** |

上述条目**不得**计入 `currentFullReleaseTraceIds`，**不得**作为当前 full/release 必需追踪依据。

## 6. 未来扩展（本轮不实现）

traceability-lite/v1 地基可后续扩展：schema/config、ADR、release notes、nightly、platform probe、symbol index 等。本轮**不实现**完整自动符号索引或 Nightly 实装。
