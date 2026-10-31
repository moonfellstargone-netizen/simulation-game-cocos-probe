# IMPLEMENTATION_SCOPE — v0.0.2.33

版本：v0.0.2.33 / Cocos Web Save/Load Interaction & Recovery / Cocos网页临时存读档交互与恢复版。

## 本轮范围

本轮唯一目标是让用户通过真实按钮完成固定单槽的临时保存、推进、读取恢复，并在失败后继续操作时得到准确的本次结果。AdvanceOneHour推进60分钟，SaveTemporary与LoadTemporary使用本页内存槽web_probe；保存和读取不额外推进，刷新页面清空。先修复旧Queue把其他操作区历史错误误判为本次失败的问题，再通过既有组件命令接入三按钮；不手改仓库外生成页面。

工具只读取仓库唯一src/design_snapshot派生的工作副本。prepare继续导出snapshot及全部58项Schema并记录Git来源/输入产物摘要；build记录实际Web产物清单摘要，verify核对构建关联和产物字节后才启动浏览器，拒绝替换或篡改的Web目录。工程、依赖、报告、缓存和构建仍位于仓库外，不形成第二源码权威。

保留准备/生命周期full/blocker回归，沿用test:cocos-web-verification-contracts / registry test.cocos-web-verification-contracts验证浏览器工具的参数、来源、HTTP服务和断言失败保护；Node契约不执行真实浏览器。独立cocos:verify:web运行固定Creator构建产物的真实Chrome鼠标点击，记录Button事件、时间变化、Label同步与清理证据；根typecheck只覆盖src，不能代替实际Creator类型、构建或浏览器验收。

构建网页built-web验收1440×1200、1280×720、960×640、800×600/DPR1，另960×640/DPR2仿真，并在同页按960×640→1440×1200→800×600→960×640执行四次resize点击。编辑器预览editor-preview独立验收1440×1200与960×640/DPR1，同页按960×640→1440×1200→960×640执行三次resize点击。所有约定案例均保持完整canvas/Button可见、scroll稳定、会话身份不变、Button事件恰好一次、推进命令时间+60和Label同步；存读档命令按临时槽预期检查时间；不降低断言强度。官方Default设备模拟器在800窗口裁剪固定960px内容，该预览场景未承诺支持，不能据其失败推定构建网页800失败。DPR仿真不等于手机、触摸、微信或Windows系统缩放验证。

本轮保留test:cocos-session / registry test.cocos-session、bootstrap、绑定恢复、存储故障和PR CI回归。traceability仍由traceability-map.json与TRACEABILITY_MATRIX对齐；trace.cocos.web-save-load-recovery追踪本版，既有trace.cocos.web-viewport-input及trace.cocos.web-bootstrap-probe继续有效。版本和BuildId由project-target.json派生。

## 明确不做

不进入 Stage 1B，不改变 ActionPipeline，不改变 SaveFile，不改变正式 fixture，不新增玩法、真实存储、wx、AOT或通用UI框架。旧game-core、cocos-app、cocos-creator-adapter仍不接真实 Cocos、不接 wx或fs；只有既有cocos-engine-probe外层使用cc。

不改quality runner、q:affected算法或gate策略，不扩展Windows CI、Nightly或远程引擎平台，不将依赖审计提示自动升级为audit fix授权。

## 门禁边界

q:affected仅开发反馈，不替代 q:full，不替代 q:release。release gate禁止cache。缺引擎或浏览器时真实验收应明确失败或未执行，不得静默skip。planned / futureExtensions不是当前实现。

## 正式包来源

本轮仍基于正式包v1.5.2.2，只推进代码包临时存读档交互及表现层命令结果归属，不改变正式包设定。

## module_contracts保留

docs/module_contracts/为遗留上下文治理契约，保留不删除；新版module-card导航在docs/module-cards/。

## 架构检查继承

architecture-boundary.rules.json、architecture-boundary-check.mjs继续区分authoritative blocker与shadow findings，既有shadow_aligned观察口径和权威级别保持。不删除旧 validator 核心红线，ActionPipeline、SaveFile和game-core隔离等高风险红线仍由legacy validator守护；根因修复不得修改SDK或屏蔽真实按钮验收。
