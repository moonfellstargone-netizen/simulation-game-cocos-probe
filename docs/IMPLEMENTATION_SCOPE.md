# IMPLEMENTATION_SCOPE — v0.0.2.29

版本：v0.0.2.29 / Runtime Bootstrap & Resource Contracts / 运行启动装配与资源契约版。

## 本轮范围

本轮只做运行启动装配与资源契约：从外部提供的正式运行快照、Schema集合、`SaveStoragePort`和明确启动参数，经公共入口建立可验证的Stage1A宿主。入口所在外层可以依赖配置、既有校验器和SessionHost，禁止让game-core或cocos-app反向依赖宿主层。

- 资源输入：使用已解析数据；只约束必要结构、存在性与装配关系，不读取文件系统，不另建正式配置、Schema或来源真实性权威。
- 就绪检查：复用既有Schema编译与契约校验能力，确认必要操作契约及引用可用，不通过校验假数据并忽略失败模拟就绪。
- 失败保护：资源缺失、无效或引用损坏时，不交付可操作的半初始化宿主，不进行存储读写或正式Action副作用。
- 集成验收：测试层可读取正式样本，但必须通过公共装配入口构造运行对象，不导入runtimeHarness；覆盖正常启动、失败输入、已有正式动作、存读档与生命周期。
- 追踪与版本：`trace.runtime.bootstrap-resources`连接源码、模块卡和完整门禁任务；轻量traceability通过`traceability-map.json`与`TRACEABILITY_MATRIX.md`对齐，版本元数据仍由`project-target.json`派生。

新增`test:stage1a-bootstrap` / registry `test.stage1a-bootstrap`执行独立资源装配集成验收。成功返回的Host已创建Session，不再由Probe.onLoad重复创建；明确接口见creator模块卡和Stage1ABootstrap边界契约。

既有`test:cocos-session`、`test:cocos-save-load`和`test:cocos-ui-command-queue`（registry为`test.cocos-session`、`test.cocos-save-load`、`test.cocos-command-queue`）继续执行存储故障回归，`trace.save.storage-failure-recovery`保持有效。`test.ci-workflow-contracts`与`trace.quality.pr-ci`继续保护PR到main时的Ubuntu完整检查及两份报告保留。云端通过情况以对应提交的Checks / Actions和报告为证。

## 明确不做

不进入 Stage 1B；不接真实 Cocos；不接 wx storage；不创建真实 Cocos Component/Scene/Prefab；不改变正式玩法；不新增 formal action；不改变 ActionPipeline；不改变 SaveFile；不改变正式 fixture；不做 flake/nightly 实装；不做完整 AST/symbol 自动索引；不重构 quality runner 或 q:affected 核心 fallback。不建立资源缓存、热更新、通用依赖注入框架或真实存储适配；不修改byte_length含义，不承诺持久化原子回滚。允许本轮必要的外层装配与最小校验就绪API，不将Node验收写成真实Cocos运行证明。

## 门禁边界

q:affected 不替代 q:full，不替代 q:release。release gate 禁止 cache。planned / futureExtensions 不是当前实现。

## 正式包来源

本轮仍基于正式包 v1.5.2.2。v0.0.2.29交付运行启动装配与资源契约，不改变正式包设定。

## module_contracts 保留

`docs/module_contracts/` 为遗留上下文治理契约，**不删除**。新版 module-card 导航在 `docs/module-cards/`。

## 架构检查继承

`architecture-boundary.rules.json`、`architecture-boundary-check.mjs`、authoritative 与 shadow findings 分层继续有效。不删除旧 validator 核心红线。
