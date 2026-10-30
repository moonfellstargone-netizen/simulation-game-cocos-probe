# Module Contract：SaveStoragePort

## 模块路径

`src/game-core/save/SaveStoragePort.ts`

## 职责

- 定义平台无关存储端口。
- 提供 `InMemorySaveStoragePort` 用于测试和边界探针。
- 隔离后续真实微信 storage、文件系统或其他平台存储。

## 允许依赖

- TypeScript 标准能力。
- 内存 Map / object 等平台无关结构。

## 禁止依赖

- `wx`。
- `cc`。
- `fs / node:fs`。
- 任何具体平台 SDK。

## 不变量

- 端口只负责读写原始字符串或约定数据，不解释玩法成功。
- 真实平台适配必须通过新 adapter 接入，不得污染 game-core。

## 读写失败与恢复边界

- `read(slotId)` 返回 `Promise<string | null>`；`null` 表示没有该槽位，Promise 拒绝表示读取未成功，两者不能混为同一结果。
- `write(slotId, serializedSave)` 返回 `Promise<void>`；Session 仅在写入 Promise 成功后返回保存摘要，拒绝不能被展示成保存成功。
- 即时拒绝和等待后拒绝均经现有 Session / UI / Queue 边界处理。读档候选只有校验通过才可替换当前 session；存储拒绝本身不得污染当前游戏状态。
- 错误交给既有错误展示器；普通错误没有可提取的 `ERR_` 标记时，展示 code 可为 `null`，不在此新增平台错误码。
- 故障恢复后允许后续健康读写；端口不负责重试调度或 UI 命令排序。
- 测试辅助 `ControlledSaveStoragePort` 在委托既有内存存储前注入故障，只验证调用方保护与恢复，不承诺真实存储写入的持久化原子性或失败回滚。可选 `delete` 行为不属于本轮故障覆盖。

关联决策见 [ADR-0003](../adr/ADR-0003-load-failure-must-not-mutate-current-session.md)；active 追踪为 `trace.save.storage-failure-recovery`。

## 关联测试

```text
tests/cocos-runtime-session.test.ts
tests/cocos-save-load-ui-binding.test.ts
tests/cocos-ui-command-queue.test.ts
tests/support/controlledSaveStoragePort.ts
```
