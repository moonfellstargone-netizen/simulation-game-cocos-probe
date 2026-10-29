# Quality Map — v0.0.2.27

## 系统职责

质量门禁：typecheck、architecture boundary、affected/full/release、版本一致性、release surface、**轻量 traceability**，以及复用 q:full 的 PR 自动执行入口。

## 涉及模块

- `tools`（module-graph）
- `tests`（契约测试）

## 关键文件

- `.github/workflows/quality.yml`（tools：Ubuntu PR 检查与报告保留）
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

- `tests/ci-workflow-contracts.test.mjs`（registry `test.ci-workflow-contracts`，追踪 `trace.quality.pr-ci`）
- `tests/traceability-contracts.test.mjs`
- `tests/quality-gate-contracts.test.mjs`
- `tests/quality-affected-policy-hardening.test.mjs`
- `tests/version-surface-contracts.test.mjs`
- `tests/context-governance-contracts.test.mjs`
- `tests/cocos-runtime-session.test.ts`（registry `test.cocos-session`：Session/ViewModel/SaveStoragePort 边界，登记闭合进 `q:full`）

## 修改前必读

- [`CHECK_ARCHITECTURE.md`](../CHECK_ARCHITECTURE.md)
- [`GITHUB_WORKFLOW.md`](../GITHUB_WORKFLOW.md)
- [`TRACEABILITY_MATRIX.md`](../TRACEABILITY_MATRIX.md)

## 修改后必跑

- `npm run q:full`
- 涉及 release 时 `npm run q:release`

## 常见风险

- 把 q:affected 写成 release 替代品
- 修改 gate 核心逻辑超出 Task Intent Lock
- traceability active/planned 语义混淆
- project-target 与 README 版本不一致
- 报告上传掩盖门禁失败、旧运行报告误作新提交通过证据
- 把 CI 文件存在误认为云端已通过或分支保护已启用

## 关联 module-cards

quality-tools, release-tools
