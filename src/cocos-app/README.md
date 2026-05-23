# Cocos app — v0.0.2.25 / Project Map Auto Index & Traceability Lite

Cocos app 层说明：本目录只保存 Cocos 表现层适配代码。当前 v0.0.2.25 为项目地图轻量可追踪矩阵版，不提供真实 Cocos Component、Cocos Creator 场景、Prefab、节点资源绑定、微信小游戏构建或 wx storage 接入。

日常代码权威见 GitHub 仓库；项目地图入口见 `docs/PROJECT_MAP.md` 与 `docs/GITHUB_WORKFLOW.md`；追踪矩阵见 `docs/TRACEABILITY_MATRIX.md`。

Cocos app 只能通过 Session/ViewModel/Port 访问 game-core，正式状态变化必须继续走 ActionPipeline。

边界口径：本轮不进入 Stage 1B，不接真实 Cocos，不接 wx，不接真实 wx storage。
