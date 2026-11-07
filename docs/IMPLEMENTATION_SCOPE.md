# IMPLEMENTATION_SCOPE — v0.0.3.0

版本：v0.0.3.0 / WeChat Stage1A Pilot / 微信真机Stage1A试水版。

## 本轮范围

本轮唯一目标是v0.0.3.0的M3微信加工包：在M2及M3种植、库存与拆分候选基础上，接入加工方法、材料、设施、任务、开工与领取，并保留时间推进、手动存读档和前后台保护。加工预览可选，直接确认使用独立正式校验；候选依赖PR25、PR26、PR27和PR28的既有变更，正式动作仍经公共Host/Binding/Queue与ActionPipeline。真实Creator、官方微信工具和手机结果分别验收，不由Node契约推断；本包不代表M3完整经营或M4手机验收完成。

独立apps/cocos-wechat-probe模块只消费派生公共runtime与正式资源，可使用cc，禁止直接wx/fs、业务内部、工具和测试依赖；旧三层不得反向依赖它。微信outer通过Creator平台存储外层提供手动单槽存读档及备份恢复，不增加自动保存或离线补时。不进入 Stage 1B，不改变 ActionPipeline，不改变 SaveFile，不改变正式 fixture；planned Stage1B wx-storage-port不转active。

prepare固定web/wechat内部profile，共享tools/cocos-probe/lib/prepareProject.mjs，保留旧Web prepareCocosProbe/readProbeResources签名、默认格式、角色与CLI。两条链均继承绝对空目录/路径隔离/symlink、正式58Schema、实际源与依赖摘要、公共bootstrap preflight、来源重读和排他写入。微信candidate_id由唯一生产者在冻结outputs前生成，来自当前生成资源assets/resources/candidate-identity.json；不取自SaveFile。每个新构建要求新候选和新空目录，已有构建或失败不静默复用身份；相同version/commit的候选仍可区分。最终产物摘要只在包外保存，明确目录树/ZIP/二维码范围，不嵌回自身；本轮不上传或发码。

test:cocos-wechat-preparation / test.cocos-wechat-preparation实际执行tests/cocos-wechat-preparation.test.mjs；test:cocos-wechat-runtime / test.cocos-wechat-runtime实际执行tests/cocos-wechat-runtime.test.ts，均为full/blocker。trace.cocos.wechat-m1连接新outer、共享生产者、微信构建、候选身份、架构负例和质量登记。Node只能证明受控准备/行为契约；真实Creator3.8.8/SDK、官方微信工具场景/输入/日志/重载、受影响Web回归和最终提交CI各自验收。旧全部追踪、权威架构禁令和Web功能/来源检查保留，不以修改阈值、预期、CI或affected算法通过门禁。

### 既有Web交互范围（保留）

既有Web支持现有Stage1A五页在约定横屏逻辑视口下的电脑触摸与小屏操作准备：built-web覆盖800×360、844×390、960×432，另以844×250→390模拟可视区缩高恢复；compact以实际CSS frame布局，正文至少14CSSpx、按钮和EditBox命中高至少44CSSpx。仅在outer使用纯ProbeLayout、原生ScrollView/Mask、resize与视觉视口同步，选择/数量输入/确认/结果及手动存读档可达，按下或滑动取消不误提交、有效tap只发一次请求，切页重置滚动且resize保留会话和按钮身份。保留原桌面鼠标、全部五页经营、五点手动恢复及失败/销毁保护；core、Session/Queue、SaveFile、正式资源、数量/重复材料/时间/奖励规则与依赖保持。不新增通用UI框架、多点手势、横竖双套设计、自动存档、迁移、多槽、Stage1B或微信；电脑模拟不代表vivo X200s安全区、真实软键盘或微信触摸通过。

工具只读取仓库唯一src/design_snapshot派生的工作副本。prepare继续导出snapshot及全部58项Schema并记录Git来源/输入产物摘要；build记录实际Web产物清单摘要，verify核对构建关联和产物字节后才启动浏览器，拒绝替换或篡改的Web目录。工程、依赖、报告、缓存和构建仍位于仓库外，不形成第二源码权威。

