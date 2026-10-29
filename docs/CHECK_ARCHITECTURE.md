# CHECK_ARCHITECTURE — v0.0.2.27

v0.0.2.27 / PR Quality Gate 是 PR 自动质量验证版。质量执行入口扩展到 GitHub Actions，业务架构保持不变。

## 1. 本轮检查目标

本轮只做 PR 自动质量验证：`.github/workflows/quality.yml` 在 PR 到 `main` 时执行现有 `q:full`，使用 Ubuntu 24.04、Node 24 和 Python 3.12，先 `npm ci` 再运行完整门禁；也提供 `workflow_dispatch`。CI 保留门禁退出码，成功或失败均尝试上传本轮 `reports/quality/latest.json` 与 `latest.md`，保留 7 天；报告缺失明确报错。

新增 `test:ci-workflow-contracts` 通过 YAML 语义及负向变体验证触发、权限、固定 Action 提交、失败可见性和报告保留；在 `test-registry` 中登记为 `test.ci-workflow-contracts`，带 `full`+`blocker`。`trace.quality.pr-ci` 与 `TRACEABILITY_MATRIX.md` 追踪这条链路，quality-map / module-card / code-index 同步入口。

包卫生扫描只排除根 `.git` 元数据，项目内日志与缓存仍受反例约束。既有 `test:cocos-session` / `tests/cocos-runtime-session.test.ts`（`test.cocos-session`）继续进入 `q:full`，保留 `trace.cocos.session-viewmodel-port`。traceability 地基（`traceability-map.json`、`test:traceability-contracts`、`quality.config.json` 的 `rules.traceabilityMap`）继续沿用。

PR CI 不执行 release 打包；GitHub 具体运行与分支保护设置分别核对，不把本地通过记录或工作流文件存在当作云端通过或保护已启用。

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

Nightly gate 实装、Wx Storage Port、完整 AST/symbol 自动索引均为后续候选，不是 v0.0.2.27 范围。traceability map 中 `planned` 条目**不是**当前实现。

## 11. 固定检查短语

`q:affected` 不可作为 release 验收。release gate 禁止 cache。`architecture-boundary.rules.json` 与 `architecture-boundary-check.mjs` 继续有效。`test:project-map-contracts` 与 `docs/GITHUB_WORKFLOW.md`、`docs/PROJECT_MAP.md` 保持 project-map-contracts 导航口径。
