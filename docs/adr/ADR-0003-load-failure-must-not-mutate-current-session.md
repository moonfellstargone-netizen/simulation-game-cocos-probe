# ADR-0003：读档失败不得污染当前 session

## 状态

Accepted

## 背景

读档是高风险入口：读取 Promise 拒绝、坏存档、旧存档、schema 不兼容或 StorageAudit 失败都可能发生。如果 `load` 在校验完成前替换当前 session 状态，失败会破坏玩家当前进度。

## 决策

`CocosAppRuntimeSession.load` 必须采用候选状态策略：

```text
read raw save
  -> deserialize candidate
  -> assertSaveFile(candidate)
  -> StorageAudit(candidate)
  -> replace current session only after all checks pass
```

任何失败都必须保留旧 session 状态，并通过错误展示边界返回可呈现错误。

读取拒绝发生于候选反序列化之前；空槽 `null` 走现有槽位不存在错误，不等同于存储读取拒绝。保存路径仅在写入 Promise 成功后返回成功摘要；写入拒绝也不由调用方改变当前游戏状态。

这些要求澄清现有 Session / Port 行为，不新增平台错误码或真实存储持久化保证。故障测试在内存端口委托之前拒绝，不证明底层存储在部分写入后能够原子回滚。UI Queue 负责串行执行与失败后继续，不是存储事务系统。

## 后果

- UI 可以安全显示 load 失败，不会把当前 session 变成半损坏状态。
- 后续接真实微信 storage 时，也必须保持同一策略。
- load 成功后才允许刷新 ViewModel / selectable ViewModel。

## 禁止项

- 在 schema validation 前替换当前 SaveFile。
- 在 StorageAudit 前替换当前 SaveFile。
- load 失败后清空 session。
- save/load UI controller 直接读写 SaveFile。

## 验证

`tests/cocos-save-load-ui-binding.test.ts` 必须覆盖坏存档失败后 session 仍保持原状态。模块契约卡必须保留该要求。

存储故障覆盖通过既有三个层级完成：

- `tests/cocos-runtime-session.test.ts`：即时读写拒绝、空槽区别、状态保留与正常重试。
- `tests/cocos-save-load-ui-binding.test.ts`：错误展示、清除旧成功结果、状态保留与恢复。
- `tests/cocos-ui-command-queue.test.ts`：受控延迟读写拒绝、后续命令不超车、失败 snapshot 与健康命令继续执行。

状态保护同时比较公开视图与健康保存路径取得的完整序列化内容；`tests/support/controlledSaveStoragePort.ts` 只控制故障时序，不成为玩法或平台契约权威。追踪入口：`trace.save.storage-failure-recovery`。
