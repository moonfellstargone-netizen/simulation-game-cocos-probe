# SOURCE_DESIGN_PACK — v0.0.2.44

本代码包基于：`模拟游戏_正式开发总设定包_v1_5_2_2_practical_ready.zip`。

设计/规范来源仍是正式包 v1.5.2.2；修改规范包和日志包只用于工作流约束与人工复查，不是玩法规则权威，不并入代码包。

项目地图与 GitHub 工作流继续规定分层读取、版本传播、测试和交付方法，不新增玩法规则。

v0.0.2.44复用正式Stage1A的submit_order、DemandProfile和既有状态/截止保护，最小公开需求说明、绝对截止和实际结算摘要，沿原菜单预览/确认提供第五网页。hard与weighted分别展示，基础奖励不当预计实得；实际奖励/声望由正式结果和公共快照取值。core、StateVM、Session/Queue、SaveFile及正式Schema/config/fixture/expected保持，不新定接单、聚合、部分交付、评分或数量规则。trace.cocos.web-orders-loop连接公开数据、outer、真实浏览器与Node契约。

code package version: `v0.0.2.44`

版本名称：Web Tavern Orders & Settlement Feedback / 网页酒馆订单与结算反馈版。

本轮包含真实引擎外层及配套代码包内部检查体系治理，不改变正式包设定。旧game-core、cocos-app、cocos-creator-adapter仍不接真实 Cocos、不接 wx或fs；只有既有cocos-engine-probe外层可导入cc，并受单向公开runtime边界约束。不进入 Stage 1B，不改变 ActionPipeline，不改变 SaveFile，不改变正式 fixture，不新增玩法、微信存储、AOT或资源热更新。不把日志包或规划对话作为正式设计来源。
