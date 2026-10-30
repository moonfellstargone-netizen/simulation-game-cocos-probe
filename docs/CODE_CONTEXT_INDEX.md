# CODE_CONTEXT_INDEX — v0.0.2.30

版本：v0.0.2.30 / Async Scene Binding Ordering & Recovery / 场景绑定异步顺序与失败恢复版。

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

## v0.0.2.30 测试索引

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
