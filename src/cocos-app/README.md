# Cocos app — v0.0.3.0 / WeChat Stage1A Pilot

Cocos app层说明：本目录保存Session、ViewModel与Action适配代码。v0.0.3.0触摸/小屏调整属于既有outer，本目录生产API和算法保持。既有订单需求/截止/实际结果只读投影、StateVM、Session、手动存读档和跨步骤恢复机制继续沿用，不引入cc/wx/fs或UI直写状态；真实输入与布局证据由outer和独立浏览器验证。

日常代码权威见 GitHub 仓库；项目地图入口见 `docs/PROJECT_MAP.md` 与 `docs/GITHUB_WORKFLOW.md`；追踪矩阵见 `docs/TRACEABILITY_MATRIX.md`。

Cocos app 只能通过 Session/ViewModel/Port 访问 game-core，正式状态变化必须继续走 ActionPipeline。

边界口径：本轮不进入 Stage 1B，不接真实 Cocos，不接 wx，不接真实 wx storage。
