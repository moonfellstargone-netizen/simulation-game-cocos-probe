# Cocos app — v0.0.2.36 / Web Inventory & Storage Transfer

Cocos app层说明：本目录保存Session、ViewModel与Action适配代码。当前v0.0.2.36在真实Web外层消费本层既有材料批次、储存目标及正式storeItem草稿，creator仅补菜单选择适配；本层业务实现、Session与数量/容量规则保持，既有农事和读档恢复继续回归；creator-adapter仍复用本层公开Session能力，本层不反向依赖creator-adapter。既有启动装配与存储故障回归保持，不提供真实Cocos Component、Creator场景、Prefab、节点资源绑定、微信小游戏构建或wx storage接入。

日常代码权威见 GitHub 仓库；项目地图入口见 `docs/PROJECT_MAP.md` 与 `docs/GITHUB_WORKFLOW.md`；追踪矩阵见 `docs/TRACEABILITY_MATRIX.md`。

Cocos app 只能通过 Session/ViewModel/Port 访问 game-core，正式状态变化必须继续走 ActionPipeline。

边界口径：本轮不进入 Stage 1B，不接真实 Cocos，不接 wx，不接真实 wx storage。
