# SOURCE_DESIGN_PACK — v0.0.2.31

本代码包基于：`模拟游戏_正式开发总设定包_v1_5_2_2_practical_ready.zip`。

设计/规范来源仍是正式包 v1.5.2.2；修改规范包和日志包只用于工作流约束与人工复查，不是玩法规则权威，不并入代码包。

v0.0.2.31交付真实Cocos Web最小启动外层及准备工具，复用正式资源、公共bootstrap和既有组件端口。trace.cocos.web-bootstrap-probe连接自动准备/生命周期验证，真实Creator预览与构建独立验收；现有启动装配、绑定恢复、存储故障、项目地图与 GitHub 工作流继续有效。

code package version: `v0.0.2.31`

版本名称：Cocos Web Bootstrap Probe / Cocos网页端最小启动探针版。

本轮包含真实引擎外层及配套代码包内部检查体系治理，不改变正式包设定。旧game-core、cocos-app、cocos-creator-adapter仍不接真实 Cocos、不接 wx或fs；只有新增cocos-engine-probe外层可导入cc，并受单向公开runtime边界约束。不进入 Stage 1B，不改变 ActionPipeline，不改变 SaveFile，不改变正式 fixture，不新增玩法、微信存储、AOT或资源热更新。不把日志包或规划对话作为正式设计来源。
