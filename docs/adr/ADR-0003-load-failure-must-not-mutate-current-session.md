# ADR-0003：读档失败不得污染当前 session

## 状态

Accepted

## 背景

读档是高风险入口：坏存档、旧存档、schema 不兼容或 StorageAudit 失败都可能发生。如果 `load` 在校验完成前替换当前 session 状态，失败会破坏玩家当前进度。

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
