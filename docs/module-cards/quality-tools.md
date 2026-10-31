---
doc_type: module_card
status: active
applies_to: cocos-probe
source_of_truth: false
---

# quality-tools

## 模块职责

质量门禁配置与插件：module-graph、test-registry、gate-policy、affected/cache、architecture-boundary 插件、**traceability-map**；归属 tools 的 PR CI 工作流复用 q:full，保留执行报告。

## 不负责什么

- 游戏玩法规则
- 替代 release 权威判断

## 允许依赖

- tools 内部；不得反向依赖 game-core 源码（见 module-graph）

## 禁止依赖

- `src/game-core/**`

## 关键文件

- `.github/workflows/quality.yml`
- `tools/quality/run-quality-gate.mjs`
- `tools/quality/module-graph.json`
- `tools/quality/test-registry.json`
- `tools/quality/gate-policy.json`
- `tools/quality/quality.config.json`
- `tools/quality/rules/traceability-map.json`
- `tools/quality/lib/projectTarget.mjs`
- `tools/quality/lib/versionSurface.mjs`
- `tools/quality/plugins/*`

## 关键测试

- `tests/ci-workflow-contracts.test.mjs`（registry `test.ci-workflow-contracts`，full+blocker；追踪 `trace.quality.pr-ci`）
- `tests/traceability-contracts.test.mjs`
- `tests/quality-gate-contracts.test.mjs`
- `tests/quality-affected-policy-hardening.test.mjs`
- `tests/version-surface-contracts.test.mjs`
- `tests/cocos-runtime-session.test.ts`（registry `test.cocos-session`：`test:cocos-session` 登记闭合进 `q:full`，`trace.cocos.session-viewmodel-port` 追踪）

## 修改前必须读取

- `docs/CHECK_ARCHITECTURE.md`
- `docs/GITHUB_WORKFLOW.md`
- `docs/TRACEABILITY_MATRIX.md`

## 修改后必须运行

- `npm run q:full`

## 常见失败模式

- q:affected 语义扩写成 release 替代
- project-target 与 package 版本漂移
- planned traceability entry 误标为 active 当前实现
- 忽略 PR 门禁失败，或把上传 artifact 成功当作质量门禁成功

## 代码—地图同步

quality-map、TRACEABILITY_MATRIX、GLOSSARY 中 q:*、PR CI 与 traceability 术语；CI 工作流、契约测试及 test-registry 入口保持一致。

## 独立真实Web验收工具

`tools/cocos-probe/build.mjs`、`tools/cocos-probe/verify-web.mjs`及`tools/cocos-probe/lib/webProbeSupport.mjs`负责构建摘要、来源闭合和本地真实浏览器矩阵。`test.cocos-web-verification-contracts`纳入full/blocker并登记共享输入，`trace.cocos.web-viewport-input`追踪。Node契约不运行真实浏览器；CI不因该任务通过而获得引擎验收结论。

## 临时存读档交互与恢复

trace.cocos.web-save-load-recovery连接apps/cocos-probe/template/assets/scripts/CocosWebProbe.ts、ProbeInteraction.ts和src/cocos-creator-adapter/shell/CocosUiCommandQueue.ts；根typecheck仍只覆盖src。外层真实三按钮使用固定本页内存槽web_probe，当前反馈读取command_result，历史面板错误保留但不覆盖本次结果。ProbeInteraction保证busy与销毁后迟到保护；tests/cocos-web-interaction.test.ts由既有test.cocos-engine-probe-lifecycle实际执行并登记files/covers，新增helper和test分别验证单文件affected选择。Queue/component行为回归与浏览器工具契约保持full/blocker；真实Creator/Chrome物理点击、读取恢复及刷新清空独立验收，不能由Node通过推导。
