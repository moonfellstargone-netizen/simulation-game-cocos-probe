# ARCHITECTURE — v0.0.2.28

当前版本：v0.0.2.28 / Save Storage Failure Contracts。业务架构边界与上一版一致，本轮不改变 ActionPipeline、SaveFile 或 fixture。

## 1. 业务架构不变

`game-core 独立于 Cocos / wx / 表现层` 仍是核心红线。`cocos-creator-adapter` 仍是纯 TypeScript、engine-neutral 的 Cocos Creator 适配探针（cocos-creator-adapter 仍是 TypeScript probe），不接真实 Cocos、不接 wx、不接 fs。

本轮不改变 ActionPipeline，不改变 SaveFile，不改变正式 fixture，不新增 gameplay action，不进入 Stage 1B。

## 2. tools/quality/affected

`tools/quality/affected` 是检查工具层，不属于游戏业务逻辑。它只读取 changed files、module graph、test registry、gate policy 与 quality rules，用于计算受影响模块、任务集合和覆盖证据。

它不得修改 `src/game-core`，不得成为 ActionPipeline、SaveFile、fixture 或 runtime contract 的权威来源。

## 3. affected policy 与业务逻辑隔离

affected policy 的风险分级、fallbackLevel、minimumRequiredTasks、taskSelectionReasons 和 skippedTaskReasons 只决定开发期检查覆盖，不决定游戏玩法规则，不改变正式状态流转，不新增 formal action。

## 4. cache 边界

`tools/quality/cache` 管理 `.cache/quality` report-only probe。cache 不参与 release 权威判断，不跳过 release/full 的关键任务，不改变任务失败语义。

## 5. traceability 层

`tools/quality/rules/traceability-map.json` 与 `docs/TRACEABILITY_MATRIX.md` 是文档治理追踪层，不属于游戏业务逻辑，不替代 module-card 或源码。

## 6. 架构边界检查继承

`architecture-boundary.rules.json` 与 `architecture-boundary-check.mjs` 继续承担架构边界检查；authoritative blocker 与 shadow findings 的分层不因 `q:affected` 改变。旧 validator 仍保留高风险红线。

## 7. 固定边界短语

game-core 独立于 Cocos / wx / 表现层。tools/quality 仍是检查工具层，不属于游戏业务逻辑。不改变 ActionPipeline。不改变 SaveFile。不改变正式 fixture。

## 8. PR CI 执行入口

`.github/workflows/quality.yml` 归属 tools 检查基础设施，只调用锁定依赖安装和既有 `q:full`；工作流 YAML 契约、报告 artifact 与 `trace.quality.pr-ci` 提供执行追踪。它不进入 game-core 运行时依赖，不增加平台适配或正式状态入口，也不改变 full / release 的失败与缓存边界。

## 9. 存储故障验证边界

现有 `SaveStoragePort` 只隔离平台读写；Session 保持候选读档提交策略，Controller 展示错误并清除旧成功结果，Queue 保持串行执行和失败后继续。`tests/support/controlledSaveStoragePort.ts` 组合既有内存端口，验证即时或延迟拒绝及恢复，不接真实平台，不注入游戏运行时依赖。

本轮不新增 ErrorCode 权威、不改变 byte_length、不承诺真实存储部分写入后的原子回滚；参见 ADR-0003、SaveStoragePort 契约与 `trace.save.storage-failure-recovery`。
