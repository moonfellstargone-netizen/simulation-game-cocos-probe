# IMPLEMENTATION_SCOPE — v0.0.2.27

版本：v0.0.2.27 / Pull Request CI Quality Gate Baseline / PR 远端质量门禁基线版。

## 本轮范围

本轮只做 GitHub Actions PR/main 远端质量门禁基线：新增 `.github/workflows/quality-gate.yml`，在面向 `main` 的 `pull_request`、`push` 与 `workflow_dispatch` 下于干净远端环境执行 `npm ci` 与 `npm run q:full`；新增 `tests/github-actions-workflow-contracts.test.mjs`（`test:github-actions-workflow-contracts` / registry `test.github-actions-workflow-contracts`）防止触发范围、Node 版本、权限边界与正式检查命令静默回退；并完成该目标必需的 `project-target.json` 版本面传播、`tools/quality/rules/traceability-map.json` 与 `docs/TRACEABILITY_MATRIX.md` 的 traceability 同步，以及项目地图、code-index、module-card、文档最小同步。

## 明确不做

不进入 Stage 1B；不接真实 Cocos；不接 wx storage；不创建真实 Cocos Component/Scene/Prefab；不改变正式玩法；不新增 formal action；不改变 ActionPipeline；不改变 SaveFile；不改变正式 fixture；不改变现有 full/release gate 语义；不配置 branch protection；不自动 release / tag / merge；不做 flake/nightly 实装；不做完整 AST/symbol 自动索引；不重构 quality runner 或 q:affected 核心 fallback。

## 门禁边界

q:affected 不替代 q:full，不替代 q:release。远端 CI 只跑 q:full。release gate 禁止 cache。planned / futureExtensions 不是当前实现。

## 正式包来源

本轮仍基于正式包 v1.5.2.2。v0.0.2.27 是 PR 远端质量门禁基线，不改变正式包设定。

## module_contracts 保留

`docs/module_contracts/` 为遗留上下文治理契约，**不删除**。新版 module-card 导航在 `docs/module-cards/`。

## 架构检查继承

`architecture-boundary.rules.json`、`architecture-boundary-check.mjs`、authoritative 与 shadow findings 分层继续有效。不删除旧 validator 核心红线。
