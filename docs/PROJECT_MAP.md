# PROJECT_MAP — v0.0.3.0

项目分级地图导航入口。

## 1. 项目定位

模拟游戏 Cocos 微信试水代码项目：Stage 1A headless + Cocos 适配探针，game-core 独立于引擎与平台。

## 2. 当前阶段

v0.0.3.0：**WeChat Stage1A Pilot**。本轮唯一目标是v0.0.3.0的M3微信库存拆分包：在M2及M3种植与库存首包基础上，接入可选预览与独立校验的库存拆分确认，并保留播种、收获、整批转移、手动存读档和前后台保护。候选依赖PR25、PR26和PR27的既有变更；运行身份仍来自当前包的只读candidate_id和短commit，正式动作仍经公共Host/Binding/Queue与ActionPipeline。真实Creator、官方微信工具和手机结果分别验收，不由Node契约推断；本包不代表M3完整经营或M4手机验收完成。现有Web全部追踪和经营/恢复/触摸支持保留。

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
| `apps/cocos-wechat-probe/` | 独立微信outer，候选身份、正式推进与M2手动存读档 |
| `tools/cocos-wechat-probe/` | 微信派生准备、来源核验与独立构建，归属tools |
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

## 跨步骤恢复导航

trace.cocos.cross-step-recovery连接save-load/app/creator/engine四张模块卡、runtime/cocos地图和公共API索引。tests/stage1a-bootstrap.test.ts核公共Host/Queue五点续玩；既有verify-web/support及web-verification负例连接真实浏览器恢复场景。没有新生产模块或API；Node、Creator/SDK、built/editor和最终提交CI分别记录。

## 触摸与小屏导航

trace.cocos.touch-small-screen连接既有cocos-engine-probe/tools/tests模块，不新增模块或反向依赖。ProbeLayout与原生滚动/resize由engine模块卡及cocos-map导航，Node登记由quality-map导航，公开类型与函数见public-api索引。原29条追踪及全部既有经营/恢复回归保留。

## 微信M1追踪与边界

trace.cocos.wechat-m1连接cocos-wechat-probe模块卡、ADR-0005、cocos/runtime/quality地图与files/public-api索引。新增preparation/runtime任务为full/blocker，旧模块与全部追踪保持。M2增加微信存储和生命周期外层；完整经营与手机为M3/M4，尚未完成，不激活Stage1B planned条目。
