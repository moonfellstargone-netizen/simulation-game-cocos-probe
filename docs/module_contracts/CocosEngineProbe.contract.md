---
doc_type: module_contract
status: active
applies_to: cocos-web-probe
source_of_truth: false
---

# Module Contract：CocosEngineProbe

导航主入口为[引擎探针模块卡](../module-cards/cocos-engine-probe.md)。本契约描述外层行为和验收限制，不替代正式资源或源码。

## 来源与工程准备

apps/cocos-probe/仅保存最小工程源模板，tools/cocos-probe/prepare.mjs导出prepareCocosProbe({rootDir, outputDir})和readProbeResources(rootDir)。CLI --output要求仓库外绝对空目录，拒绝非空目录、仓库内/祖先位置和链接目标。

生成runtime与probe-resources.json包含唯一snapshot、完整58项声明Schema及project-target派生BuildId。缺失、损坏和引用无效必须失败；写工程前用真实bundle公共bootstrap做Node资源预检，不能称作引擎通过。probe-source-manifest.json保留sourceCommit/sourceDirty、Creator版本及输入/产物bytes/SHA-256；固定候选验收核对真实字节，不凭元数据字符串保证来源。

源模板settings/v2/packages/project.json必须保留script.loose=false，避免已证实的Creator3.8.8 loose转译改变Ajv super.names继承getter接收者。标准模式只保持JavaScript语义，不修改Schema/核心或迁移AOT。

## 桌面视口与输入

官方Web构建源模板保持cocosTemplate注入，约束页面容器在可见视口内并同步引擎所需像素尺寸和resize；修复源头，不能手改生成Web或SDK。原故障为小窗口canvas.focus触发页面滚动后mouseup偏离按钮，禁止屏蔽真实点击验收制造通过。

构建网页built-web覆盖1440×1200、1280×720、960×640、800×600/DPR1和960×640/DPR2仿真，同页960×640→1440×1200→800×600→960×640四次resize点击。编辑器预览editor-preview只覆盖1440×1200与960×640/DPR1，同页960×640→1440×1200→960×640三次resize点击。两个mode均要求完整canvas/Button可见、scroll稳定、会话身份不变，每次真实鼠标点击恰好一次Button事件及一次命令；既有advance_time增加60分钟，保存时间不变，读取恢复已保存时间，Label与公开ViewModel一致；窗口变化不重建Host或重复绑定事件，断言强度不变。官方Default设备模拟器固定960px内容在800窗口发生裁剪，该预览场景未支持，不将其诊断失败写成构建网页800失败。

DPR仿真不能推导手机、触摸、软键盘、安全区、微信或Windows系统缩放通过，未测平台不承诺。

## 运行与生命周期

真实cc组件只负责加载、节点与按钮，使用createStage1AHost和QinglanUiSceneProbeComponent公开命令。bootstrap返回已ready Host，不再调用旧Probe.onLoad创建同一会话。加载期间销毁不得发布迟到Host或更新失效Node。

Creator不await异步onDestroy，并可能清空Component字段；必须同步捕获asset/lifetime，observer独立保留lifetime，清理使用已持有引用。移除会覆盖真实槽的memoryRoundtrip诊断写入，保留缺资源失败、加载中销毁与正常退出释放回归。Node端口测试不等于真实浏览器持久化或微信存储。

## 真实构建与浏览器证据

cocos:build显式要求--creator、--project、--log-dir；实际Creator3.8.8返回成功码36且Web产物有效才成功。成功result记录Web逐文件bytes/SHA-256与目录摘要。构建前仍逐项严格核对prepare清单；Creator允许且仅允许迁移engine.json，记录creatorNormalizations前后SHA及完整preparedSurfaceAfter。其他源变化必须失败，verify逐项核对精确构建后映像，不能将该迁移扩大为来源放行。