保留准备/生命周期full/blocker回归，沿用test:cocos-web-verification-contracts / registry test.cocos-web-verification-contracts验证浏览器工具的参数、来源、HTTP服务和断言失败保护；Node契约不执行真实浏览器。独立cocos:verify:web运行固定Creator构建产物的真实Chrome鼠标点击，记录Button事件、时间变化、Label同步与清理证据；根typecheck只覆盖src，不能代替实际Creator类型、构建或浏览器验收。

构建网页built-web验收1440×1200、1280×720、960×640、800×600/DPR1，另960×640/DPR2仿真，并在同页按960×640→1440×1200→800×600→960×640执行四次resize点击。编辑器预览editor-preview独立验收1440×1200与960×640/DPR1，同页按960×640→1440×1200→960×640执行三次resize点击。所有约定案例均保持完整canvas/Button可见、scroll稳定、会话身份不变、Button事件恰好一次、推进命令时间+60和Label同步；存读档命令按本地单槽预期检查时间；不降低断言强度。官方Default设备模拟器在800窗口裁剪固定960px内容，该预览场景未承诺支持，不能据其失败推定构建网页800失败。DPR仿真不等于手机、触摸、微信或Windows系统缩放验证。

本轮保留test:cocos-session / registry test.cocos-session、bootstrap、绑定恢复、存储故障和PR CI回归。trace.cocos.touch-small-screen追踪约定横屏触摸/小屏操作；旧29条追踪包括trace.cocos.cross-step-recovery、全部五页经营与手动存读档/视口/销毁保持。新布局行为进入既有prepare/lifecycle真实args/files/covers，工具负例沿既有web-verification任务；不能以文档登记、Node或旧提交结果代替本轮真实Creator和浏览器验收。

## 明确不做

不进入 Stage 1B，不改变 ActionPipeline，不改变 SaveFile，不改变正式 fixture，不新增玩法、wx或通用UI框架；仅允许下述正式Schema构建期预编译兼容，其他AOT不在当前范围；不做自动续存档、多槽、云同步、导入导出、跨标签冲突治理或正式版本迁移。旧game-core、cocos-app、cocos-creator-adapter仍不接真实 Cocos、不接 wx或fs；现Web与独立微信两个outer使用cc，旧三层边界保持；微信M1不接wx/fs。

不改quality runner、q:affected算法或gate策略，不扩展Windows CI、Nightly或远程引擎平台，不将依赖审计提示自动升级为audit fix授权。

## 门禁边界

q:affected仅开发反馈，不替代 q:full，不替代 q:release。release gate禁止cache。缺引擎或浏览器时真实验收应明确失败或未执行，不得静默skip。planned / futureExtensions不是当前实现。

## 正式包来源

本轮仍基于正式包v1.5.2.2；沿用既有加工必需输入、count整数、active lot正数/finite和按定义重建占用，不修改正式包、Schema/config/fixture/expected、产出/容量定义或重复输入规则。

## module_contracts保留

docs/module_contracts/为遗留上下文治理契约，保留不删除；新版module-card导航在docs/module-cards/。

## 架构检查继承

architecture-boundary.rules.json、architecture-boundary-check.mjs继续区分authoritative blocker与shadow findings，既有shadow_aligned观察口径和权威级别保持。不删除旧 validator 核心红线，ActionPipeline、SaveFile和game-core隔离等高风险红线仍由legacy validator守护；根因修复不得修改SDK或屏蔽真实按钮验收。

## 浏览器存储范围

BrowserSaveStoragePort只在apps/cocos-probe外层实现原始字符串read/write，惰性取得Storage，固定单槽web_probe及稳定项目key。不在旧三层引入浏览器API，不解析或改写SaveFile，不在初始化时访问存储。空槽、getter/读写拒绝、坏JSON、结构或StorageAudit失败沿既有失败路径，保留当前状态；不自动重试或回退内存。

