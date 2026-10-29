# Code Index — Files — v0.0.2.27

| 路径 | 所属模块 | 用途 | 什么时候读 | 相关测试/命令 |
|---|---|---|---|---|
| `README.md` | docs | 仓库入口、Task Intent Lock | 每轮开始 | `quality:contextDocSurface` |
| `package.json` | config | 版本与 scripts | 每轮开始 | `quality:version` |
| `docs/CODE_CONTEXT_INDEX.md` | docs | 必读顺序、预检要求 | 执行前 | `test:context-governance` |
| `docs/CHECK_ARCHITECTURE.md` | docs | 门禁与 affected 边界 | 改 quality/docs | `q:full` |
| `docs/ARCHITECTURE.md` | docs | 业务架构红线 | 改 game-core | `arch:check` |
| `docs/IMPLEMENTATION_SCOPE.md` | docs | 当前版本范围 | 每轮开始 | `test:context-governance` |
| `docs/GITHUB_WORKFLOW.md` | docs | GitHub 工作流 | 分支/PR 前 | `test:project-map-contracts` |
| `docs/PROJECT_MAP.md` | docs | L0–L5 地图导航 | 跨模块任务 | `test:project-map-contracts` |
| `docs/TRACEABILITY_MATRIX.md` | docs | 轻量可追踪矩阵（人工） | 跨链路追踪 | `test:traceability-contracts` |
| `docs/DOCS_GOVERNANCE.md` | docs | 文档治理 | 新增/改 docs | `test:project-map-contracts` |
| `docs/GLOSSARY.md` | docs | 术语 | 权威混淆时 | `test:project-map-contracts` |
| `docs/maps/` | docs | 领域地图 | 领域改动 | `test:project-map-contracts` |
| `docs/module-cards/` | docs | 模块卡（新导航层） | 模块改动 | `test:project-map-contracts` |
| `docs/module_contracts/` | docs | 遗留模块契约（保留） | 读 Cocos 边界 | `test:context-governance` |
| `docs/code-index/` | docs | 代码索引 | 找入口 | `test:project-map-contracts` |
| `tools/quality/rules/project-target.json` | quality-tools | 版本权威 | 版本 bump | `quality:version` |
| `tools/quality/rules/traceability-map.json` | quality-tools | 机器可读追踪矩阵 | 追踪登记 | `test:traceability-contracts` |
| `tools/quality/quality.config.json` | quality-tools | 质量配置（含 traceabilityMap） | 改 rules | `quality:config` |
| `tools/quality/lib/projectTarget.mjs` | quality-tools | project-target 读取 | 版本 bump | `test:version-surface-contracts` |
| `tools/quality/lib/versionSurface.mjs` | quality-tools | version/BuildId 派生 | 版本 bump | `test:version-surface-contracts` |
| `tools/quality/module-graph.json` | quality-tools | 模块图 | affected/arch | `arch:check` |
| `tools/quality/test-registry.json` | quality-tools | 测试登记 | 新测试 | `quality:test-registry` |
| `tools/quality/gate-policy.json` | quality-tools | 门禁策略 | 改 gate | `test:quality-gate-contracts` |
| `.github/workflows/quality.yml` | tools | PR 完整检查与报告保留 | 改 CI 触发/权限/执行步骤 | `test:ci-workflow-contracts` |
| `tests/ci-workflow-contracts.test.mjs` | tests | PR CI YAML 语义与负向约束 | 改工作流 | `test:ci-workflow-contracts` |
| `src/game-core/**` | game-core | 核心逻辑 | 玩法/状态 | `test:stage1a-baseline` |
| `src/cocos-app/**` | cocos-app | 应用适配 | Session/UI VM | `test:cocos-session` |
| `src/cocos-creator-adapter/**` | cocos-creator-adapter | Creator 探针 | UI binding | `test:cocos-ui-readiness` |
| `tools/quality/**` | quality-tools | 质量工具 | 门禁改动 | `q:full` |
| `tools/build_release_package.py` | release-tools | 打包 | release | `release:build` |
| `tools/check_release_zip.py` | release-tools | zip 复验 | release | `release:check` |
| `tests/traceability-contracts.test.mjs` | tests | traceability 契约 | 改 map/docs | `test:traceability-contracts` |
| `tests/cocos-runtime-session.test.ts` | tests | Session / ViewModel / SaveStoragePort / ActionPipeline 边界（registry `test.cocos-session`） | 改 Cocos app Session 边界 | `test:cocos-session` |
| `tests/**` | tests | 契约与回归 | 改代码/文档 | `q:full` |
