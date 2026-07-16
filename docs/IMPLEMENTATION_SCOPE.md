# IMPLEMENTATION_SCOPE — v0.0.2.26

版本：v0.0.2.26 / Quality Test Registry Closure / 检查体系测试登记闭合版。

## 本轮范围

本轮只做检查体系测试登记闭合：把已存在的 `test:cocos-session` / `tests/cocos-runtime-session.test.ts` 正式登记进 `tools/quality/test-registry.json`（新增 `test.cocos-session`，带 `full`+`blocker`），使 `q:full` 实际执行该任务，并在 `tools/quality/rules/traceability-map.json` 的 `trace.cocos.session-viewmodel-port` 与 `docs/TRACEABILITY_MATRIX.md` 之间闭合 traceability 追踪链；`tests/traceability-contracts.test.mjs` 增加轻量防回退契约。其余为该目标必需的 `project-target.json` 版本面传播与项目地图、code-index、module-card、文档最小同步。

## 明确不做

不进入 Stage 1B；不接真实 Cocos；不接 wx storage；不创建真实 Cocos Component/Scene/Prefab；不改变正式玩法；不新增 formal action；不改变 ActionPipeline；不改变 SaveFile；不改变正式 fixture；不做 flake/nightly 实装；不做完整 AST/symbol 自动索引；不重构 quality runner 或 q:affected 核心 fallback。

## 门禁边界

q:affected 不替代 q:full，不替代 q:release。release gate 禁止 cache。planned / futureExtensions 不是当前实现。

## 正式包来源

本轮仍基于正式包 v1.5.2.2。v0.0.2.26 是检查体系测试登记闭合，不改变正式包设定。

## module_contracts 保留

`docs/module_contracts/` 为遗留上下文治理契约，**不删除**。新版 module-card 导航在 `docs/module-cards/`。

## 架构检查继承

`architecture-boundary.rules.json`、`architecture-boundary-check.mjs`、authoritative 与 shadow findings 分层继续有效。不删除旧 validator 核心红线。