tests/cocos-browser-storage.test.ts由既有test.cocos-engine-probe-lifecycle实际执行；tests/cocos-web-serve-contracts.test.mjs由既有test.cocos-web-verification-contracts执行，二者保持full/blocker、files/covers及单文件affected闭合。tools/cocos-probe/serve.mjs复用既有来源和HTTP保护，在显式固定端口提供本地构建；端口冲突必须失败，不自动更换origin。真实验收明确同origin/profile，验证刷新及同context新页面手动恢复且旧序列化字符串未被启动/诊断改写。支持矩阵、来源保护、404与销毁释放边界保持。

## 农事界面与公开消费范围

既有农事outer、纯选择辅助ProbeFarming.ts和库存辅助ProbeInventory.ts及其回归保持；既有核心split_lot数量/占用及配置依赖保持，既有app最小只读投影和outer提供网页烹饪选料及真实菜品反馈，不增加燃料机制、完整进度条或新正式业务API，Session/Queue契约不变。

地块/种子/作物身份只取公开选项ID，数量及单位来自公开批次。只显示占用、当前可收获列表与材料实际数量，不由空收获列表推断没有生长作物。保留推进一小时并提供推进一天；成熟由既有运行结果决定，不使用测试时量当作成熟规则。

本次menu_confirm须同时核对本次preview、ActionResult和动作类型，不将command_result.completed解释为业务成功。读档反馈只消费本次save_load，重建公开选项并清除失效选择；不从保留的历史菜单结果制造成功提示。资源不足/无效选择不得误报成功、写状态或自动重试。

tests/cocos-web-farming.test.ts与既有生命周期、交互、浏览器存储测试在同一full/blocker任务实际运行。真实960×640农事闭环核对数量消耗、占用、公开成熟、读档恢复、实际产量和再次种植，保留原存储、视口和销毁验收。农事范围未新增浇水、完整生长条/倒计时、动画工程或通用菜单框架；加工与烹饪页独立追踪，订单界面未扩展。

## 网页库存与整批储存转移

ProbeInventory.ts只复制公开MaterialLot选项和储存目标，管理当前批次/目标选择，不拥有可变运行态。逐批浏览当前公开材料的名称、current_form、数量/单位与storage_ref，展示目标支持形态和容量/占用。名称只用于展示，身份和单位取公开选项；不展示DishLot通用库存、完整新鲜度或保鲜倒计时。

既有MenuActionBinding.ts将当前公开MaterialLot与储存目标解析为正式store_item草稿；预览、正式Action、存储审计与回滚沿既有路径。该适配作为已有能力保留，既有实现保留拆分数量与占用校验及配置依赖传播，不改变Session/Queue、ActionPipeline协议或SaveFile，不绕过组件菜单或直接写状态。

整批转移仍不携带数量；拆分是同页独立操作。容量单位为slot_weight；目标enabled只说明目标自身可用，不保证放得下所选批次，outer不以克数估算容量或复制footprint算法。形态不支持、容量不足和失效选择由既有绑定/preview/Action给出拒绝，失败保留状态，健康操作可继续。同容器移动在核心仍合法，界面只避免无意义重复提交，不新增核心拒绝规则。

挂载、动作及成功读档后重新消费公开列表，更新位置和容量，清除失效选择。界面切换/浏览仅改变本地视图，不发正式命令；转移按本次preview/ActionResult反馈，不把completed或旧菜单成功当本次业务结果。保留busy、销毁后迟到保护、农事闭环和手动存读档。

tests/cocos-web-inventory.test.ts加入既有test:cocos-engine-probe-lifecycle实际args，tests/cocos-minimal-menu-binding.test.ts验证唯一适配；helper、.meta和测试的files/covers及单文件affected闭合。trace.cocos.web-inventory-storage连接Node行为与独立真实点击。新增库存完整闭环至少在960×640 built-web/editor-preview分别验收；因布局受影响的既有农事、三按钮矩阵/resize、存储失败和来源/销毁回归继续验证，不把Node或observer调用冒充真实输入。

## 加工必需输入校验与失败保护

按当前加工方法配置校验全部必需输入，缺料在任何消耗、任务创建和任务ID分配前拒绝。公开preview与直接正式dispatch共享验证；preview不得改变完整游戏状态、事件、库存/储存缓存或正式对象ID。正式失败保留既有失败反馈，不要求ActionRequestBuilder请求序号回滚。

