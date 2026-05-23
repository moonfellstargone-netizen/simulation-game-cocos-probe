# CHECK_ARCHITECTURE — v0.0.2.22

v0.0.2.22 / Affected Policy Hardening & Coverage Evidence 是受影响检查策略加固与覆盖证据版。

## 1. 本轮检查目标

本轮不推进业务功能，只把 `q:affected` 加固为可信开发反馈工具。核心补强点是：riskClassification、fallbackLevel、minimumRequiredTasks、taskSelectionReasons、skippedTaskReasons 与 coverage evidence report。

## 2. 现有门禁

- `arch:check` 继续执行 legacy validator 与 `architecture-boundary-check.mjs`。
- `architecture-boundary.rules.json` 中低风险 import/path ownership 规则仍是 authoritative blocker。
- token/state-leak 规则继续保留 shadow findings / shadow_aligned 观察口径。
- 旧 validator 仍保留高风险红线，不迁高风险规则为唯一权威。

## 3. q:affected 流程

`q:affected` 的目标是开发反馈，不是 release 验收。流程为：changed files -> file risk classification -> owning modules -> reverse dependency closure -> affected tasks -> minimum required tasks verification -> report。

changed files 由 CLI、文件列表或 git diff 解析；module graph 负责 owning modules 与 reverse dependency closure；test registry 负责把 affected modules 映射到可执行任务；无法安全判断时使用 conservative fallback。

## 4. riskClassification

当前风险类型：`docs-low`、`tests-medium`、`quality-high`、`source-risky`、`config-high`、`release-high`、`global-high`、`unknown-risky`。

`unknown-risky` 是保守默认值。无法归属的 changed file 不得静默走轻量 fast-only。

## 5. fallbackLevel

当前 fallbackLevel：

- `none`：无需额外 fallback。
- `fast`：文档或测试类低中风险快速反馈。
- `conservative`：source-risky、quality-high、unknown-risky 等需要保守覆盖。
- `release-surface`：release tooling 改动时触发 release surface 检查，并提醒仍需 `q:release`。
- `full-recommended`：config/global 高风险改动时，affected 提供反馈，但完成前建议跑 `q:full`。

fallbackLevel 与 fallbackReason 必须写入 affected report。

## 6. minimumRequiredTasks

`q:affected` 每次至少包含 version/config/test-registry integrity。不同风险类型追加最低任务集合：source-risky 要覆盖 typecheck、legacy architecture、architectureBoundary、Stage 1A baseline 与 API boundary；unknown-risky 要覆盖 typecheck、legacy architecture、architectureBoundary、package hygiene、affected/cache tests；release-high 要覆盖 releaseSurface 与 package hygiene。

若 selected tasks 缺少 minimumRequiredTasks，`q:affected` 必须失败。

## 7. taskSelectionReasons / skippedTaskReasons

每个 selected task 必须有选择原因，原因来自 baseline、minimum task、fallback gate、affected module coverage 或 risk match。skipped task 必须说明是 release/nightly 排除、非相关模块、非当前风险组，或被识别为缺失 minimum task。

## 8. coverage evidence

`affected-latest.json` 与 `affected-latest.md` 必须输出：changed files、riskClassification、owning modules、affected modules、moduleToTaskMap、selectedTasks、taskSelectionReasons、skippedTasks、skippedTaskReasons、minimumRequiredTasks、missingMinimumTasks、fallbackLevel、fallbackReason、cache status 与 full/release warning。

## 9. cache report-only

cache probe 位于 `.cache/quality`，只作为报告型本地探针。cache hit/miss 会进入 affected report，但本轮不让 cache 跳过真实任务。release gate 禁止 cache，full gate 也不默认依赖 cache。

## 10. release 禁止 cache

`q:release` 不 include affected，`allowCache=false`。release build/check 不读取 cache。release zip 检查必须排除 `reports/quality`、`.cache/quality`、日志包内容、node_modules、coverage 和 dist。

## 11. 为什么暂不做 Flake / Nightly Gate

v0.0.2.22 先补足 affected policy 的覆盖证据。如果在 affected policy 尚不可信时引入 flake/nightly，会扩大检查矩阵复杂度，并可能让漏跑风险被更复杂的报告掩盖。因此后续再做 flake/nightly 更稳。

## 12. 后续路线

后续可进入 `v0.0.2.23 Flake / Nightly Gate`，或者如果 affected 仍有误判风险，先插入 `Affected Policy Hardening Phase 2`。再之后可做 `Wx Storage Port Probe`，但不得在 core 中直接 import wx。

## 13. 固定检查短语

本节登记当前检查规则要求的明确口径：`q:affected` 仍遵循 changed files -> modules -> tasks 的基本链路，在此基础上补充 riskClassification 和 coverage evidence。cache probe 只报告，不替代执行。affected 不可作为 release 验收，release gate 禁止 cache，release gate 仍全量、无缓存、可复现。`architecture-boundary.rules.json` 与 `architecture-boundary-check.mjs` 继续有效。
