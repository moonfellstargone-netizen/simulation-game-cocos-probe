# SOURCE_DESIGN_PACK — v0.0.2.38

本代码包基于：`模拟游戏_正式开发总设定包_v1_5_2_2_practical_ready.zip`。

设计/规范来源仍是正式包 v1.5.2.2；修改规范包和日志包只用于工作流约束与人工复查，不是玩法规则权威，不并入代码包。

v0.0.2.38修复共用IdService与GameRuntime的读档ID恢复，使存档中仍可见的对象和历史引用恢复确定性高水位，预览复用相同规则且不消耗正式序列。trace.runtime.id-recovery连接核心、预览与公开Session验收；保留既有加工校验、Web农事、库存整批转移和手动本地存档，不新增SaveFile字段或正式设定。项目地图与 GitHub 工作流继续有效。

code package version: `v0.0.2.38`

版本名称：Runtime ID Recovery & Preview Consistency / 持久对象ID恢复与预览一致性版。

本轮包含真实引擎外层及配套代码包内部检查体系治理，不改变正式包设定。旧game-core、cocos-app、cocos-creator-adapter仍不接真实 Cocos、不接 wx或fs；只有既有cocos-engine-probe外层可导入cc，并受单向公开runtime边界约束。不进入 Stage 1B，不改变 ActionPipeline，不改变 SaveFile，不改变正式 fixture，不新增玩法、微信存储、AOT或资源热更新。不把日志包或规划对话作为正式设计来源。
