# CHECK_ARCHITECTURE — v0.0.2.27

v0.0.2.27 / Pull Request CI Quality Gate Baseline 是 PR 远端质量门禁基线版，**不是业务架构修改版**。

## 1. 本轮检查目标

本轮不推进业务功能，只建立 GitHub Actions 远端 PR/main 质量门禁：`.github/workflows/quality-gate.yml` 在干净环境执行 `npm ci` + `npm run q:full`，并以 `test:github-actions-workflow-contracts` 防回退。既有 `test:cocos-session` / `test.cocos-session` 登记、traceability 地基（`traceability-map.json`、`test:traceability-contracts`、`quality.config.json` 的 `rules.traceabilityMap`）与 `test-registry` 继续由 `q:full` 覆盖。

## 2. 远端 workflow 与架构检查

- `q:full` **已经包含**架构检查链（含 `arch:check` / architecture-boundary）。
- GitHub Actions workflow **不再单独**执行 `arch:check`；远端正式检查命令只有 `npm run q:full`。
- full / release 语义**不变**：本地 release 仍须 `q:release` + `release:build` / `release:check`；远端本轮**只**跑 `q:full`。

## 3. traceability-contracts

`test:traceability-contracts` 通过 `quality.config.json` 读取 `rules.traceabilityMap`，校验 active entries 的 module/test/gate/路径一致性、planned 负向约束，以及 `TRACEABILITY_MATRIX.md` 边界短语。该测试**不得**推动业务源码重构。

## 4. version-surface-contracts（继承）

`test:version-surface-contracts` 继续验证 `project-target.json`、BuildId 派生与 release 权威。与 traceability 互补，不重复替代。

## 5. 现有门禁（继承既有 affected 策略）

- `arch:check` 继续执行 legacy validator 与 `architecture-boundary-check.mjs`。
- `architecture-boundary.rules.json` 中 authoritative 规则仍是 blocker。
- token/state-leak 规则继续 shadow findings / shadow_aligned 观察口径。

## 6. q:affected 流程

`q:affected` 的目标是开发反馈，不是 release 验收。流程：changed files -> file risk classification -> owning modules -> affected tasks -> minimum required tasks -> report。

## 7. q:affected 与 full/release

`q:affected` **仍只是开发反馈**，affected 不可作为 release 验收，不替代 `q:full` 或 `q:release`。远端 PR CI **不以** `q:affected` 为正式门禁。

## 8. 业务边界不变

game-core 独立性、ActionPipeline、SaveFile、fixture 边界不变。不进入 Stage 1B，不接真实 Cocos，不接 wx storage。

## 9. Cursor 预检

Cursor 预检是执行门禁，不是可选步骤。未确认预检报告前不得改文件。

## 10. cache 与 release

cache probe 位于 `.cache/quality`，report-only。`q:release` 不 include affected，`allowCache=false`。release gate 仍全量、无缓存、可复现。`release:build` / `release:check` 通过 `--project-target` 读取 release root/zip。

## 11. 后续路线（不是授权目标）

Nightly gate 实装、Wx Storage Port、完整 AST/symbol 自动索引、branch protection 强制配置均为后续候选，不是 v0.0.2.27 范围。traceability map 中 `planned` 条目**不是**当前实现。

## 12. 固定检查短语

`q:affected` 不可作为 release 验收。release gate 禁止 cache。`architecture-boundary.rules.json` 与 `architecture-boundary-check.mjs` 继续有效。`test:project-map-contracts` 与 `docs/GITHUB_WORKFLOW.md`、`docs/PROJECT_MAP.md` 保持 project-map-contracts 导航口径。
