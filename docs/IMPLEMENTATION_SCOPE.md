# IMPLEMENTATION_SCOPE — v0.0.2.35

版本：v0.0.2.35 / Web Farming Loop & Action Feedback / 网页种植收获与操作反馈版。

## 本轮范围

本轮唯一目标是在真实Web中通过既有公开接口完成Stage1A“选择地块、种子和数量→播种→明确时间推进→收获”，准确反馈本次业务结果，并在手动读档后重建有效选择。outer只消费公开菜单快照和ActionResult，不直接修改SaveFile；plant_crop、advance_time、harvest_crop仍经既有预览与正式Action入口。保留推进一小时，可按一天推进正常世界时间，不硬编码成熟时点或改变生长规则。

工具只读取仓库唯一src/design_snapshot派生的工作副本。prepare继续导出snapshot及全部58项Schema并记录Git来源/输入产物摘要；build记录实际Web产物清单摘要，verify核对构建关联和产物字节后才启动浏览器，拒绝替换或篡改的Web目录。工程、依赖、报告、缓存和构建仍位于仓库外，不形成第二源码权威。

保留准备/生命周期full/blocker回归，沿用test:cocos-web-verification-contracts / registry test.cocos-web-verification-contracts验证浏览器工具的参数、来源、HTTP服务和断言失败保护；Node契约不执行真实浏览器。独立cocos:verify:web运行固定Creator构建产物的真实Chrome鼠标点击，记录Button事件、时间变化、Label同步与清理证据；根typecheck只覆盖src，不能代替实际Creator类型、构建或浏览器验收。

构建网页built-web验收1440×1200、1280×720、960×640、800×600/DPR1，另960×640/DPR2仿真，并在同页按960×640→1440×1200→800×600→960×640执行四次resize点击。编辑器预览editor-preview独立验收1440×1200与960×640/DPR1，同页按960×640→1440×1200→960×640执行三次resize点击。所有约定案例均保持完整canvas/Button可见、scroll稳定、会话身份不变、Button事件恰好一次、推进命令时间+60和Label同步；存读档命令按本地单槽预期检查时间；不降低断言强度。官方Default设备模拟器在800窗口裁剪固定960px内容，该预览场景未承诺支持，不能据其失败推定构建网页800失败。DPR仿真不等于手机、触摸、微信或Windows系统缩放验证。

本轮保留test:cocos-session / registry test.cocos-session、bootstrap、绑定恢复、存储故障和PR CI回归。traceability仍由traceability-map.json与TRACEABILITY_MATRIX对齐；trace.cocos.browser-local-save追踪本版，既有trace.cocos.web-save-load-recovery、trace.cocos.web-viewport-input及trace.cocos.web-bootstrap-probe继续有效。版本和BuildId由project-target.json派生。

## 明确不做

不进入 Stage 1B，不改变 ActionPipeline，不改变 SaveFile，不改变正式 fixture，不新增玩法、wx、AOT或通用UI框架；不做自动续存档、多槽、云同步、导入导出、跨标签冲突治理或正式版本迁移。旧game-core、cocos-app、cocos-creator-adapter仍不接真实 Cocos、不接 wx或fs；只有既有cocos-engine-probe外层使用cc。

不改quality runner、q:affected算法或gate策略，不扩展Windows CI、Nightly或远程引擎平台，不将依赖审计提示自动升级为audit fix授权。

## 门禁边界

q:affected仅开发反馈，不替代 q:full，不替代 q:release。release gate禁止cache。缺引擎或浏览器时真实验收应明确失败或未执行，不得静默skip。planned / futureExtensions不是当前实现。

## 正式包来源

本轮仍基于正式包v1.5.2.2，只连接已有Stage1A农事能力的真实Web操作、结果反馈与读档后的选择重建，不改变正式包设定。

## module_contracts保留

docs/module_contracts/为遗留上下文治理契约，保留不删除；新版module-card导航在docs/module-cards/。

## 架构检查继承

architecture-boundary.rules.json、architecture-boundary-check.mjs继续区分authoritative blocker与shadow findings，既有shadow_aligned观察口径和权威级别保持。不删除旧 validator 核心红线，ActionPipeline、SaveFile和game-core隔离等高风险红线仍由legacy validator守护；根因修复不得修改SDK或屏蔽真实按钮验收。

## 浏览器存储范围

BrowserSaveStoragePort只在apps/cocos-probe外层实现原始字符串read/write，惰性取得Storage，固定单槽web_probe及稳定项目key。不在旧三层引入浏览器API，不解析或改写SaveFile，不在初始化时访问存储。空槽、getter/读写拒绝、坏JSON、结构或StorageAudit失败沿既有失败路径，保留当前状态；不自动重试或回退内存。

tests/cocos-browser-storage.test.ts由既有test.cocos-engine-probe-lifecycle实际执行；tests/cocos-web-serve-contracts.test.mjs由既有test.cocos-web-verification-contracts执行，二者保持full/blocker、files/covers及单文件affected闭合。tools/cocos-probe/serve.mjs复用既有来源和HTTP保护，在显式固定端口提供本地构建；端口冲突必须失败，不自动更换origin。真实验收明确同origin/profile，验证刷新及同context新页面手动恢复且旧序列化字符串未被启动/诊断改写。支持矩阵、来源保护、404与销毁释放边界保持。

## 农事界面与公开消费范围

允许修改既有outer、纯选择辅助ProbeFarming.ts及相关测试、prepare窄声明和真实浏览器验证；默认不改src/**/*.ts执行逻辑、Session/Queue契约或核心数据。当前公开接口已提供所需选择与结果，不新设业务API。

地块/种子/作物身份只取公开选项ID，数量及单位来自公开批次。只显示占用、当前可收获列表与材料实际数量，不由空收获列表推断没有生长作物。保留推进一小时并提供推进一天；成熟由既有运行结果决定，不使用测试时量当作成熟规则。

本次menu_confirm须同时核对本次preview、ActionResult和动作类型，不将command_result.completed解释为业务成功。读档反馈只消费本次save_load，重建公开选项并清除失效选择；不从保留的历史菜单结果制造成功提示。资源不足/无效选择不得误报成功、写状态或自动重试。

tests/cocos-web-farming.test.ts与既有生命周期、交互、浏览器存储测试在同一full/blocker任务实际运行。真实960×640农事闭环核对数量消耗、占用、公开成熟、读档恢复、实际产量和再次种植，保留原存储、视口和销毁验收。未新增浇水、加工/烹饪/订单界面、完整生长条/倒计时、动画工程或通用菜单框架。
