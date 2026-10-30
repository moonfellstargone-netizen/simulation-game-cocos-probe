# IMPLEMENTATION_SCOPE — v0.0.2.31

版本：v0.0.2.31 / Cocos Web Bootstrap Probe / Cocos网页端最小启动探针版。

## 本轮范围

本轮唯一目标是在固定Creator3.8.8的真实Web预览与构建中，从仓库唯一正式资源经公共bootstrap建立会话，真实节点显示时间、按钮提交已有advance_time并正确卸载。资源加载失败与加载中销毁必须明确处理，不能发布迟到Host或更新失效节点。

仓库内apps/cocos-probe保存最小工程源模板及外层桥接；tools/cocos-probe/prepare.mjs从现有src/design_snapshot派生浏览器runtime与全部58个声明Schema，在仓库外生成可打开工作副本。probe-source-manifest.json记录sourceCommit、sourceDirty、输入/产物摘要及project-target派生BuildId，副本不成为第二套代码或配置权威。

Node中的准备契约和外层生命周期测试登记为full/blocker，由trace.cocos.web-bootstrap-probe追踪；它们验证实际派生产物、资源完整性、异常路径和确定性生命周期，不冒充引擎运行证据。根typecheck仍仅覆盖src。真实Creator预览与Web构建另行执行，缺引擎时明确失败或未执行，不能静默skip或使用假cc类型声称通过。既有`test:cocos-session` / registry `test.cocos-session`、`test:stage1a-bootstrap`及绑定/存储回归继续执行。traceability仍由traceability-map.json与TRACEABILITY_MATRIX对齐，版本由project-target.json派生。

## 明确不做

旧game-core、cocos-app、cocos-creator-adapter仍不接真实 Cocos、不接 wx或fs；只有新增cocos-engine-probe外层可导入cc，并受单向公开runtime边界约束。不进入 Stage 1B，不改变 ActionPipeline，不改变 SaveFile，不改变正式 fixture，不新增玩法、微信存储、AOT或资源热更新。不改quality runner、q:affected算法或gate策略，不做Windows CI、Nightly、跨controller全局锁或持久化原子回滚。

## 门禁边界

q:affected 不替代 q:full，不替代 q:release。release gate 禁止 cache。planned / futureExtensions 不是当前实现。

## 正式包来源

本轮仍基于正式包 v1.5.2.2。v0.0.2.31交付Cocos网页端最小启动探针，不改变正式包设定。

## module_contracts 保留

`docs/module_contracts/` 为遗留上下文治理契约，**不删除**。新版 module-card 导航在 `docs/module-cards/`。

## 架构检查继承

`architecture-boundary.rules.json`、`architecture-boundary-check.mjs`、authoritative 与 shadow findings 分层继续有效。不删除旧 validator 核心红线。
