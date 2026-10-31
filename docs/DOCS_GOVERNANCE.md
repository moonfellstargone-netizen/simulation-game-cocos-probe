# DOCS_GOVERNANCE — v0.0.2.36

文档治理规范。

## 1. 文档状态

| 状态 | 含义 | 可否作为执行依据 |
|---|---|---|
| `draft` | 讨论稿 | 否，仅讨论材料 |
| `active` | 当前有效 | 是 |
| `deprecated` | 已弃用，仍可读 | 否 |
| `superseded` | 被新文档取代 | 否，须读 replacement |

## 2. 文档类型

`PROJECT_MAP`、`GITHUB_WORKFLOW`、`MODULE_CARD`、`TRACEABILITY`、`ADR`、`RFC`、`RUNBOOK`、`CHECKLIST`、`GLOSSARY`

## 3. TRACEABILITY 文档

- 人工矩阵：`docs/TRACEABILITY_MATRIX.md`（`doc_type: traceability`, `status: active`）
- 机器可读：`tools/quality/rules/traceability-map.json`（schema `traceability-lite/v1`）
- 契约测试：`test:traceability-contracts`（路径自 `quality.config.json` → `rules.traceabilityMap`）
- `active` entry：当前 full/release 追踪依据；`planned` + `notCurrentAuthority`：**不是**当前实现

## 4. Definition of Ready（DoR）

- 有明确 `doc_type` 与 `status`
- 有 Task Intent Lock 或版本范围说明
- 入口链接在 README / CODE_CONTEXT_INDEX 可到达
- 引用的路径经存在性核对
- traceability active entry 与 module-card / test-registry 一致

## 5. Definition of Done（DoD）

- active 文档与 project-target 版本一致
- 相关 module-card / code-index / traceability-map 已同步
- 契约测试通过（`test:traceability-contracts`、`test:project-map-contracts`、`test:context-governance`）
- 无 forbidden 旧版本口径残留

## 6. 可追踪性矩阵

| 需求 / 决策 | 文档 | 测试 / 命令 |
|---|---|---|
| GitHub 工作流 | GITHUB_WORKFLOW | test:project-map-contracts |
| 项目地图 | PROJECT_MAP, maps/* | test:project-map-contracts |
| 轻量追踪 | TRACEABILITY_MATRIX, traceability-map.json | test:traceability-contracts |
| 模块边界 | module-cards/*, module-graph.json | arch:check, api-boundary tests |
| 上下文治理 | ADR, module_contracts/* | test:context-governance |
| 质量门禁 | CHECK_ARCHITECTURE, gate-policy | q:full, q:release |
| PR 自动质量验证 | GITHUB_WORKFLOW, quality-map, trace.quality.pr-ci | test:ci-workflow-contracts, q:full |
| 存储故障保护与恢复 | save-load module-card, SaveStoragePort contract, ADR-0003, trace.save.storage-failure-recovery | test:cocos-session, test:cocos-save-load, test:cocos-ui-command-queue |
| 启动装配与资源就绪 | creator模块卡、Stage1ABootstrap契约、trace.runtime.bootstrap-resources | test:stage1a-bootstrap、test:cocos-session |
| 场景绑定异步顺序与失败恢复 | creator模块卡、scene/component边界契约、trace.cocos.binding-async-recovery | test:cocos-scene-binding、test:cocos-component-node-binding、test:quality-affected-contracts |

新增真实引擎外层由cocos-engine-probe模块卡、CocosEngineProbe契约和trace.cocos.web-bootstrap-probe连接；自动准备/生命周期任务与独立Creator验证的状态必须分别记录，不以Node或根typecheck代替真实引擎通过。

真实Web视口与输入由trace.cocos.web-viewport-input连接源模板、构建摘要、最小浏览器工具和Node工具契约。自动门禁只验证Node可执行契约；Creator构建、编辑器预览和真实鼠标点击结果须独立记录，不据工具存在或CI通过推定。

## 7. PR 模板与目录责任

| 目录 | 责任 |
|---|---|
| `docs/maps/` | 领域导航维护者 |
| `docs/module-cards/` | 模块 owner（与 module-graph 一致） |
| `docs/code-index/` | 与 module-cards 同步 |
| `docs/TRACEABILITY_MATRIX.md` | 与 traceability-map.json active entries 同步 |
| `docs/module_contracts/` | 遗留契约，保留不删；新版导航以 module-cards 为主 |
| `tools/quality/` | 质量配置（本轮不改 gate 核心逻辑） |

## 8. 文档裁剪规则

- 不复制项目来源长文档全文
- module-card 不粘贴大段源码
- 未实现系统标为 `planned`，不写为已实现

## 9. 文档自动检查

- `quality:contextDocSurface`：required / forbidden 短语
- `test:project-map-contracts`：地图存在性、链接、错误口径
- `test:traceability-contracts`：map / registry / gate 追踪一致性
- `test:context-governance`：ADR、module_contracts 遗留契约

## 10. active 才可执行

仅 `status: active` 文档可作为 Cursor 代码生成依据。draft 仅供讨论。

## 11. deprecated / superseded 禁止作生成依据

不得基于 deprecated 文档改代码；须先更新或 supersede。

## 浏览器本地存档与刷新恢复

trace.cocos.browser-local-save连接外层BrowserSaveStoragePort.ts、CocosWebProbe.ts、ProbeInteraction.ts及浏览器/固定来源工具；保留trace.cocos.web-save-load-recovery对既有Queue命令结果归属的追踪。真实三按钮AdvanceOneHour、SaveLocal、LoadLocal使用固定单槽web_probe和稳定项目key，启动不读写存储；同origin/profile刷新先创建新局，手动读取恢复保存状态。getter/读写拒绝和坏档保持当前会话，不回退内存。tests/cocos-browser-storage.test.ts与既有生命周期/交互回归由test.cocos-engine-probe-lifecycle实际执行，tests/cocos-web-serve-contracts.test.mjs由test.cocos-web-verification-contracts执行；files/covers、单文件affected及full/blocker闭合。ProbeInteraction保留本次反馈、busy和销毁后迟到保护；真实Creator/Chrome物理点击、刷新及同context新页面手动恢复独立验收，根typecheck只覆盖src，Node通过不能替代引擎或持久化证据。

## 网页农事追踪

trace.cocos.web-farming-loop连接ProbeFarming/ProbeInteraction/ProbeLifetime/CocosWebProbe、既有准备与真实浏览器工具。tests/cocos-web-farming.test.ts加入现有生命周期任务实际args；full/blocker、files/covers与独立changed-file选择必须核对。成功/拒绝、公开实际数量和读档选择重建由行为与真实点击验收，地图登记不证明功能已通过。既有browser-local-save、web-save-load-recovery、web-viewport-input与web-bootstrap-probe追踪保留。
