# Quality Map — v0.0.2.32

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

- `tests/cocos-probe-preparation.test.mjs`、`tests/cocos-engine-probe-lifecycle.test.ts`（新full/blocker，trace.cocos.web-bootstrap-probe）

- `tests/stage1a-bootstrap.test.ts`（registry `test.stage1a-bootstrap`：正式资源经公共入口的独立集成验收，追踪`trace.runtime.bootstrap-resources`）
- `tests/cocos-scene-binding-application.test.ts`、`tests/cocos-component-node-binding-application.test.ts`（现有full/blocker绑定任务，受控辅助`tests/support/controlledBindingPort.ts`，追踪`trace.cocos.binding-async-recovery`）
- `tests/quality-affected-contracts.test.mjs`（验证各绑定测试及辅助单独变化时真实任务选择，不改算法）
- `tests/ci-workflow-contracts.test.mjs`（registry `test.ci-workflow-contracts`，追踪 `trace.quality.pr-ci`）
- `tests/traceability-contracts.test.mjs`
- `tests/quality-gate-contracts.test.mjs`
- `tests/quality-affected-policy-hardening.test.mjs`
- `tests/version-surface-contracts.test.mjs`
- `tests/context-governance-contracts.test.mjs`
- `tests/cocos-runtime-session.test.ts`（registry `test.cocos-session`：Session/ViewModel/SaveStoragePort 边界，登记闭合进 `q:full`）
- `tests/cocos-save-load-ui-binding.test.ts`、`tests/cocos-ui-command-queue.test.ts`：与 Session 测试共同扩充存储故障保护及恢复用例，沿用既有 full/blocker 任务，追踪 `trace.save.storage-failure-recovery`。

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
- 测试已登记但仅改测试或共享辅助时affected漏选；只断言返回snapshot而未验证端口实际内容

## 关联 module-cards

quality-tools, release-tools

新outer与prepare工具的归属、单向依赖、来源摘要和实际affected选择纳入自动契约；真实Creator预览/Web构建另行验收，不能让无引擎CI的q:full冒充引擎通过。

## 桌面Web视口与输入

`apps/cocos-probe/template/build-templates/web-desktop/`是页面容器/resize源模板；`tools/cocos-probe/build.mjs`记录产物摘要，`tools/cocos-probe/verify-web.mjs`与`tools/cocos-probe/lib/webProbeSupport.mjs`核对来源后运行真实鼠标矩阵。`tests/cocos-web-verification-contracts.test.mjs`登记full/blocker，仅验证Node工具边界，不能作为实际Creator或浏览器通过证据。

`trace.cocos.web-viewport-input`连接模板、工具、契约、affected与实际验收说明；支持范围见[引擎探针模块卡](../module-cards/cocos-engine-probe.md)。不能用observer.advance绕过物理点击；窗口变化保留原会话，不引入真实存储或微信。
