# DOCS_GOVERNANCE — v0.0.2.23

文档治理规范。

## 1. 文档状态

| 状态 | 含义 | 可否作为执行依据 |
|---|---|---|
| `draft` | 讨论稿 | 否，仅讨论材料 |
| `active` | 当前有效 | 是 |
| `deprecated` | 已弃用，仍可读 | 否 |
| `superseded` | 被新文档取代 | 否，须读 replacement |

## 2. 文档类型

`PROJECT_MAP`、`GITHUB_WORKFLOW`、`MODULE_CARD`、`ADR`、`RFC`、`RUNBOOK`、`CHECKLIST`、`TRACEABILITY`、`GLOSSARY`

## 3. Definition of Ready（DoR）

- 有明确 `doc_type` 与 `status`
- 有 Task Intent Lock 或版本范围说明
- 入口链接在 README / CODE_CONTEXT_INDEX 可到达
- 引用的路径经存在性核对

## 4. Definition of Done（DoD）

- active 文档与 project-target 版本一致
- 相关 module-card / code-index 已同步
- 契约测试通过（`test:project-map-contracts`、`test:context-governance`）
- 无 forbidden 旧版本口径残留

## 5. 可追踪性矩阵

| 需求 / 决策 | 文档 | 测试 / 命令 |
|---|---|---|
| GitHub 工作流 | GITHUB_WORKFLOW | test:project-map-contracts |
| 项目地图 | PROJECT_MAP, maps/* | test:project-map-contracts |
| 模块边界 | module-cards/*, module-graph.json | arch:check, api-boundary tests |
| 上下文治理 | ADR, module_contracts/* | test:context-governance |
| 质量门禁 | CHECK_ARCHITECTURE, gate-policy | q:full, q:release |

## 6. PR 模板与目录责任

| 目录 | 责任 |
|---|---|
| `docs/maps/` | 领域导航维护者 |
| `docs/module-cards/` | 模块 owner（与 module-graph 一致） |
| `docs/code-index/` | 与 module-cards 同步 |
| `docs/module_contracts/` | 遗留契约，保留不删；新版导航以 module-cards 为主 |
| `tools/quality/` | 质量配置（本轮不改 gate 核心逻辑） |

## 7. 文档裁剪规则

- 不复制项目来源长文档全文
- module-card 不粘贴大段源码
- 未实现系统标为「后续候选」，不写为已实现

## 8. 文档自动检查

- `quality:contextDocSurface`：required / forbidden 短语
- `test:project-map-contracts`：地图存在性、链接、错误口径
- `test:context-governance`：ADR、module_contracts 遗留契约

## 9. active 才可执行

仅 `status: active` 文档可作为 Cursor 代码生成依据。draft 仅供讨论。

## 10. deprecated / superseded 禁止作生成依据

不得基于 deprecated 文档改代码；须先更新或 supersede。
