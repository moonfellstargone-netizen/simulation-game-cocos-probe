# CHECK_ARCHITECTURE — v0.0.2.29

v0.0.2.29 / Runtime Bootstrap & Resource Contracts是运行启动装配与资源契约版，验证正式资源经公共入口装配宿主及资源失败保护，保留既有业务架构边界。

## 1. 本轮检查目标

本轮只做运行启动装配与资源契约：正常资源必须通过公共入口形成可运行宿主，缺失或无效资源、Schema引用损坏必须在交付可用会话前失败。就绪检查直接复用现有Schema编译能力，不通过向校验器传假数据后忽略结果模拟成功。

独立集成验收从正式快照及Schema读取开始，经公共入口覆盖已有正式动作、存读档与生命周期；运行对象不能由runtimeHarness代为组装。`test:stage1a-bootstrap` / registry `test.stage1a-bootstrap`登记为full/blocker，`trace.runtime.bootstrap-resources`连接装配源码、两个校验器、模块卡与边界契约。`test.cocos-session`仍承担既有Session回归，两项均须实际进入full/release。

既有`test:cocos-session`、`test:cocos-save-load`和`test:cocos-ui-command-queue`（registry为`test.cocos-session`、`test.cocos-save-load`、`test.cocos-command-queue`）继续验证Session、UI和命令队列的存储故障保护。`trace.save.storage-failure-recovery`、ADR-0003及完整序列化状态比较继续有效，不新增持久化原子回滚保证。

既有 `.github/workflows/quality.yml`、`test:ci-workflow-contracts`、`trace.quality.pr-ci` 继续有效：PR 到 main 时执行 Ubuntu 的 `npm ci` 与 `q:full`，成功或失败均尝试上传本轮两份报告，保留 7 天；报告缺失明确报错。包卫生仍只排除根 `.git` 元数据；`trace.cocos.session-viewmodel-port` 和既有 traceability 地基继续沿用。

PR CI 不执行 release 打包；GitHub 具体运行与分支保护设置分别核对，不把本地通过记录或工作流文件存在当作云端通过或保护已启用。

追踪由`traceability-map.json`与`TRACEABILITY_MATRIX.md`对齐，实际执行任务以`test-registry.json`为准。三个故障测试消费者均登记受控端口辅助，并覆盖tests模块，使辅助文件单独变化时也能被affected选择；该登记不改变affected算法。

## 2. traceability-contracts

`test:traceability-contracts` 通过 `quality.config.json` 读取 `rules.traceabilityMap`，校验 active entries 的 module/test/gate/路径一致性、planned 负向约束，以及 `TRACEABILITY_MATRIX.md` 边界短语。该测试**不得**推动业务源码重构。

## 3. version-surface-contracts（继承）

`test:version-surface-contracts` 继续验证 `project-target.json`、BuildId 派生与 release 权威。与 traceability 互补，不重复替代。

## 4. 现有门禁（继承既有 affected 策略）

- `arch:check` 继续执行 legacy validator 与 `architecture-boundary-check.mjs`。
- `architecture-boundary.rules.json` 中 authoritative 规则仍是 blocker。
- token/state-leak 规则继续 shadow findings / shadow_aligned 观察口径。

## 5. q:affected 流程

`q:affected` 的目标是开发反馈，不是 release 验收。流程：changed files -> file risk classification -> owning modules -> affected tasks -> minimum required tasks -> report。

## 6. q:affected 与 full/release

`q:affected` **仍只是开发反馈**，affected 不可作为 release 验收，不替代 `q:full` 或 `q:release`。

## 7. 业务边界不变

game-core 独立性、ActionPipeline、SaveFile、fixture 边界不变。不进入 Stage 1B，不接真实 Cocos，不接 wx storage。

## 8. Cursor 预检

Cursor 预检是执行门禁，不是可选步骤。未确认预检报告前不得改文件。

## 9. cache 与 release

cache probe 位于 `.cache/quality`，report-only。`q:release` 不 include affected，`allowCache=false`。release gate 仍全量、无缓存、可复现。`release:build` / `release:check` 通过 `--project-target` 读取 release root/zip。

## 10. 后续路线（不是授权目标）

Nightly gate 实装、Wx Storage Port、完整 AST/symbol 自动索引均为后续候选，不是 v0.0.2.29 范围。traceability map 中 `planned` 条目**不是**当前实现。

## 11. 固定检查短语

`q:affected` 不可作为 release 验收。release gate 禁止 cache。`architecture-boundary.rules.json` 与 `architecture-boundary-check.mjs` 继续有效。`test:project-map-contracts` 与 `docs/GITHUB_WORKFLOW.md`、`docs/PROJECT_MAP.md` 保持 project-map-contracts 导航口径。
