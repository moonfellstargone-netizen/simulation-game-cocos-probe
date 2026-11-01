# Cocos app — v0.0.2.38 / Runtime ID Recovery & Preview Consistency

Cocos app层说明：本目录保存Session、ViewModel与Action适配代码。当前v0.0.2.38的ID恢复修复位于game-core的IdService与GameRuntime，覆盖本层Session读档和克隆状态的新runtime预览；本层执行源码、Session契约及数量/容量规则保持。trace.runtime.id-recovery连接公开加载与预览回归；既有加工、农事、库存和存储故障继续验收。creator-adapter复用本层公开Session，本层不反向依赖creator-adapter，不提供真实Cocos Component、Creator场景、Prefab、节点资源绑定、微信小游戏构建或wx storage接入。

日常代码权威见 GitHub 仓库；项目地图入口见 `docs/PROJECT_MAP.md` 与 `docs/GITHUB_WORKFLOW.md`；追踪矩阵见 `docs/TRACEABILITY_MATRIX.md`。

Cocos app 只能通过 Session/ViewModel/Port 访问 game-core，正式状态变化必须继续走 ActionPipeline。

边界口径：本轮不进入 Stage 1B，不接真实 Cocos，不接 wx，不接真实 wx storage。
