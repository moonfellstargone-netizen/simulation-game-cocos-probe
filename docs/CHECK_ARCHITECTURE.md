# CHECK_ARCHITECTURE — v0.0.2.24

v0.0.2.24 / Quality Version Surface & BuildId Authority 是检查体系版本表面与 BuildId 权威源收敛版，**不是业务架构修改版**。

## 1. 本轮检查目标

本轮不推进业务功能，只加固 `project-target.json` 权威、version surface、BuildId 派生、release `--project-target`、`version-consistency-check` 扫描面与 `version-surface-contracts` 测试登记。

## 2. version-surface-contracts

`test:version-surface-contracts` 验证 helper 派生、release 权威收敛、旧 BuildId/release root 扫描与 gate 登记。该测试**不得**推动业务源码重构。

## 3. 现有门禁（继承既有 affected 策略）

- `arch:check` 继续执行 legacy validator 与 `architecture-boundary-check.mjs`。
- `architecture-boundary.rules.json` 中 authoritative 规则仍是 blocker。
- token/state-leak 规则继续 shadow findings / shadow_aligned 观察口径。

## 4. q:affected 流程

`q:affected` 的目标是开发反馈，不是 release 验收。流程：changed files -> file risk classification -> owning modules -> affected tasks -> minimum required tasks -> report。

## 5. q:affected 与 full/release

`q:affected` **仍只是开发反馈**，affected 不可作为 release 验收，不替代 `q:full` 或 `q:release`。

## 6. 业务边界不变

game-core 独立性、ActionPipeline、SaveFile、fixture 边界不变。不进入 Stage 1B，不接真实 Cocos，不接 wx storage。

## 7. Cursor 预检

Cursor 预检是执行门禁，不是可选步骤。未确认预检报告前不得改文件。

## 8. cache 与 release

cache probe 位于 `.cache/quality`，report-only。`q:release` 不 include affected，`allowCache=false`。release gate 仍全量、无缓存、可复现。`release:build` / `release:check` 通过 `--project-target` 读取 release root/zip。

## 9. 后续路线（不是授权目标）

Flake/Nightly Gate、Wx Storage Port、Project Map 自动索引均为后续候选，不是 v0.0.2.24 范围。

## 10. 固定检查短语

`q:affected` 不可作为 release 验收。release gate 禁止 cache。`architecture-boundary.rules.json` 与 `architecture-boundary-check.mjs` 继续有效。`test:project-map-contracts` 与 `docs/GITHUB_WORKFLOW.md`、`docs/PROJECT_MAP.md` 保持 project-map-contracts 导航口径。
