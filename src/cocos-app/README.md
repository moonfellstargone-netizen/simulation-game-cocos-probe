# Cocos app — v0.0.2.35 / Web Farming Loop & Action Feedback

Cocos app层说明：本目录保存Session、ViewModel与Action适配代码。当前v0.0.2.35在真实Web外层消费本层既有农事选择与Action结果，连接播种、时间推进、收获和读档后的选择重建，本层业务实现保持；creator-adapter仍复用本层公开Session能力，本层不反向依赖creator-adapter。既有启动装配与存储故障回归保持，不提供真实Cocos Component、Creator场景、Prefab、节点资源绑定、微信小游戏构建或wx storage接入。

日常代码权威见 GitHub 仓库；项目地图入口见 `docs/PROJECT_MAP.md` 与 `docs/GITHUB_WORKFLOW.md`；追踪矩阵见 `docs/TRACEABILITY_MATRIX.md`。

Cocos app 只能通过 Session/ViewModel/Port 访问 game-core，正式状态变化必须继续走 ActionPipeline。

边界口径：本轮不进入 Stage 1B，不接真实 Cocos，不接 wx，不接真实 wx storage。
