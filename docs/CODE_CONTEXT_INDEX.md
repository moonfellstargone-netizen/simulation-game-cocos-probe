# CODE_CONTEXT_INDEX — v0.0.2.33

版本：v0.0.2.33 / Cocos Web Save/Load Interaction & Recovery / Cocos网页临时存读档交互与恢复版。

## 执行前必读顺序

1. `package.json`
2. `tools/quality/rules/project-target.json`
3. `tools/quality/quality.config.json`（含 `rules.traceabilityMap`）
4. `docs/GITHUB_WORKFLOW.md`
5. `docs/PROJECT_MAP.md`
6. `docs/TRACEABILITY_MATRIX.md`
7. `docs/DOCS_GOVERNANCE.md`
8. `docs/GLOSSARY.md`
9. `docs/CODE_CONTEXT_INDEX.md`
10. `docs/CHECK_ARCHITECTURE.md`
11. `docs/ARCHITECTURE.md`
12. `docs/IMPLEMENTATION_SCOPE.md`
13. `tools/quality/module-graph.json`
14. `tools/quality/test-registry.json`
15. `tools/quality/gate-policy.json`
16. `tools/quality/rules/traceability-map.json`
17. 本轮 Scope Discovery 指定的 module-cards / maps / code-index

## 预检报告必须包含

输入版本、目标版本、正式包 v1.5.2.2 来源、已读取文件证据、未覆盖模块声明、旧版本残留扫描、Task Intent Lock、本轮唯一目标、验收命令和执行前判断。

复杂任务必须先做 Scope Discovery；项目超出上下文时必须分层读取（见 PROJECT_MAP L0–L5）。Cursor 不得只依赖更新指导摘要；新增/修改/删除代码必须同步维护受影响层级项目地图与 traceability active entries。

后续建议不是授权目标。外部执行指令必须说明任务意图；若版本号出现两个不同任务意图，先修任务锁，不继续写代码。当前任务上下文交接来自外部执行指令或开发日志包；代码包不保存每轮具体任务上下文；代码包只保存执行端上下文治理约束。

## v0.0.2.33 测试索引

- `tests/cocos-web-verification-contracts.test.mjs`（`test:cocos-web-verification-contracts`，Node工具契约）

- `tests/cocos-probe-preparation.test.mjs`（`test:cocos-probe-preparation`）
- `tests/cocos-engine-probe-lifecycle.test.ts`（`test:cocos-engine-probe-lifecycle`）

- `tests/cocos-scene-binding-application.test.ts`（`test:cocos-scene-binding` / registry `test.cocos-scene-binding`）
- `tests/cocos-component-node-binding-application.test.ts`（`test:cocos-component-node-binding` / registry `test.cocos-component-node-binding`）
- `tests/support/controlledBindingPort.ts`（测试专用手动延迟/拒绝与实际端口状态记录辅助）
- `tests/stage1a-bootstrap.test.ts`（`test:stage1a-bootstrap` / registry `test.stage1a-bootstrap`，正式资源经公共入口的独立集成验收）
- `tests/support/controlledSaveStoragePort.ts`（测试专用故障时序与健康序列化捕获辅助）
- `tests/cocos-save-load-ui-binding.test.ts`（`test:cocos-save-load` / registry `test.cocos-save-load`）
- `tests/cocos-ui-command-queue.test.ts`（`test:cocos-ui-command-queue` / registry `test.cocos-command-queue`）
- `tests/ci-workflow-contracts.test.mjs`（`test:ci-workflow-contracts` / registry `test.ci-workflow-contracts`）
- `tests/cocos-runtime-session.test.ts`（`test:cocos-session` / registry `test.cocos-session`）
- `tests/traceability-contracts.test.mjs`
- `tests/project-map-contracts.test.mjs`
- `tests/context-governance-contracts.test.mjs`
- `tests/quality-gate-contracts.test.mjs`
- `tests/quality-affected-policy-hardening.test.mjs`
- `tests/version-surface-contracts.test.mjs`
- `tests/package-hygiene.test.mjs`

## 真实Cocos Web视口与输入入口

先读`apps/cocos-probe/template/build-templates/web-desktop/`源模板、`tools/cocos-probe/build.mjs`、`tools/cocos-probe/verify-web.mjs`及`tools/cocos-probe/lib/webProbeSupport.mjs`；确认`trace.cocos.web-viewport-input`的Node契约与真实鼠标点击证据分离。源模板是修复位置，仓库外生成Web页面不能手改。

保留准备/生命周期full/blocker回归，新增test:cocos-web-verification-contracts / registry test.cocos-web-verification-contracts验证浏览器工具的参数、来源、HTTP服务和断言失败保护；Node契约不执行真实浏览器。独立cocos:verify:web运行固定Creator构建产物的真实Chrome鼠标点击，记录Button事件、时间变化、Label同步与清理证据；根typecheck只覆盖src，不能代替实际Creator类型、构建或浏览器验收。

## 真实Cocos Web探针入口

先读[引擎探针模块卡](module-cards/cocos-engine-probe.md)与[外层契约](module_contracts/CocosEngineProbe.contract.md)，再核对apps/cocos-probe、tools/cocos-probe/prepare.mjs及两项新测试。仓库内apps/cocos-probe保存最小工程源模板及外层桥接；tools/cocos-probe/prepare.mjs从现有src/design_snapshot派生浏览器runtime与全部58个声明Schema，在仓库外生成可打开工作副本。probe-source-manifest.json记录sourceCommit、sourceDirty、输入/产物摘要及project-target派生BuildId，副本不成为第二套代码或配置权威。

