# IMPLEMENTATION_SCOPE — v0.0.2.28

版本：v0.0.2.28 / Save Storage Failure Contracts / 存储端口故障契约与恢复验证版。

## 本轮范围

本轮只做现有 `SaveStoragePort` 的故障契约与恢复验证。通过测试专用端口包装既有内存存储，控制读写 Promise 的即时拒绝、延迟拒绝和后续恢复；不模拟微信 SDK，不引入真实存储适配。

- Session：区分读取拒绝与空槽；失败时保留公开视图和经健康存储路径取得的完整序列化状态；验证后续正常读写可恢复。
- save/load UI：呈现现有错误边界的结果，失败时清除旧成功摘要，保留当前 session，并验证健康重试。
- UI 命令队列：受控等待期间后续命令不超车，拒绝后返回失败 snapshot，后续命令继续按顺序执行。
- 契约、ADR-0003、模块卡、地图与 `trace.save.storage-failure-recovery` 同步描述已有保证；轻量 traceability 通过 `traceability-map.json` 与 `TRACEABILITY_MATRIX.md` 对齐；版本元数据仍由 `project-target.json` 派生。

新增用例由既有 `test.cocos-session`、`test.cocos-save-load` 和 `test.cocos-command-queue` 完整门禁任务执行。`test.ci-workflow-contracts` 与 `trace.quality.pr-ci` 继续有效；PR 到 main 的 Ubuntu `q:full` 与两份报告保留入口保持。云端通过情况以对应提交的 Checks / Actions 和报告为证。

命令入口为`test:cocos-session`、`test:cocos-save-load`和`test:cocos-ui-command-queue`。受控辅助登记到三个消费者的files和covers字段，辅助文件单独变化时也应执行相关故障回归。

## 明确不做

不进入 Stage 1B；不接真实 Cocos；不接 wx storage；不创建真实 Cocos Component/Scene/Prefab；不改变正式玩法；不新增 formal action；不改变 ActionPipeline；不改变 SaveFile；不改变正式 fixture；不做 flake/nightly 实装；不做完整 AST/symbol 自动索引；不重构 quality runner 或 q:affected 核心 fallback。不新增稳定错误码，不修改 byte_length 含义，不承诺底层写失败后的持久化原子回滚。默认不改业务运行代码；若故障用例揭示缺陷，须先重新界定最小修复范围。

## 门禁边界

q:affected 不替代 q:full，不替代 q:release。release gate 禁止 cache。planned / futureExtensions 不是当前实现。

## 正式包来源

本轮仍基于正式包 v1.5.2.2。v0.0.2.28 是存储端口故障契约与恢复验证，不改变正式包设定。

## module_contracts 保留

`docs/module_contracts/` 为遗留上下文治理契约，**不删除**。新版 module-card 导航在 `docs/module-cards/`。

## 架构检查继承

`architecture-boundary.rules.json`、`architecture-boundary-check.mjs`、authoritative 与 shadow findings 分层继续有效。不删除旧 validator 核心红线。
