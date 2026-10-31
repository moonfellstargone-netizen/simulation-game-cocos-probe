# PROJECT_MAP — v0.0.2.32

项目分级地图导航入口。

## 1. 项目定位

模拟游戏 Cocos 微信试水代码项目：Stage 1A headless + Cocos 适配探针，game-core 独立于引擎与平台。

## 2. 当前阶段

v0.0.2.32：**Cocos Web Viewport & Input Reliability**。修复真实Web时间探针的桌面窗口显示与点击一致性，独立浏览器验收由trace.cocos.web-viewport-input连接；保留唯一来源派生、既有启动/绑定/存储回归。

## 3. 权威边界

- 代码权威：本 GitHub 仓库
- 玩法权威：正式三包 v1.5.2.2
- 流程权威：仓库内 `GITHUB_WORKFLOW`、`DOCS_GOVERNANCE`、质量配置
- 项目地图：**导航**，不替代源码
- 可追踪矩阵：**追踪层**，不替代 module-card / test-registry

## 4. 主要目录

| 路径 | 职责 |
|---|---|
| `src/game-core/` | 核心逻辑，ActionPipeline 唯一正式状态入口 |
| `src/cocos-app/` | Cocos 应用适配，Session / ViewModel |
| `src/cocos-creator-adapter/` | engine-neutral 探针，非真实 Cocos 工程 |
| `apps/cocos-probe/` | 真实Creator Web外层源模板，独立模块 |
| `tools/cocos-probe/` | 仓库外工程准备与真实构建入口 |
| `tools/quality/` | 质量门禁与 affected 策略 |
| `.github/workflows/quality.yml` | PR 自动完整检查与报告保留，归属 tools |
| `tools/quality/rules/traceability-map.json` | 机器可读轻量追踪矩阵 |
| `tools/build_release_package.py` | release 打包 |
| `docs/` | 架构、范围、地图、治理 |
| `tests/` | 契约与回归测试 |

## 5. L0–L5 地图层级

| 层级 | 内容 | 入口 |
|---|---|---|
| L0 | 仓库入口 | `README.md`、`package.json`、`project-target.json` |
| L1 | 工作流与治理 | [`GITHUB_WORKFLOW.md`](GITHUB_WORKFLOW.md)、[`DOCS_GOVERNANCE.md`](DOCS_GOVERNANCE.md)、[`TRACEABILITY_MATRIX.md`](TRACEABILITY_MATRIX.md)、[`GLOSSARY.md`](GLOSSARY.md) |
| L2 | 领域地图 | [`maps/domain-map.md`](maps/domain-map.md)、[`maps/runtime-map.md`](maps/runtime-map.md)、[`maps/quality-map.md`](maps/quality-map.md)、[`maps/cocos-map.md`](maps/cocos-map.md) |
| L3 | 模块卡 | [`module-cards/`](module-cards/) |
| L4 | 代码索引 | [`code-index/files.md`](code-index/files.md)、[`code-index/public-api.md`](code-index/public-api.md) |
| L5 | 源码 | `src/**`、`tests/**` |

## 6. 导航

- 领域总览 → `docs/maps/*`
- 模块边界 → `docs/module-cards/*`
- 路径与 API → `docs/code-index/*`
- 轻量追踪 → [`TRACEABILITY_MATRIX.md`](TRACEABILITY_MATRIX.md) + `tools/quality/rules/traceability-map.json`
- 遗留模块契约（上下文治理）→ `docs/module_contracts/*`（**保留**，不是新版 module-card 主入口）

## 7. 修改代码时同步哪些地图

| 改动类型 | 至少同步 |
|---|---|
| 新模块 / 目录 | module-card、domain-map、files.md、traceability active entry |
| 公开 API | public-api.md、相关 module-card |
| 质量 / 门禁 | quality-map、test-registry、traceability-map |
| 版本 bump | README、project-target、CODE_CONTEXT_INDEX、TRACEABILITY_MATRIX |
| 仅内部 refactor | 若路径不变可不动地图；路径变必须更新索引与 traceability |

## 8. 与其他文档关系

- [`GITHUB_WORKFLOW.md`](GITHUB_WORKFLOW.md)：分支、PR、预检、Scope Discovery
- [`DOCS_GOVERNANCE.md`](DOCS_GOVERNANCE.md)：文档状态、DoR/DoD、PR 责任
- [`GLOSSARY.md`](GLOSSARY.md)：术语，防止 zip / 日志包 / q:affected 混淆
