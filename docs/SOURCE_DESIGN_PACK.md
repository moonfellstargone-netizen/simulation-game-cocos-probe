# SOURCE_DESIGN_PACK — v0.0.3.0

本代码包基于：`模拟游戏_正式开发总设定包_v1_5_2_2_practical_ready.zip`。

设计/规范来源仍是正式包 v1.5.2.2；修改规范包和日志包只用于工作流约束与人工复查，不是玩法规则权威，不并入代码包。

项目地图与 GitHub 工作流继续规定分层读取、版本传播、测试和交付方法，不新增玩法规则。

v0.0.3.0复用正式Stage1A全部九种Action和既有运行时；本轮仅M1候选，独立微信outer通过公共Host/Binding/Queue演示advance_time，并显示只读候选身份。临时内存只建新局，不提供微信存读档；M2—M4尚未实现或验收。trace.cocos.wechat-m1连接最小平台源与受控测试，旧Web及五点恢复/触摸追踪保持；core、Session/Queue、SaveFile、正式Schema/config/fixture/expected及业务规则不变，电脑工具结果不作为手机证据。

code package version: `v0.0.3.0`

版本名称：WeChat Stage1A Pilot / 微信真机Stage1A试水版。

本轮包含独立微信M1引擎外层及配套代码包内部检查体系治理，不改变正式包设定。旧game-core、cocos-app、cocos-creator-adapter仍不接真实 Cocos、不接 wx或fs；已登记Web与微信outer可导入cc，并受单向公开runtime边界约束。不进入 Stage 1B，不改变 ActionPipeline，不改变 SaveFile，不改变正式 fixture，不新增玩法、微信存储或资源热更新；仅允许正式Schema构建期预编译兼容，其他AOT不在当前范围。不把日志包或规划对话作为正式设计来源。