Node中的准备契约和外层生命周期测试登记为full/blocker，由trace.cocos.web-bootstrap-probe追踪；它们验证实际派生产物、资源完整性、异常路径和确定性生命周期，不冒充引擎运行证据。根typecheck仍仅覆盖src。真实Creator预览与Web构建另行执行，缺引擎时明确失败或未执行，不能静默skip或使用假cc类型声称通过。旧三层不接真实 `cc / wx / fs`；首次真实cc仅属于新outer模块，不能删旧禁令或扩大历史白名单。

## PR CI 入口

先读 `.github/workflows/quality.yml` 与 `docs/GITHUB_WORKFLOW.md`，再核对 YAML 契约、test-registry 和 `trace.quality.pr-ci`。CI 在 PR 到 main 时使用 Ubuntu 24.04、Node 24、Python 3.12，`npm ci` 后执行现有 q:full；成功或失败均尝试保留 JSON / Markdown 报告 7 天。具体云端通过记录、报告及分支保护状态应现场核对，不能由本地通过推定。

## 场景绑定异步顺序与失败恢复入口

先读creator-adapter模块卡，再读`CocosSceneBindingController`及scene/component端口和组件契约，核对两份应用测试、受控辅助及`trace.cocos.binding-async-recovery`。模块卡仍是导航入口，既有module_contracts保留边界说明。

同一实例的execute和applyInitialSnapshot共享完整应用顺序，组件mount/unmount经过该控制器。绑定失败仍拒绝Promise，后续操作重新同步当前四区视图；diff只描述Shell前后差异，恢复时applied_updates可全量。不要重发正式Action或回滚已提交状态，不将实例顺序宣称为跨controller全局锁。

两项现有绑定任务保持full/blocker，并登记tests覆盖及辅助files。`test:quality-affected-contracts`检查各测试及辅助单独变化时的实际选择，`test:traceability-contracts`检查追踪与执行文件闭合；不为测试通过修改affected算法或门禁策略。

## 启动装配与资源契约入口

先读creator-adapter模块卡和`src/cocos-creator-adapter/bootstrap/Stage1ABootstrap.ts`，再核对两个既有校验器的就绪API、新增集成测试以及`trace.runtime.bootstrap-resources`。

`docs/module_contracts/Stage1ABootstrap.contract.md`保留为模块边界契约说明，模块卡仍是导航入口。`createStage1AHost`成功返回已创建Session的Host，不再调用Probe.onLoad二次创建。集成测试不能导入runtimeHarness构造运行对象，失败资源不能产生可操作的半初始化宿主。

## 存储故障与恢复入口

先读 `docs/module-cards/save-load.md` 和 ADR-0003，再核对 Session、SaveLoadInteractionController、CocosUiCommandQueue 与上述三个层级测试。

`docs/module_contracts/SaveStoragePort.contract.md` 保留为遗留契约，按需补读；模块卡仍是模块导航入口。`trace.save.storage-failure-recovery` 连接现有 full/blocker 任务，不替代 `trace.cocos.session-viewmodel-port`。

区分空槽 null 与读取拒绝、失败 snapshot 与旧成功摘要、调用方状态保护与底层持久化原子性；普通错误沿用现有展示器，不新增平台错误码或真实存储保证。

## 既有架构边界索引

不跳过 ActionPipeline，不直接改 SaveFile，不接真实 `cc / wx / fs`。`architecture-boundary.rules.json`、`architecture-boundary-check.mjs`、`quality:architecture-boundary` 与 `loadArchitectureBoundaryRules` 继续有效；旧 validator 仍保留权威红线。

release zip 仍检查 UTF-8 metadata 与 mojibake 路径，并排除 `reports/quality`、`.cache/quality`、日志包、node_modules、coverage、dist。

## 检查命令别名索引

- `test:cocos-scene-binding`
- `test:cocos-component-node-binding`
- `test:stage1a-bootstrap`
- `q:affected`
- `q:full`
- `q:release`
- `test:ci-workflow-contracts`
- `test:cocos-session`
- `test:cocos-save-load`
- `test:cocos-ui-command-queue`
- `test:traceability-contracts`
- `test:project-map-contracts`
- `traceability-map.json`
- `context-doc-surface.rules.json`
- `project-target.json`

## 遗留 module_contracts 说明

`docs/module_contracts/` 保留为上下文治理契约，不是新版 module-card 主入口。新版导航见 `docs/module-cards/`。

## 临时存读档交互与恢复

trace.cocos.web-save-load-recovery连接apps/cocos-probe/template/assets/scripts/CocosWebProbe.ts、ProbeInteraction.ts和src/cocos-creator-adapter/shell/CocosUiCommandQueue.ts；根typecheck仍只覆盖src。外层真实三按钮使用固定本页内存槽web_probe，当前反馈读取command_result，历史面板错误保留但不覆盖本次结果。ProbeInteraction保证busy与销毁后迟到保护；tests/cocos-web-interaction.test.ts由既有test.cocos-engine-probe-lifecycle实际执行并登记files/covers，新增helper和test分别验证单文件affected选择。Queue/component行为回归与浏览器工具契约保持full/blocker；真实Creator/Chrome物理点击、读取恢复及刷新清空独立验收，不能由Node通过推导。
