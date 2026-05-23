# 模拟游戏 Cocos 微信试水代码包 v0.0.2.22

本包定位为：**Affected Policy Hardening & Coverage Evidence / 受影响检查策略加固与覆盖证据版**。

- 代码包版本：`v0.0.2.22`
- npm package version：`0.0.2-22`
- release 根目录：`模拟游戏_Cocos微信试水代码包_v0_0_2_22`
- 设计来源：`模拟游戏_正式开发总设定包_v1_5_2_2_practical_ready.zip`
- 规则权威源：`tools/quality/rules/project-target.json`、`tools/quality/rules/context-doc-surface.rules.json`、`tools/quality/rules/architecture-boundary.rules.json`

## Task Intent Lock

本轮唯一目标是把 `q:affected` 从“可运行探针”加固为“可信开发反馈工具”：补齐 file risk classification、fallbackLevel、minimumRequiredTasks、taskSelectionReasons、skippedTaskReasons 和 affected coverage evidence report。

本轮明确不进入 Stage 1B，不接真实 Cocos，不接 wx storage，不创建真实 Cocos Component/Scene/Prefab，不新增玩法系统，不新增 formal action，不修改 ActionPipeline，不修改 SaveFile，不修改正式 fixture。

## q:affected 风险分级

`q:affected` 会按 changed files 分类：

- `docs-low`：`docs/**`、`README.md` 等文档面。
- `tests-medium`：`tests/**`。
- `quality-high`：`tools/quality/**`、quality rules、module graph、test registry、gate policy。
- `source-risky`：`src/game-core/**`、`src/cocos-app/**`、`src/cocos-creator-adapter/**`。
- `config-high`：`package.json`、`package-lock.json`、`tsconfig.json` 等配置面。
- `release-high`：`tools/build_release_package.py`、`tools/check_release_zip.py`。
- `global-high`：`design_snapshot/**`、schema/config/fixture 类全局契约面。
- `unknown-risky`：无法归属且不在明确安全列表的路径。

`unknown-risky` 不允许 fast-only 通过；必须触发 conservative fallback，并在 report 中说明原因。

## affected coverage evidence report

`reports/quality/affected-latest.json` 与 `affected-latest.md` 会记录：changed files、riskClassification、owning modules、affected modules、moduleToTaskMap、selectedTasks、taskSelectionReasons、skippedTasks、skippedTaskReasons、minimumRequiredTasks、missingMinimumTasks、fallbackLevel、fallbackReason、cache status 与 full/release warning。

若 minimumRequiredTasks 缺失，`q:affected` 必须失败，不能只警告。

## cache 与 release 边界

cache 仍是 `.cache/quality` 下的 report-only probe。cache hit/miss 会进入质量报告，但不改变任务执行结果，不跳过真实检查。

`q:affected` 只用于开发反馈，不替代 `q:full`、`q:release`、`release:build` 或 `release:check`。release gate 禁止 cache，release gate 仍全量、无缓存、可复现。release 包不得包含 `reports/quality` 或 `.cache/quality`。

## 常用命令

- `npm run q:fast`
- `npm run q:affected -- --changed-files src/game-core/index.ts`
- `npm run q:affected -- --changed-files unknown/path/outside-known-modules.txt`
- `npm run q:full`
- `npm run q:release`
- `npm run arch:check`
- `npm run check`
- `npm run release:build`
- `npm run release:check`

## 架构边界

`tools/quality/affected` 与 `tools/quality/cache` 只属于检查工具层，不属于游戏业务逻辑。它们不得反向影响 `src/game-core`、ActionPipeline、SaveFile、正式 fixture 或 runtime contract。

`game-core 独立于 Cocos / wx / 表现层` 仍是核心红线。`cocos-creator-adapter` 当前仍是纯 TypeScript、engine-neutral 的 Cocos Creator 适配探针，不接真实 Cocos、不接 wx。

## 检查规则兼容说明

后续建议不是授权目标。`arch:check` 继续运行 `architecture-boundary-check.mjs`；共享插件运行时负责质量插件执行。`architecture-boundary.rules.json` 中的 authoritative 规则继续阻断，shadow findings 继续记录；旧 validator 仍保留高风险权威阻断。

补充索引：`tools/quality/plugin-runtime` 是共享插件运行时所在目录。

边界继承短语：token/state-leak、shadow_aligned、allowed context 继续保留为架构边界检查成果；reports/quality 是临时质量报告目录。
