# Quality Map — v0.0.2.27

## 系统职责

质量门禁：typecheck、architecture boundary、affected/full/release、版本一致性、release surface、轻量 traceability，以及 **GitHub Actions 远端 PR/main `q:full` 门禁**。

## 涉及模块

- `tools`（module-graph）
- `tests`（契约测试）
- `.github/workflows/`（仓库治理，非业务代码）

## 关键文件

- `.github/workflows/quality-gate.yml`
- `tools/quality/run-quality-gate.mjs`
- `tools/quality/module-graph.json`
- `tools/quality/test-registry.json`
- `tools/quality/gate-policy.json`
- `tools/quality/rules/project-target.json`
- `tools/quality/rules/traceability-map.json`
- `tools/quality/quality.config.json`（`rules.traceabilityMap`）
- `tools/quality/affected/*`
- `tools/quality/plugins/*`

## 关键测试

- `tests/github-actions-workflow-contracts.test.mjs`（registry `test.github-actions-workflow-contracts`：触发、Node 20、`contents: read`、concurrency、PR head SHA、`npm ci` + `npm run q:full`）
- `tests/traceability-contracts.test.mjs`
- `tests/quality-gate-contracts.test.mjs`
- `tests/quality-affected-policy-hardening.test.mjs`
- `tests/version-surface-contracts.test.mjs`
- `tests/context-governance-contracts.test.mjs`
- `tests/cocos-runtime-session.test.ts`（registry `test.cocos-session`：Session/ViewModel/SaveStoragePort 边界，继续由 `q:full` 覆盖）

## 远端 CI 要点

- 工作流：`.github/workflows/quality-gate.yml`
- 触发：`pull_request`/`main`、`push`/`main`、`workflow_dispatch`
- PR 检出：`github.event.pull_request.head.sha`；main push / dispatch：`github.sha`
- 权限：`contents: read`；并发：`cancel-in-progress: true`
- 远端正式命令：仅 `npm ci` + `npm run q:full`（不跑 `q:affected`，不自动 release）
- 远端真实成功 run 出现前，不得宣称远端验收完成

## 修改前必读

- [`CHECK_ARCHITECTURE.md`](../CHECK_ARCHITECTURE.md)
- [`GITHUB_WORKFLOW.md`](../GITHUB_WORKFLOW.md)
- [`TRACEABILITY_MATRIX.md`](../TRACEABILITY_MATRIX.md)

## 修改后必跑

- `npm run test:github-actions-workflow-contracts`（改 workflow 时）
- `npm run q:full`
- 涉及 release 时 `npm run q:release`

## 常见风险

- 把 q:affected 写成 release 或 PR CI 替代品
- workflow 静默扩大权限或改掉正式检查命令
- 修改 gate 核心逻辑超出 Task Intent Lock
- traceability active/planned 语义混淆
- project-target 与 README 版本不一致
- 无远端 run 证据却宣称远端完成

## 关联 module-cards

quality-tools, release-tools
