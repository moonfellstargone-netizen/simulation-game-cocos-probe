# IMPLEMENTATION_SCOPE — v0.0.2.27

版本：v0.0.2.27 / PR Quality Gate / PR 自动质量验证版。

## 本轮范围

本轮只做 PR 自动质量验证：新增 `.github/workflows/quality.yml`，PR 到 `main` 时，在单个 Ubuntu 24.04 job 使用 Node 24、Python 3.12，执行 `npm ci` 和现有 `npm run q:full`；另提供 `workflow_dispatch`。成功或失败均尝试上传 JSON / Markdown 质量报告，保留 7 天；缺失报告必须明确报错，不以 artifact 上传掩盖门禁失败。

`tests/ci-workflow-contracts.test.mjs` 校验 YAML 语义与负向变体，正式登记为 `test.ci-workflow-contracts`（`full`+`blocker`）；`trace.quality.pr-ci` 在 `traceability-map.json` 与 `TRACEABILITY_MATRIX` 闭合工作流、模块、测试和 gate。包卫生检查只排除根 `.git` 元数据，补齐跨平台路径与项目日志、缓存反例，保持实际交付卫生约束。其余为该目标必需的 `project-target.json` 版本面传播及项目地图、code-index、module-cards 的最小同步。

既有 `test:cocos-session` / `test.cocos-session` 与 `trace.cocos.session-viewmodel-port` 继续有效，不因新增 CI 入口退出完整检查。云端运行通过情况以具体 PR 的 Checks / Actions 和报告为证，不能由本机结果推定。

## 明确不做

不进入 Stage 1B；不接真实 Cocos；不接 wx storage；不创建真实 Cocos Component/Scene/Prefab；不改变正式玩法；不新增 formal action；不改变 ActionPipeline；不改变 SaveFile；不改变正式 fixture；不做 flake/nightly 实装；不做完整 AST/symbol 自动索引；不重构 quality runner 或 q:affected 核心 fallback。

## 门禁边界

q:affected 不替代 q:full，不替代 q:release。release gate 禁止 cache。planned / futureExtensions 不是当前实现。

## 正式包来源

本轮仍基于正式包 v1.5.2.2。v0.0.2.27 是 PR 自动质量验证，不改变正式包设定。

## module_contracts 保留

`docs/module_contracts/` 为遗留上下文治理契约，**不删除**。新版 module-card 导航在 `docs/module-cards/`。

## 架构检查继承

`architecture-boundary.rules.json`、`architecture-boundary-check.mjs`、authoritative 与 shadow findings 分层继续有效。不删除旧 validator 核心红线。