cocos:verify:web的verifyWebProbe(options)要求--project、--browser、--report-dir、--build-record，均为显式绝对路径。复算已构建Web并与记录匹配，缺摘要/篡改/替换必须失败；记录来源提交、dirty、构建关联、实际浏览器和真实点击结果，报告不写入仓库。可选--preview-url限loopback HTTP，预览结果独立标记；构建摘要不证明livepreview页面字节。

不得用observer.advance代替鼠标点击，不捕获错误后仍报告passed；缺引擎、浏览器、来源或产物应明确失败，不静默skip。正常运行控制台和pageerror无错误；缺资源案例允许明确记录预期404，但不能混成正常运行错误。

## 自动门禁与边界

test.cocos-probe-preparation、test.cocos-engine-probe-lifecycle、test.cocos-web-verification-contracts登记full/blocker；最后一项仅验证工具HTTP/参数/来源/失败契约，Node契约不执行真实浏览器。根typecheck只检查src，Ubuntu q:full不安装Creator或启动真实浏览器。实际Creator SDK类型、构建、预览与Chrome矩阵独立验收，q:affected不替代q:full/q:release，release禁止缓存。

旧三层禁真实Cocos/wx/fs；仅新outer可导入cc，且单向消费派生公共runtime，不能依赖tools/tests或核心内部。保持ActionPipeline、SaveFile和正式schema/config/fixture；仅外层经已有Port接浏览器Storage，不新增玩法或Stage1B、wx、Nightly/CI平台或通用UI框架。

## 浏览器本地单槽与本次反馈

真实按钮AdvanceOneHour、SaveLocal、LoadLocal使用既有QinglanUiSceneProbeComponent路径。BrowserSaveStoragePort只在outer通过Storage.getItem/setItem透传原始字符串，固定web_probe与key qinglan.simulation-game.cocos-probe.save.web_probe，不随代码版本/BuildId变化，不访问其他来源或清除其他key。存储getter与读写只在用户操作时执行，constructor/bootstrap不探测或写入存储；拒绝沿既有failed结果显示，无内存fallback。

启动仍创建既有新局，不自动读写旧档。360→推进420→保存→推进480→刷新新局360→点击读取420；存读档不额外推进。刷新和新页面恢复须同origin/profile，原始字符串不被启动或诊断覆盖。空槽、坏JSON、结构/StorageAudit失败及getter/read/write拒绝保持当前状态，保留原档，健康操作可继续。Session候选校验后提交策略保持；本版不实现任意旧档迁移或未知版本必拒绝，不提供跨标签冲突系统。

ProbeInteraction是无cc的单操作协调器，loading/busy/closing/destroyed不受理；一次受理只调用一次组件命令，无自动重试。结果依据command_result.status/error_message，不聚合旧snapshot区域错误；operation.sequence记录受理次数，operation与displayedOperation可只读观察。预期failed显示正常失败反馈，意外reject仍传播到组件错误记录；销毁后的迟到完成不更新节点。

test.cocos-engine-probe-lifecycle实际执行cocos-engine-probe-lifecycle.test.ts、cocos-web-interaction.test.ts与cocos-browser-storage.test.ts；test.cocos-web-verification-contracts同时执行cocos-web-serve-contracts.test.mjs。args/files/covers与新增文件单独affected闭合，full/blocker不变。trace.cocos.browser-local-save追踪本地存档；既有trace.cocos.web-save-load-recovery继续闭合Queue、component、本次反馈及full/release。真实物理点击、刷新与同context新页面手动恢复及存储故障/坏档恢复分别验收，Node与observer程序调用均不能替代。

tools/cocos-probe/serve.mjs提供显式固定loopback端口的最小启动入口，先复核构建来源和逐文件字节，端口占用即失败而不换origin。自动verify的随机端口/新BrowserContext用于测试隔离，不等于日常固定存档地址；不同协议/host/port/profile不共享存储。故障注入不冒充真实权限或配额耗尽测试；用户清理浏览器数据可能清除存档，不接wx或文件系统存储。