契约、预览和公开Host/Component回归分别核对缺白菜、缺盐、盐不足/阈值边界，以及合法不同数量的消耗、任务、推进和领取。失败后健康请求与存读档恢复继续；不通过私有SaveFile写入构造假通过，不新增重复同lot或多primary拒绝/聚合规则。trace.processing.required-inputs连接ProcessingSystem.ts、ProcessingConfigResolver.ts及现有test.stage1a-contract、test.action-preview、test.cocos-session和test.cocos-menu。

实际触及测试逐一登记args/files/covers并验证单文件affected真正执行自身任务；q:affected仍只用于反馈，版本完成和候选出包按q:full及无缓存q:release。核心进入Web bundle，真实Creator SDK/构建及既有built-web/editor-preview回归需独立执行。核心校验沿用既有实现；网页加工与真实输入由trace.cocos.web-processing-loop独立验收，不从核心Node通过推定。

## 网页批次拆分与操作反馈

ProbeInventory只复制公开材料选项并管理数量原文、不可编辑的来源单位和本次预览。完整解析数量，不使用parseFloat吞尾、静默取整或默认全部；count整数、g/ml小数、超量及容量沿既有正式预览校验。来源变化清空数量，改量/切页/其他命令/读档使旧预览失效；仍合法的普通拒绝输入保留供修改。

ProbeLifetime窄消费既有menu_preview/split_lot；ProbeInteraction显式区分preview、confirm和save/load，preview只认本次last_preview_result，不要求ActionResult；confirm仍经既有controller重预览，成功须本次双结果。新批次ID从本次created_objects关联刷新后的公开材料，数量/位置由公开结果取得，不从输入伪造。状态应用异常不自动重发Action；busy/销毁保护保持。

CocosWebProbe接真实cc.EditBox、单位/选择摘要、预览与确认Button；observer只读观察，不提供设置数量或派发业务捷径。既有拆分规则、Session/Queue、SaveFile、正式schema/config/fixture/expected、依赖版本与门禁算法保持。既有拆分不提供全量快捷按钮；既有加工页见trace.cocos.web-processing-loop，既有烹饪页见trace.cocos.web-cooking-loop，不扩Stage1B或wx。

tests/cocos-web-split.test.ts进入现有test.cocos-engine-probe-lifecycle的实际args/files/covers，test.cocos-web-verification-contracts校验拆分观察断言负例。trace.cocos.web-inventory-split连接这些行为及独立Creator SDK/构建、built-web和editor-preview各960×640真实点击与键盘输入；旧矩阵/resize/农事/转移/存读档/故障及销毁回归保留。桌面输入不代表触摸或微信通过，版本完成仍按q:full及无缓存q:release和精确候选CI。

## 网页加工公开数据与outer边界

CocosSelectableViewModel既有processing_method_options与processing_task_options。方法逐配置要求提供requirement_index本地槽、constraints、min_quantity、候选lot_ids及compatible_facility_ids；缺料仍可查看。任务保留现有status、起止分钟、设施和明确为预计的expected_output，旧collectable_task_options仍仅ready且对象shape保持。数组、Quantity和facility_ref复制，不向outer暴露可变SaveFile。

ProbeProcessing仅管理本地选择、完整正数输入、本次预览和实际结果；不复制材料匹配、最低量或容量算法。请求仍用正式input_lots，不附加UI角色，不新增重复同lot/多primary语义。process_duration_minutes用于说明正式等待时间，time_cost_minutes不由UI补扣；完整进度条、补盐/补救、刀具选择或新设施规则不在本版。Node覆盖未就绪/重复领取正式拒绝，真实UI只要求对应禁用0事件。

## 网页烹饪选料与真实DishLot

ProbeCooking.ts/.meta只复制公开配方、MaterialLot、储存目标和现有实际DishLot选项，管理逐角色选择、数量/时长原文及本次preview/Action反馈。CocosSelectableViewModel按现有CookingSystem合并structure与recipe的角色约束，补齐形态/单位匹配、操作硬边界与偏好说明、工具设施配置说明和实际燃料当前量/成本；不修改核心或正式参数。可选油/姜不升级成必需，工具设施无新增选择或消耗行为。

