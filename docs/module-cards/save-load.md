---
doc_type: module_card
status: active
applies_to: cocos-probe
source_of_truth: false
---

# save-load

## 模块职责

存档序列化与迁移：`SaveManager`、`SaveMigrationRegistry`、`NewGameBuilder`；端口 `SaveStoragePort` 定义在 game-core。

## 不负责什么

- 表现层 slot UI（在 cocos-creator-adapter）
- 直接 wx 文件 API

## 允许依赖

- game-core 内部

## 禁止依赖

- cocos 层直接写 SaveFile

## 关键文件

- `src/game-core/save/SaveManager.ts`
- `src/game-core/save/SaveStoragePort.ts`
- `src/game-core/save/NewGameBuilder.ts`

## 关键测试

- `tests/stage1a-fixture-runner.test.ts`
- `tests/cocos-save-load-ui-binding.test.ts`（UI 绑定边界）
- `tests/cocos-runtime-session.test.ts`（读写拒绝、空槽区别、完整状态保留与重试）
- `tests/cocos-ui-command-queue.test.ts`（受控延迟拒绝、串行顺序和后续恢复）
- `tests/support/controlledSaveStoragePort.ts`（组合既有内存端口，测试辅助）
- active 追踪 `trace.save.storage-failure-recovery`，沿用上述三个既有 full/blocker 任务。

## 修改前必须读取

- `docs/adr/ADR-0003-load-failure-must-not-mutate-current-session.md`
- `docs/module_contracts/SaveStoragePort.contract.md`

## 修改后必须运行

- `npm run test:fixture`
- `npm run test:cocos-save-load`
- `npm run test:cocos-session`
- `npm run test:cocos-ui-command-queue`

## 常见失败模式

- load 失败污染 session
- 表现层绕过 SaveStoragePort
- 读取拒绝被误当空槽、失败 snapshot 残留旧成功结果、队列被拒绝命令阻断
- 把内存委托前故障测试误解为真实存储原子写回滚保证

## 代码—地图同步

public-api 中 Save/Load 入口说明、runtime/cocos maps 与 `trace.save.storage-failure-recovery`。本轮只澄清并验证已有保证，不新增稳定错误码或底层存储事务。
