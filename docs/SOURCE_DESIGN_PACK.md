# SOURCE_DESIGN_PACK — v0.0.2.29

本代码包基于：`模拟游戏_正式开发总设定包_v1_5_2_2_practical_ready.zip`。

设计/规范来源仍是正式包 v1.5.2.2；修改规范包和日志包只用于工作流约束与人工复查，不是玩法规则权威，不并入代码包。

v0.0.2.29交付运行启动装配与资源契约：外部提供正式快照、Schema集合、存储端口和明确启动参数，经公共入口建立可验证宿主，资源缺失、无效或引用不可解析时明确失败。`trace.runtime.bootstrap-resources`连接运行入口和独立集成验收；现有存储故障回归、项目地图与 GitHub 工作流继续有效。

code package version: `v0.0.2.29`

版本名称：Runtime Bootstrap & Resource Contracts / 运行启动装配与资源契约版。

本轮包含生产运行装配、资源就绪契约及配套的代码包内部检查体系治理，不改变正式包设定。不改变ActionPipeline、SaveFile或正式fixture，不进入 Stage 1B，不接真实 Cocos、不接 wx，不新增玩法、资源缓存、热更新或持久化原子回滚保证。不把日志包或规划对话作为正式设计来源。
