# ADR-0002：ActionPipeline 是正式状态变化的唯一入口

## 状态

Accepted

## 背景

Stage 1A 已经形成 formal action、schema validation、StorageAudit、DomainEvent、ActionResult 的闭环。若 UI、dev runner 或测试为了方便直接改 SaveFile，会绕过交易、容量、预约、审计和事件记录。

## 决策

所有正式状态变化必须通过：

```text
ActionRequest
  -> ActionPipeline
  -> Domain Service
  -> StorageReconciler / StorageAudit
  -> DomainEvent / ActionResult
```

Cocos UI、菜单控制器、存档读档控制器、headless runtime 都不得直接修改 SaveFile。

## 后果

- 正式逻辑保持单一入口，测试和 UI 不会分裂出第二套业务规则。
- 失败回滚、StorageAudit、reservation guard 可以统一生效。
- UI 操作必须先构造 formal ActionRequest，不能为了交互速度绕过 pipeline。

## 禁止项

- UI 层直接修改 `inventory / orders / dish_lots / reservations / money`。
- 把 `system.*` fixture step 注册为 formal action。
- 用 `preview_only` 绕过正式 dispatch。
- 自行制造业务成功的 ActionResult。

## 验证

`tools/validate_code_architecture.py` 必须扫描 Cocos adapter、Creator adapter、ViewModel、menu/save 目录，阻止直接状态写入和 dev/testing API 泄漏。
