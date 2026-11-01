# SOURCE_DESIGN_PACK — v0.0.2.41

本代码包基于：`模拟游戏_正式开发总设定包_v1_5_2_2_practical_ready.zip`。

设计/规范来源仍是正式包 v1.5.2.2；修改规范包和日志包只用于工作流约束与人工复查，不是玩法规则权威，不并入代码包。

项目地图与 GitHub 工作流继续规定分层读取、版本传播、测试和交付方法，不新增玩法规则。

v0.0.2.41通过app最小只读方法/任务投影和outer加工页，消费既有start_processing/collect_processing_result及menu_preview/confirm；trace.cocos.web-processing-loop连接公开数据、行为与独立真实输入验证。必需输入、数量、时间推进、设施与领取规则沿正式配置和既有核心，不修改正式包或新增重复输入语义。

code package version: `v0.0.2.41`

版本名称：Web Processing Start & Collection / 网页加工开工与领取版。

本轮包含真实引擎外层及配套代码包内部检查体系治理，不改变正式包设定。旧game-core、cocos-app、cocos-creator-adapter仍不接真实 Cocos、不接 wx或fs；只有既有cocos-engine-probe外层可导入cc，并受单向公开runtime边界约束。不进入 Stage 1B，不改变 ActionPipeline，不改变 SaveFile，不改变正式 fixture，不新增玩法、微信存储、AOT或资源热更新。不把日志包或规划对话作为正式设计来源。
