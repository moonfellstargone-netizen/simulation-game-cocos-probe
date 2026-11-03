# SOURCE_DESIGN_PACK — v0.0.2.45

本代码包基于：`模拟游戏_正式开发总设定包_v1_5_2_2_practical_ready.zip`。

设计/规范来源仍是正式包 v1.5.2.2；修改规范包和日志包只用于工作流约束与人工复查，不是玩法规则权威，不并入代码包。

项目地图与 GitHub 工作流继续规定分层读取、版本传播、测试和交付方法，不新增玩法规则。

v0.0.2.45复用正式Stage1A全部九种Action和既有手动单槽存读档、候选校验后替换及ID高水位恢复机制。五点由自然玩家操作建立，经过新Host/刷新/同context新页手动读取后继续，不用私写状态代替网页路径。trace.cocos.cross-step-recovery连接公共bootstrap与工具契约、独立Creator/SDK和built/editor恢复验收；生产代码、SaveFile、正式Schema/config/fixture/expected及业务规则保持。

code package version: `v0.0.2.45`

版本名称：Cross-step Save/Load Recovery / 跨步骤存读档恢复版。

本轮包含真实引擎外层及配套代码包内部检查体系治理，不改变正式包设定。旧game-core、cocos-app、cocos-creator-adapter仍不接真实 Cocos、不接 wx或fs；只有既有cocos-engine-probe外层可导入cc，并受单向公开runtime边界约束。不进入 Stage 1B，不改变 ActionPipeline，不改变 SaveFile，不改变正式 fixture，不新增玩法、微信存储、AOT或资源热更新。不把日志包或规划对话作为正式设计来源。