操作分钟不是time_cost_minutes；不把测试high/8当默认，不补扣世界时间/体力。目标enabled不保证本次菜品放得下，outer不复制占用算法。缺必需角色可能由MenuActionBinding直接产生command failed，须清旧成功；preview只认本次结果，confirm仍重预览，成功以本次created_objects和刷新后的真实DishLot核对份数/位置。读档后列表恢复与本次产物反馈分清，失效选择/旧预览清除。

tests/cocos-web-cooking.test.ts进入既有生命周期full/blocker实际args/files/covers，readiness核只读来源和隔离，工具契约核烹饪观察负例；trace.cocos.web-cooking-loop连接。合法烹饪、缺角色/单位、储存回滚、预览无副作用、失败后恢复与新Host手动读档分层验收。标准新局腊肉先于15份燃料耗尽，燃料不足仅用受控合法Node状态验证，不把它写成网页玩家路径。真实Creator/SDK、built/editor各960×640真实输入另验，旧全部回归保留；不新增配方/补给/通用DishLot搬运、订单页或微信。

## 订单状态、截止与保护范围

available与accepted在当前分钟不超过deadline时可按现有需求规则提交。DemandResolver先验证状态和时限，再做既有菜品匹配；通过后仅在同步事务内部进入submitted，既有消费、储存审计、金钱/声望结算后completed。重复提交与submitted/completed/failed/expired/cancelled均拒绝，失败不得消耗菜品、增加奖励或改订单/事件；旧failed不迁移或重开。

GameRuntime既有advance_time截止settlement将available/accepted在now>deadline时转为expired，恰到截止仍保持开放。直接提交过期开放单复用ERR_ORDER_NOT_AVAILABLE，可带:deadline诊断，但保持提交前完整状态，不在拒绝路径偷偷结算。CocosSelectableViewModel只读order_options按同一合法状态和时限给enabled/reason，既有字段语义保持，新增展示字段见网页订单投影；enabled不是需求匹配保证。

trace.orders.legal-state-deadline连接DemandResolver、GameRuntime与CocosSelectableViewModel，以及test.stage1a-contract、test.action-preview、test.cocos-session和test.cocos-ui-readiness的现有full/blocker。核心、预览、Session受控合法加载与只读选项按层验收D-1/D/D+1、终态拒绝、需求失败完整保护、合法恢复、成功事件/奖励恰一次和新会话防重交。accepted及过期开放单可用合法受控存档验证；订单领域受控Node用例不冒充网页或真机实测；玩家页面另由trace.cocos.web-orders-loop及真实浏览器验证。不新增接单、刷新、聚合/部分交付、评分奖励或数量/时间/重复输入规则。

## 网页订单公开数据与outer边界

SelectableVM.order_options复制issuer_id、deadline_absolute_minute、signed minutes_until_deadline、正式需求的hard/weighted/defects/threshold、submitted refs和实际result_summary。订单名来自正式Profile文本，缺配置为null并不可用，嵌套数据全部独立副本。enabled只表示状态/时限及配置允许尝试，不保证所选菜品匹配；正/零截止余量和负余量来自当前绝对时间，不从day Label反算。StateVM及核心摘要保持。

ProbeOrders.ts/.meta只消费公共数据，管理第五页的显式单订单/单菜品本地选择和本次反馈，不改正式submitted_object_refs数组规则。终态可浏览、无菜品显示真实空态；浏览/选择0命令。preview只认本次校验，不伪造预计奖励；base_reward明确只是配置参考。确认沿既有menu→DraftBuilder→ActionPipeline，并以本次合法preview/ActionResult、实际Order.result_summary、所选菜品真实移除及公共金钱/声望变化关联成功，其他菜品保持。

确认前捕获order/dish与经济基线，避免成功patch先移除选择后误拒本次回执；错误或陈旧结果在ProbeInteraction发布completed前拒绝，应用失败不重发Action。改选择、切页、其他命令和load清旧预览/本次成功，历史结算另行展示；普通拒绝保留合法选择供修正，失效对象清除，不自动换菜品。busy/销毁迟到及本地单槽手动存读档保持。

