# Cocos app — v0.0.2.45 / Cross-step Save/Load Recovery

Cocos app层说明：本目录保存Session、ViewModel与Action适配代码。v0.0.2.45沿既有公共Host/bootstrap验证五个独立保存点在新会话手动读取后的实际续玩、失败保护及ID恢复，不改变本目录生产API或算法。既有订单需求/截止/实际结果只读投影和全部嵌套副本、StateVM与Session机制保持，不引入cc/wx/fs或UI直写状态。

日常代码权威见 GitHub 仓库；项目地图入口见 `docs/PROJECT_MAP.md` 与 `docs/GITHUB_WORKFLOW.md`；追踪矩阵见 `docs/TRACEABILITY_MATRIX.md`。

Cocos app 只能通过 Session/ViewModel/Port 访问 game-core，正式状态变化必须继续走 ActionPipeline。

边界口径：本轮不进入 Stage 1B，不接真实 Cocos，不接 wx，不接真实 wx storage。
