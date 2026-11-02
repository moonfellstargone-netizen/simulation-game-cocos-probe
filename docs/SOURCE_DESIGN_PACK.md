# SOURCE_DESIGN_PACK — v0.0.2.43

本代码包基于：`模拟游戏_正式开发总设定包_v1_5_2_2_practical_ready.zip`。

设计/规范来源仍是正式包 v1.5.2.2；修改规范包和日志包只用于工作流约束与人工复查，不是玩法规则权威，不并入代码包。

项目地图与 GitHub 工作流继续规定分层读取、版本传播、测试和交付方法，不新增玩法规则。

v0.0.2.43依据正式active_contract四.5的available/accepted合法提交，以及既有modules/04订单状态机的开放态过期→expired意图，对齐DemandResolver、GameRuntime与只读选项；保持既有now>deadline边界。提交拒绝不偷偷改为expired，submitted仅在同步事务内部，旧failed终态不迁移。高层active config、Schema与fixture/expected没有相反要求，正式包资源不修改；不新定聚合、切份、接单或评分奖励规则。trace.orders.legal-state-deadline连接分层验证；既有网页能力与独立真实Creator/浏览器回归保持。

code package version: `v0.0.2.43`

版本名称：Order State Alignment & Failure Protection / 订单合法状态与失败保护版。

本轮包含真实引擎外层及配套代码包内部检查体系治理，不改变正式包设定。旧game-core、cocos-app、cocos-creator-adapter仍不接真实 Cocos、不接 wx或fs；只有既有cocos-engine-probe外层可导入cc，并受单向公开runtime边界约束。不进入 Stage 1B，不改变 ActionPipeline，不改变 SaveFile，不改变正式 fixture，不新增玩法、微信存储、AOT或资源热更新。不把日志包或规划对话作为正式设计来源。