tests/cocos-web-orders.test.ts实际进入既有lifecycle的args/files/covers，helper/.meta及测试同时登记prepare/lifecycle；readiness、menu与web-verification继续full/blocker。trace.cocos.web-orders-loop连接这些测试与源/地图，全部旧追踪保持。真实Creator/SDK和built/editor各960×640订单链、实际图检另行验收，保留原视口/resize、农事、库存拆分、加工、烹饪、存读档/故障与销毁。网页禁用重交只记0事件，正式状态/安全/低分拒绝由合法受控Node另验，不冒称微信或手机通过。

版本与BuildId继续由`tools/quality/rules/project-target.json`派生；traceability由`tools/quality/rules/traceability-map.json`与`docs/TRACEABILITY_MATRIX.md`对齐。既有`trace.cocos.web-bootstrap-probe`和`trace.cocos.web-viewport-input`保留真实引擎启动、视口与输入的独立验证职责，不因本版恢复链新增而省略。

## 五点恢复与继承回归

trace.cocos.cross-step-recovery连接tests/stage1a-bootstrap.test.ts与既有web-verification任务；五点各由自然玩家操作建立，刷新及同context新页手动读取原点后继续，不覆盖原保存点再假称同档恢复。坏JSON/Schema/Audit、存储拒绝、busy/销毁迟到与健康链隔离。完整状态、领域事件、持久对象/历史引用及后续新ID均须关联；既有五页、视口/resize及全部旧回归保持，Node与CI不替代真实Creator/SDK和built/editor。

## 触摸与小屏验收范围

trace.cocos.touch-small-screen仅覆盖本页任务锁中的电脑横屏逻辑视口与模拟缩高恢复，正文至少14CSSpx、按钮/EditBox命中高至少44CSSpx。滑动取消、切页重置、数量输入和tap单次派发需可信原生输入及本次operation/公开世界相互核对。旧鼠标和五点恢复链保留；不从hasTouch、DPR或resize推定手机键盘、安全区及微信通过。

## 微信正式Schema预编译边界

正式Schema构建期预编译最初用于微信M1的动态编译兼容：微信prepare使用当前锁定Ajv standalone，沿既有strict=false、allErrors=true、allowUnionTypes=true校验选项编译全部58项正式Schema，并生成安全ESM导出及明确ID映射。不改正式Schema或业务校验语义，不新增依赖，不猴补Function/eval或使用恒true替代校验器；其他AOT仍不在当前范围。

M2包体修复仅对微信预编译增加loopRequired=1、保留inlineRefs默认值，并固定debug=false及精简微信engine模板；原M1历史与Node/Web默认路径保持。包大小和设备运行以实际构建及验证结果为准。

RuntimeSchemaValidator支持显式PrecompiledSchemaValidatorSet：format为runtime-precompiled-schemas/v1，schemaSources在源侧按完整资源路径保留JSON.stringify(schema)原JSON绑定，validators按正式$id记录ValidateFunction。运行期将源JSON解析后与实际Schema作完整JSON语义规范化比较，仅允许Creator的对象键重排；字段集合、数组次序和全部嵌套值必须一致，不忽略未知字段、数组或数值变化，坏JSON和非JSON内容拒绝。原始Schema、预编译生成物和工具/产物的字节SHA来源仍严格，不因运行期对象键规范化而放宽。Stage1ABootstrapResources的可选precompiledValidators字段透明转交该集合。显式提供集合时不创建Ajv、不回退动态编译；完整路径/ID/内容不匹配、重复或无$id、无效/异步函数及非布尔结果均拒绝。未提供时Node/Web维持原Ajv路径。核心仍不接cc/wx/fs、工具或资源读取。

