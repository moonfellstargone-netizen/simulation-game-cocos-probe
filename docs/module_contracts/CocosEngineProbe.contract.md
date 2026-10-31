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

ProbeInteraction是无cc的单操作协调器，loading/busy/closing/destroyed不受理；一次受理只调用一次组件命令，无自动重试。存读档依据command_result.status/error_message及本次对应结果，menu_confirm另核对本次preview/ActionResult，不聚合旧snapshot区域错误；operation.sequence记录受理次数，operation与displayedOperation可只读观察。预期failed显示正常失败反馈，意外reject仍传播到组件错误记录；销毁后的迟到完成不更新节点。

test.cocos-engine-probe-lifecycle实际执行cocos-engine-probe-lifecycle.test.ts、cocos-web-interaction.test.ts、cocos-browser-storage.test.ts与cocos-web-farming.test.ts；test.cocos-web-verification-contracts同时执行cocos-web-serve-contracts.test.mjs。args/files/covers与新增文件单独affected闭合，full/blocker不变。trace.cocos.browser-local-save追踪本地存档；既有trace.cocos.web-save-load-recovery继续闭合Queue、component、本次反馈及full/release。真实物理点击、刷新与同context新页面手动恢复及存储故障/坏档恢复分别验收，Node与observer程序调用均不能替代。

tools/cocos-probe/serve.mjs提供显式固定loopback端口的最小启动入口，先复核构建来源和逐文件字节，端口占用即失败而不换origin。自动verify的随机端口/新BrowserContext用于测试隔离，不等于日常固定存档地址；不同协议/host/port/profile不共享存储。故障注入不冒充真实权限或配额耗尽测试；用户清理浏览器数据可能清除存档，不接wx或文件系统存储。

## 网页农事选择与结果契约

ProbeFarming只管理公开选项副本、选择和带单位的播种数量；plantCommand/harvestCommand使用当前公开ID构造既有menu_confirm。初始挂载、动作完成和成功load后重新核对选项，失效选择清除；不直接修改存档，不按名称或ID后缀确定业务身份。

本次menu_confirm必须有匹配动作的preview，且实际ActionResult完整并成功才能显示成功；preview拒绝、Action失败、结果缺失或preview动作不匹配均不得误报。ActionResult没有action_type字段，不能虚构该观察契约。Queue.completed语义保持处理完成，不扩大公共命令协议。读取仅消费本次save_load结果，历史preview/ActionResult即使保留，也不能当成本次读档成功或继续使用旧选择。

真实Button执行播种、推进一小时/一天和收获，数量消耗、占用、可收获项和实际产量以公开结果为准。正常时间推进不硬编码成熟时点；公开收获列表只包含可收获项，不据此展示全部作物进度。局部选择/数量调整不发送命令、不改变世界状态。

trace.cocos.web-farming-loop连接新辅助、Node行为和真实verify。农事完整物理点击在960×640 built-web/editor-preview各执行，覆盖超量业务拒绝、播种保存、正常成熟、读档选择重建、收获数量/地块释放与再次种植。原三按钮矩阵、刷新/同context新页面、存储受控失败/坏档、来源与销毁回归仍需独立验证；不以Node或observer调用替代物理点击。

## 网页库存与整批储存转移

ProbeInventory.ts只复制公开MaterialLot选项和储存目标，管理当前批次/目标选择，不拥有可变运行态。逐批浏览当前公开材料的名称、current_form、数量/单位与storage_ref，展示目标支持形态和容量/占用。名称只用于展示，身份和单位取公开选项；不展示DishLot通用库存、完整新鲜度或保鲜倒计时。

MenuActionBinding.ts是本版唯一src执行文件例外，只补正式store_item的选择类型与草稿适配：从当前公开材料/储存目标解析有效ID，以MaterialLot object_ref及目标StorageRef调用既有storeItem。preview、正式Action、存储审计与回滚沿既有路径，其他src/**/*.ts业务逻辑、Session和Queue不改；不绕过组件菜单，不直接写SaveFile。

移动对象为整批，不加入拆分数量。容量单位为slot_weight；目标enabled只说明目标自身可用，不保证放得下所选批次，outer不以克数估算容量或复制footprint算法。形态不支持、容量不足和失效选择由既有绑定/preview/Action给出拒绝，失败保留状态，健康操作可继续。同容器移动在核心仍合法，界面只避免无意义重复提交，不新增核心拒绝规则。

挂载、动作及成功读档后重新消费公开列表，更新位置和容量，清除失效选择。界面切换/浏览仅改变本地视图，不发正式命令；转移按本次preview/ActionResult反馈，不把completed或旧菜单成功当本次业务结果。保留busy、销毁后迟到保护、农事闭环和手动存读档。

tests/cocos-web-inventory.test.ts加入既有test:cocos-engine-probe-lifecycle实际args，tests/cocos-minimal-menu-binding.test.ts验证唯一适配；helper、.meta和测试的files/covers及单文件affected闭合。trace.cocos.web-inventory-storage连接Node行为与独立真实点击。新增库存完整闭环至少在960×640 built-web/editor-preview分别验收；因布局受影响的既有农事、三按钮矩阵/resize、存储失败和来源/销毁回归继续验证，不把Node或observer调用冒充真实输入。
