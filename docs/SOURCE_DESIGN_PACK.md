# SOURCE_DESIGN_PACK — v0.0.2.46

本代码包基于：`模拟游戏_正式开发总设定包_v1_5_2_2_practical_ready.zip`。

设计/规范来源仍是正式包 v1.5.2.2；修改规范包和日志包只用于工作流约束与人工复查，不是玩法规则权威，不并入代码包。

项目地图与 GitHub 工作流继续规定分层读取、版本传播、测试和交付方法，不新增玩法规则。

v0.0.2.46复用正式Stage1A全部九种Action、原有手动单槽及ID恢复机制，只在outer调整约定逻辑视口下布局/滚动/输入与只读诊断。trace.cocos.touch-small-screen连接纯布局行为与浏览器触摸断言，旧五点恢复等追踪保持；core、Session/Queue、SaveFile、正式Schema/config/fixture/expected及业务规则不变，电脑触摸和缩高模拟不作为微信或手机键盘、安全区证据。

code package version: `v0.0.2.46`

版本名称：Touch Interaction & Small-screen Readiness / 触摸交互与小屏操作收口版。

本轮包含真实引擎外层及配套代码包内部检查体系治理，不改变正式包设定。旧game-core、cocos-app、cocos-creator-adapter仍不接真实 Cocos、不接 wx或fs；只有既有cocos-engine-probe外层可导入cc，并受单向公开runtime边界约束。不进入 Stage 1B，不改变 ActionPipeline，不改变 SaveFile，不改变正式 fixture，不新增玩法、微信存储、AOT或资源热更新。不把日志包或规划对话作为正式设计来源。
