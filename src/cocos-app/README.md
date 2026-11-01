# Cocos app — v0.0.2.39 / Split Quantity Invariants & Failure Safety

Cocos app层说明：本目录保存Session、ViewModel与Action适配代码。当前v0.0.2.39的split_lot数量/占用修复位于game-core InventorySystem，现有Session预览/正式入口复用相同业务校验；本层执行源码与Session契约保持。既有Web、ID恢复、加工和存储故障继续回归；不提供微信小游戏构建或wx storage。

日常代码权威见 GitHub 仓库；项目地图入口见 `docs/PROJECT_MAP.md` 与 `docs/GITHUB_WORKFLOW.md`；追踪矩阵见 `docs/TRACEABILITY_MATRIX.md`。

Cocos app 只能通过 Session/ViewModel/Port 访问 game-core，正式状态变化必须继续走 ActionPipeline。

边界口径：本轮不进入 Stage 1B，不接真实 Cocos，不接 wx，不接真实 wx storage。
