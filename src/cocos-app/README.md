# Cocos app — v0.0.2.22 / Affected Policy Hardening & Coverage Evidence

Cocos app 层说明：本目录只保存 Cocos 表现层适配代码。当前 v0.0.2.22 不提供真实 Cocos Component、Cocos Creator 场景、Prefab、节点资源绑定、微信小游戏构建或 wx storage 接入。

Cocos app 只能通过 Session/ViewModel/Port 访问 game-core，正式状态变化必须继续走 ActionPipeline。


边界口径：本轮不进入 Stage 1B，不接真实 Cocos，不接 wx，不接真实 wx storage。
