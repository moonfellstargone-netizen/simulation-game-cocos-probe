# IMPLEMENTATION_SCOPE — v0.0.2.22

版本：v0.0.2.22 / Affected Policy Hardening & Coverage Evidence / 受影响检查策略加固与覆盖证据版。

## 本轮范围

本轮只做 affected policy 加固与覆盖证据：riskClassification、fallbackLevel、minimumRequiredTasks、taskSelectionReasons、skippedTaskReasons、missing minimum fail 与 affected report 强化。

## 明确不做

不进入 Stage 1B；不接真实 Cocos；不接 wx storage；不创建真实 Cocos Component/Scene/Prefab；不改变正式玩法；不新增 formal action；不改变 ActionPipeline；不改变 SaveFile；不改变正式 fixture；不做 flake/nightly；不做远程缓存；不引入 Bazel/Nx/Turborepo。

## 门禁边界

`q:affected` 不替代 `q:full`，不替代 `q:release`。release gate 禁止 cache。cache 仍是 report-only probe，不用于 release 权威判断。

## 正式包来源

本轮仍基于正式包 v1.5.2.2。v0.0.2.22 是代码包内部检查体系治理，不改变正式包设定。

## 架构检查继承

本轮仍保留 `architecture-boundary.rules.json`、`architecture-boundary-check.mjs`、authoritative 与 shadow findings 分层。不删除旧 validator 的核心红线。`q:affected` 不替代 q:full，不替代 q:release；cache probe 只报告，release gate 禁止 cache。

## 边界继承短语

token/state-leak 与 shadow_aligned 继续保留为架构边界检查成果。