微信compileWechatSchemas位于tools/cocos-wechat-probe/lib/precompiledSchemas.mjs，在唯一prepare生产链冻结outputs前生成wechat-precompiled-validators.mjs、wechat-schema-precompile.json及wechat-runtime-entry.mjs。前两者记录安全schema_NNN导出/ID映射、完整Schema内容、编译器版本与选项、实际CommonJS编译器依赖闭包及生成摘要；Node编译器依赖通过Ajv入口的require.cache闭包记录，不能冒称由esbuild运行bundle的metafile捕获。facade显式注入precompiledValidators后再打包到assets/generated/probe-runtime.js，Cocos不直接导入额外standalone文件。核心的绑定检查不以自声明元数据证明函数可信；真实Ajv生成代码及工具/源/依赖字节由prepare和构建来源记录约束。

tests/runtime-precompiled-schema.test.ts进入现有test:stage1a-bootstrap / registry test.stage1a-bootstrap实际args/files/covers，沿用full/blocker，不新增任务或降低门禁。该测试覆盖禁用动态Function后的正式启动/合法动作及坏请求、集合/内容拒绝；微信preparation契约覆盖实际facade、全部Schema、来源与生成物篡改，资源预检标记为node-aot-public-bootstrap-passed。Web旧resourcePreflight和默认动态路径保持。Node不替代新提交的Creator/SDK、微信真实输入/日志/重载、Web回归或审查/CI。

## M2微信存储与生命周期

M2运行时改动集中于独立微信outer，并同步构建来源、测试和文档：手动单逻辑槽经Creator sys.localStorage接入平台存储，保存与读取沿既有Session/SaveManager及校验；前后台事件只限制输入与维护会话，不自动存档或补算时间。旧三层及outer直接wx/fs禁令保持，正式SaveFile和玩法不变。

备份与中断保护须同时考虑失败前后可能发生写入：备份、主档与恢复信息分开；读取、恢复和失败路径以源码及针对性测试为准，不能将异常等同于未落盘。故障保护依赖存储键相互独立和可读回一致的有限模型，真实微信断电、设备故障及底层原子性未证明。备份恢复不等于跨平台导入或自动存档。

tests/cocos-wechat-storage.test.ts登记进既有test:cocos-wechat-runtime的args/files，相关源及meta也进入preparation/runtime登记和trace.cocos.wechat-m1。受控Node契约不替代真实Creator、官方微信工具输入/存储/生命周期、最终提交CI或手机验收；具体结果以仓库外证据为准。

## M3微信加工包

微信outer消费现有公开方法、输入要求、批次、设施和任务投影；玩家可直接开工和领取，预览可选。menu_confirm_processing_direct先对当前选择做只读正式校验，再经Session/ActionPipeline分发start_processing或collect_processing_result；不能将预计产物当作实际领取。任务推进仍使用advance_time，工具和方法时间仅作配置说明，不新增工具消耗、扣时、重复输入、Stage1B或其他正式玩法。

ProcessingSystem与正式动作共用独立开工和领取计划；InventorySystem按既有顺序计算逐项消耗，StorageReconciler复用同一占用计算检查投影容量，在任务及产物ID分配前拒绝无效操作。会话/选择变化清旧预览，业务拒绝与提交后结果不确定分别呈现，不自动重发。老Web交互仍沿原菜单路径。trace.processing.required-inputs与trace.cocos.wechat-m1分别连接核心和微信相关既有测试，Creator、微信、手机及Web各自按固定提交留证。

## 微信加工分步界面与结果核对

加工总览显示方法、各项要求和设施状态；分步列表或分页完成选材、数量编辑、设施选择、汇总、任务查看及领取，选择与删除分开，预计产物和实际结果分开。完整要求与已选项目可逐页访问，空档、错误、后台及安全区实际表现须在相应平台独立验证。

开工在途禁止重复提交；确定前置拒绝保留草稿供修正，已提交或不能确认时隔离本次提交材料并锁定开工；须只读刷新当前会话、查看任务和库存，之后由玩家重新选择材料。领取不确定时当前界面实例锁定任务并提供“重新核对”：WechatProbeController.refreshProcessingView仅经既有Queue refresh刷新当前会话的公开列表，不读写存档、不分发正式Action、不自动领取。刷新失败、结果缺失、后台或过期回执保持锁；领取只有任务状态与可领取列表相互一致时才能解除锁，确认ready后等待玩家手动领取，已完成不能重复领取。锁不是跨重启持久保证。
