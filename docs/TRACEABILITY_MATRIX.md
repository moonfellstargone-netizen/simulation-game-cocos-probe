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

# TRACEABILITY_MATRIX — v0.0.2.25

**Project Map Auto Index & Traceability Lite / 项目地图自动索引与轻量可追踪矩阵版**

## 1. 定位

本文件是**项目地图追踪层**：在 `PROJECT_MAP`、module-card、code-index、test-registry 与 gate-policy 之间提供轻量可追踪矩阵。

- **不替代**源码、正式三包 v1.5.2.2、module-card 或 `test-registry.json`。
- **不替代** `tools/quality/rules/traceability-map.json`（机器可读权威）；人工矩阵须与其 active entries 对齐。
- 本轮只建立**轻量追踪地基**；完整 AST / symbol 自动索引、Nightly 实装、wx storage、真实 Cocos 均**不是**当前实现。

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
| 测试任务 | `test.cocos-adapter`（registry）；补充文件 `tests/cocos-runtime-session.test.ts` |
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
