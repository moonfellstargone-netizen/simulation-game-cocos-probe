# Cocos app — v0.0.2.41 / Web Processing Start & Collection

Cocos app层说明：本目录保存Session、ViewModel与Action适配代码。当前v0.0.2.41最小扩展CocosSelectableViewModel的processing_method_options与processing_task_options，只读提供配置要求、可选批次、兼容设施和现有任务状态；正式加工沿既有菜单与ActionPipeline，Session协议保持；不引入cc/wx/fs或UI直写状态。

日常代码权威见 GitHub 仓库；项目地图入口见 `docs/PROJECT_MAP.md` 与 `docs/GITHUB_WORKFLOW.md`；追踪矩阵见 `docs/TRACEABILITY_MATRIX.md`。

Cocos app 只能通过 Session/ViewModel/Port 访问 game-core，正式状态变化必须继续走 ActionPipeline。

边界口径：本轮不进入 Stage 1B，不接真实 Cocos，不接 wx，不接真实 wx storage。
