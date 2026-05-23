# CHECK_ARCHITECTURE — v0.0.2.23

v0.0.2.23 / Project Map & Git Workflow Readiness 是项目地图与 GitHub 工作流准备版，**不是业务架构修改版**。

## 1. 本轮检查目标

本轮不推进业务功能，只建立项目地图、GitHub 工作流文档、`project-map-contracts` 契约测试与版本口径同步。

## 2. project-map-contracts

`test:project-map-contracts` 是文档治理契约测试：检查地图文档存在、入口链接、路径存在性、禁止错误权威口径。该测试**不得**推动业务源码重构。入口见 [`GITHUB_WORKFLOW.md`](GITHUB_WORKFLOW.md) 与 [`PROJECT_MAP.md`](PROJECT_MAP.md)。

## 3. 现有门禁（继承既有 affected 策略）

- `arch:check` 继续执行 legacy validator 与 `architecture-boundary-check.mjs`。
- `architecture-boundary.rules.json` 中 authoritative 规则仍是 blocker。
- token/state-leak 规则继续 shadow findings / shadow_aligned 观察口径。

## 4. q:affected 流程

`q:affected` 的目标是开发反馈，不是 release 验收。流程：changed files -> file risk classification -> owning modules -> affected tasks -> minimum required tasks -> report。

## 5. q:affected 与 full/release

`q:affected` **仍只是开发反馈**，affected 不可作为 release 验收，不替代 `q:full` 或 `q:release`。docs / module-cards / code-index 负责导航，不替代源码。

## 6. 业务边界不变

game-core 独立性、ActionPipeline、SaveFile、fixture 边界不变。不进入 Stage 1B，不接真实 Cocos，不接 wx storage。

## 7. Cursor 预检

Cursor 预检是执行门禁，不是可选步骤。未确认预检报告前不得改文件。

## 8. cache 与 release

cache probe 位于 `.cache/quality`，report-only。`q:release` 不 include affected，`allowCache=false`。release gate 仍全量、无缓存、可复现。

## 9. 后续路线（不是授权目标）

v0.0.2.24 BuildId Authority、v0.0.2.25 Flake/Nightly Gate、v0.0.2.26 Wx Storage Port 均为后续候选，不是 v0.0.2.23 范围。

## 10. 固定检查短语

`q:affected` 不可作为 release 验收。release gate 禁止 cache。`architecture-boundary.rules.json` 与 `architecture-boundary-check.mjs` 继续有效。
