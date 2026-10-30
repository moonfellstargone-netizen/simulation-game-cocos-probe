# IMPLEMENTATION_SCOPE — v0.0.2.30

版本：v0.0.2.30 / Async Scene Binding Ordering & Recovery / 场景绑定异步顺序与失败恢复版。

## 本轮范围

本轮只做场景绑定异步顺序与失败恢复：在同一`CocosSceneBindingController`实例内，将快照读取、Queue命令、差异生成及异步端口应用作为一个有序操作。`applyInitialSnapshot`与组件的mount/refresh/execute/unmount共享该顺序，卸载成功后不受先前调用的迟到更新覆盖。

- 失败恢复：端口同步抛错或Promise拒绝仍使调用失败，内部排队恢复后继续处理后续调用。失败批次后的下一次绑定操作全量同步当前四区视图；仅重新渲染，不回滚已提交Action、不自动重发正式命令。
- 差异语义：`diff`仍描述Shell前后差异；恢复时`applied_updates`可以包含全量四区并使用`initial_render`原因。健康且无变化的快照仍不产生多余刷新。
- 确定性验收：现有scene/component应用测试使用`tests/support/controlledBindingPort.ts`的手动信号，覆盖并发、部分应用后拒绝、重同步和卸载交错，检查端口实际状态及正式动作只执行一次。
- 追踪与版本：`trace.cocos.binding-async-recovery`连接场景控制器、两个既有full/blocker任务及边界契约。两任务补齐tests覆盖和辅助files；`quality-affected-contracts`断言单文件实际选择，`traceability-contracts`断言执行闭合，不修改门禁算法。轻量traceability由`traceability-map.json`与`TRACEABILITY_MATRIX.md`对齐，版本元数据仍由`project-target.json`派生。

既有`test:stage1a-bootstrap` / registry `test.stage1a-bootstrap`继续执行独立资源装配集成验收，`trace.runtime.bootstrap-resources`保持有效。成功返回的Host已创建Session，不再由Probe.onLoad重复创建；明确接口见creator模块卡和Stage1ABootstrap边界契约。

既有`test:cocos-session`、`test:cocos-save-load`和`test:cocos-ui-command-queue`（registry为`test.cocos-session`、`test.cocos-save-load`、`test.cocos-command-queue`）继续执行存储故障回归，`trace.save.storage-failure-recovery`保持有效。`test.ci-workflow-contracts`与`trace.quality.pr-ci`继续保护PR到main时的Ubuntu完整检查及两份报告保留。云端通过情况以对应提交的Checks / Actions和报告为证。

## 明确不做

不进入 Stage 1B；不接真实 Cocos；不接 wx storage；不创建真实 Cocos Component/Scene/Prefab；不改变正式玩法；不新增 formal action；不改变 ActionPipeline；不改变 SaveFile；不改变正式 fixture；不做 flake/nightly 实装；不做完整 AST/symbol 自动索引；不重构 quality runner 或 q:affected 核心 fallback。不改game-core/cocos-app业务实现，不建立跨controller全局锁，不保证取消永不完成的端口Promise或撤回部分端口副作用；不建立资源缓存、热更新、通用依赖注入框架或真实存储适配；不修改byte_length含义，不承诺持久化原子回滚。不将Node验收写成真实Cocos运行证明。

## 门禁边界

q:affected 不替代 q:full，不替代 q:release。release gate 禁止 cache。planned / futureExtensions 不是当前实现。

## 正式包来源

本轮仍基于正式包 v1.5.2.2。v0.0.2.30交付场景绑定异步顺序与失败恢复，不改变正式包设定。

## module_contracts 保留

`docs/module_contracts/` 为遗留上下文治理契约，**不删除**。新版 module-card 导航在 `docs/module-cards/`。

## 架构检查继承

`architecture-boundary.rules.json`、`architecture-boundary-check.mjs`、authoritative 与 shadow findings 分层继续有效。不删除旧 validator 核心红线。
