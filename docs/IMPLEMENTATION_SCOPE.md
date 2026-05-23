# IMPLEMENTATION_SCOPE — v0.0.2.25

版本：v0.0.2.25 / Project Map Auto Index & Traceability Lite / 项目地图自动索引与轻量可追踪矩阵版。

## 本轮范围

本轮只做 Project Map Auto Index & Traceability Lite：新增 `docs/TRACEABILITY_MATRIX.md`、`tools/quality/rules/traceability-map.json`、`tests/traceability-contracts.test.mjs`，登记 `test:traceability-contracts`，并在 `quality.config.json` 配置 `rules.traceabilityMap` 与 `project-target.json` 版本传播；同步项目地图、code-index、module-card 与文档。

## 明确不做

不进入 Stage 1B；不接真实 Cocos；不接 wx storage；不创建真实 Cocos Component/Scene/Prefab；不改变正式玩法；不新增 formal action；不改变 ActionPipeline；不改变 SaveFile；不改变正式 fixture；不做 flake/nightly 实装；不做完整 AST/symbol 自动索引；不重构 quality runner 或 q:affected 核心 fallback。

## 门禁边界

q:affected 不替代 q:full，不替代 q:release。release gate 禁止 cache。planned / futureExtensions 不是当前实现。

## 正式包来源

本轮仍基于正式包 v1.5.2.2。v0.0.2.25 是文档治理与质量追踪地基，不改变正式包设定。

## module_contracts 保留

`docs/module_contracts/` 为遗留上下文治理契约，**不删除**。新版 module-card 导航在 `docs/module-cards/`。

## 架构检查继承

`architecture-boundary.rules.json`、`architecture-boundary-check.mjs`、authoritative 与 shadow findings 分层继续有效。不删除旧 validator 核心红线。
