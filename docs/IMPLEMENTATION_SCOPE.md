# IMPLEMENTATION_SCOPE — v0.0.2.24

版本：v0.0.2.24 / Quality Version Surface & BuildId Authority / 检查体系版本表面与构建标识权威源收敛版。

## 本轮范围

本轮只做 Quality Version Surface & BuildId Authority：以 `project-target.json` 为 version surface 与 release metadata 权威源，收敛 BuildId 派生、release root/zip、`version-consistency-check` 扫描面，并新增 `version-surface-contracts` 测试与文档同步。

## 明确不做

不进入 Stage 1B；不接真实 Cocos；不接 wx storage；不创建真实 Cocos Component/Scene/Prefab；不改变正式玩法；不新增 formal action；不改变 ActionPipeline；不改变 SaveFile；不改变正式 fixture；不做 flake/nightly；不做 Wx Storage Port；不引入 Bazel/Nx/Turborepo；不重构 quality runner 或 plugin-runtime。

## 门禁边界

q:affected 不替代 q:full，不替代 q:release。release gate 禁止 cache。

## 正式包来源

本轮仍基于正式包 v1.5.2.2。v0.0.2.24 是检查体系底座加固，不改变正式包设定。

## module_contracts 保留

`docs/module_contracts/` 为遗留上下文治理契约，**不删除**。新版 module-card 导航在 `docs/module-cards/`。

## 架构检查继承

`architecture-boundary.rules.json`、`architecture-boundary-check.mjs`、authoritative 与 shadow findings 分层继续有效。不删除旧 validator 核心红线。
