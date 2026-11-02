# Cocos app — v0.0.2.44 / Web Tavern Orders & Settlement Feedback

Cocos app层说明：本目录保存Session、ViewModel与Action适配代码。v0.0.2.44最小扩展SelectableVM.order_options的issuer、deadline_absolute_minute和signed minutes_until_deadline、正式需求与实际submitted refs/result_summary，全部嵌套副本独立；hard与weighted分开，缺配置为null且不可用，不复制匹配/评分算法。StateVM既有money/reputation继续供实际反馈，Session/Queue与core保持，不引入cc/wx/fs或UI直写状态。

日常代码权威见 GitHub 仓库；项目地图入口见 `docs/PROJECT_MAP.md` 与 `docs/GITHUB_WORKFLOW.md`；追踪矩阵见 `docs/TRACEABILITY_MATRIX.md`。

Cocos app 只能通过 Session/ViewModel/Port 访问 game-core，正式状态变化必须继续走 ActionPipeline。

边界口径：本轮不进入 Stage 1B，不接真实 Cocos，不接 wx，不接真实 wx storage。
