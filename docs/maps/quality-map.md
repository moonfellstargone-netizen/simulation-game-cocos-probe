# Quality Map — v0.0.2.23

## 系统职责

质量门禁：typecheck、architecture boundary、affected/full/release、版本一致性与 release surface。

## 涉及模块

- `tools`（module-graph）
- `tests`（契约测试）

## 关键文件

- `tools/quality/run-quality-gate.mjs`
- `tools/quality/module-graph.json`
- `tools/quality/test-registry.json`
- `tools/quality/gate-policy.json`
- `tools/quality/rules/project-target.json`
- `tools/quality/affected/*`
- `tools/quality/plugins/*`

## 关键测试

- `tests/quality-gate-contracts.test.mjs`
- `tests/quality-affected-policy-hardening.test.mjs`
- `tests/project-map-contracts.test.mjs`
- `tests/context-governance-contracts.test.mjs`

## 修改前必读

- [`CHECK_ARCHITECTURE.md`](../CHECK_ARCHITECTURE.md)
- [`GITHUB_WORKFLOW.md`](../GITHUB_WORKFLOW.md)

## 修改后必跑

- `npm run q:full`
- 涉及 release 时 `npm run q:release`

## 常见风险

- 把 q:affected 写成 release 替代品
- 修改 gate 核心逻辑超出 Task Intent Lock
- project-target 与 README 版本不一致

## 关联 module-cards

quality-tools, release-tools
