# Cocos app — v0.0.2.43 / Order State Alignment & Failure Protection

Cocos app层说明：本目录保存Session、ViewModel与Action适配代码。当前v0.0.2.43仅对齐CocosSelectableViewModel订单选项的合法状态与时限：available/accepted且未超过deadline可用，submitted、终态与过期开放单不可用；enabled只代表可尝试提交，不保证需求匹配成功。正式提交经既有ActionPipeline，Session/Queue协议和公开shape保持，既有加工/烹饪只读投影保留；不引入cc/wx/fs或UI直写状态。

日常代码权威见 GitHub 仓库；项目地图入口见 `docs/PROJECT_MAP.md` 与 `docs/GITHUB_WORKFLOW.md`；追踪矩阵见 `docs/TRACEABILITY_MATRIX.md`。

Cocos app 只能通过 Session/ViewModel/Port 访问 game-core，正式状态变化必须继续走 ActionPipeline。

边界口径：本轮不进入 Stage 1B，不接真实 Cocos，不接 wx，不接真实 wx storage。
