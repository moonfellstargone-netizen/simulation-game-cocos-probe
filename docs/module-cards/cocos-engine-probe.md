---
doc_type: module_card
status: active
applies_to: cocos-web-probe
source_of_truth: false
---

# cocos-engine-probe

## 模块职责

apps/cocos-probe/保存Creator3.8.8真实Web探针源模板和外层生命周期桥接。本Web outer可使用cc，独立微信outer另见cocos-wechat-probe模块卡；旧game-core、cocos-app、cocos-creator-adapter保持engine-neutral。既有网页支持农事、公开材料批次浏览、正式store_item整批转移及手动本地单槽存读档。既有网页拆分及核心校验保持；既有outer消费app最小只读配方/操作约束及燃料投影，提供第四网页烹饪选料与真实菜品反馈；既有加工页保留，正式匹配、数量、时间和事务仍由既有核心校验，真实输入另行验收。

工程从唯一src/design_snapshot派生runtime、snapshot及全部58项Schema；工作副本、依赖、缓存、报告和构建均在仓库外，禁止手改副本成为第二源码权威。script.loose=false保留标准JavaScript语义，不能恢复Creator默认loose破坏Ajv继承getter的已知转换。

## 允许依赖

- cc引擎类型与节点API。
- 派生公共probe-runtime.js：createStage1AHost、QinglanUiSceneProbeComponent；外层BrowserSaveStoragePort通过既有Port注入。
- 派生正式资源与project-target派生BuildId；不散落第二版本权威。

## 禁止依赖

不直接导入核心内部、tools、tests或dev/testing API，不接wx/fs，不直接改SaveFile或调用ActionPipeline。旧三层不得反向依赖此outer；浏览器验证工具不能成为游戏运行时依赖。

## 关键入口与读取顺序

- apps/cocos-probe/template/assets/scripts/CocosWebProbe.ts：真实cc组件、资源加载及Label/Button端口。
- apps/cocos-probe/template/assets/scripts/ProbeLifetime.ts：无cc的异步加载和销毁保护。
- apps/cocos-probe/template/assets/scripts/BrowserSaveStoragePort.ts：固定单槽、稳定key和惰性Storage访问，只透传原始字符串。
- tools/cocos-probe/serve.mjs：严格构建来源与固定loopback端口的最小本地启动工具。
- apps/cocos-probe/template/assets/scripts/ProbeInteraction.ts：无cc的单次操作协调、busy和销毁后迟到反馈保护。
- apps/cocos-probe/template/assets/scripts/ProbeFarming.ts：公开选项副本、当前选择、带单位播种数量和既有菜单命令草稿。
- apps/cocos-probe/template/build-templates/web-desktop/index.ejs、probe-viewport.css、probe-viewport.js：官方构建模板上的页面容器和视口同步；保留cocosTemplate注入，不能手改派生index.html。
- tools/cocos-probe/prepare.mjs：兼容Web入口，经固定共享prepareProject生产者从唯一来源派生仓库外工程。
- tools/cocos-probe/build.mjs：真实构建及Web逐文件/目录摘要。
- tools/cocos-probe/verify-web.mjs：verifyWebProbe(options)与独立真实浏览器CLI。
- tools/cocos-probe/lib/webProbeSupport.mjs：构建/验收共享的HTTP、参数、来源与Web摘要辅助。
- [边界契约](../module_contracts/CocosEngineProbe.contract.md)、[Cocos地图](../maps/cocos-map.md)、[运行地图](../maps/runtime-map.md)、[API索引](../code-index/public-api.md)。

## 修改后验证

test:cocos-probe-preparation实际prepare并验证资源、来源及生成runtime；test:cocos-engine-probe-lifecycle同时执行cocos-engine-probe-lifecycle.test.ts、cocos-web-interaction.test.ts、cocos-browser-storage.test.ts、cocos-web-farming.test.ts、cocos-web-inventory.test.ts、cocos-web-split.test.ts、cocos-web-processing.test.ts、cocos-web-cooking.test.ts与cocos-web-orders.test.ts，验证受控异步生命周期、交互恢复、公开农事及库存转移行为；test:cocos-web-verification-contracts执行既有工具契约及cocos-web-serve-contracts.test.mjs，验证参数、HTTP安全、来源、固定端口与失败保护。三项登记full/blocker，trace.cocos.web-bootstrap-probe和trace.cocos.web-viewport-input分别保留启动与视口追踪。Node契约不执行真实浏览器。

根typecheck只覆盖src；真实Creator类型、构建、预览和浏览器独立验收。cocos:verify:web要求--project、--browser、--report-dir、--build-record均为显式绝对路径；可选--preview-url只接受loopback HTTP。实际浏览器或引擎缺失必须失败或未执行，不能静默skip。

真实鼠标点击按mode区分：built-web覆盖1440×1200、1280×720、960×640、800×600/DPR1与960×640/DPR2仿真，并执行960×640→1440×1200→800×600→960×640四次resize点击；editor-preview只覆盖1440×1200与960×640/DPR1，并执行960×640→1440×1200→960×640三次resize点击。每次完整canvas/Button可见、scroll稳定、会话身份不变、Button事件恰好一次、推进命令时间+60与Label同步；存读档命令按本地单槽预期检查时间，所有断言保持。官方Default设备模拟器在800窗口会裁剪固定960px内容，该预览范围未支持；不将预览裁剪写成构建网页800失败。存读档失败恢复和退出释放保留，built-web另验证资源404及加载中销毁。禁止调用observer.advance代替点击。预览URL模式独立标记，不把构建摘要当作livepreview页面字节证明。

真实onDestroy必须同步捕获asset/lifetime引用，observer独立保留lifetime；异步释放和退出诊断不能读取已被Creator清空的Component字段。窗口变化不能重建Host或重复注册按钮。

桌面范围按约定尺寸验收，DPR仿真不等于手机、触摸、微信或Windows系统缩放通过；不承诺未测浏览器和引擎版本。版本完成仍须q:full/q:release及对应候选PR检查。

## 常见失败模式

- canvas.focus触发页面滚动，使按下和释放位置偏离同一个按钮。
- 只改CSS尺寸却没有同步引擎容器像素尺寸和resize。
- 手改生成页面或修改SDK隐藏故障。
- 构建被替换后仍使用旧result.json声称验证了对应提交。
- 将Node契约或CI通过写成真实引擎/浏览器通过。
- 将内存冒烟写成真实持久化或微信保证。

## 代码—地图同步

同步module-graph、单向architecture边界、test-registry、traceability、cocos/runtime/quality地图及files/public-api。禁止通过降低旧规则、扩白名单或跳过失败完成版本。

## 浏览器本地单槽与本次反馈

AdvanceOneHour、SaveLocal、LoadLocal均为真实cc Button，固定槽web_probe及key qinglan.simulation-game.cocos-probe.save.web_probe，不随版本/BuildId变化。启动创建既有新局但不访问Storage；同origin/profile刷新或新页面后手动读取恢复，存读档不推进。getter/读写拒绝与坏档保留当前状态及原档，不静默回退内存，不解析改写SaveFile，不做正式迁移或未知版本拒绝承诺。

ProbeInteraction保留loading、busy、closing、destroyed拒绝重复输入和迟到保护；存读档反馈只解释本次command_result的对应save_load结果，menu_confirm另核对本次preview/ActionResult，历史面板记录保留。observer只用于状态和生命周期诊断，移除会覆盖真实槽的memoryRoundtrip写入，不提供存储捷径。

trace.cocos.browser-local-save追踪adapter、行为测试、三按钮、固定来源工具与真实浏览器验收；trace.cocos.web-save-load-recovery继续追踪既有Queue结果归属。每个支持视口验证空槽失败后继续、420→保存→480→读取420；另外验证刷新新局360→手动读取420及同context新页面，原始字符串不被启动/诊断写入。受控Storage故障和坏档后健康恢复分别留证；故障注入不等于真实权限/配额耗尽实测。Node结果不能替代Creator/Chrome证据。

cocos:serve:web使用显式固定端口和127.0.0.1来源，先核对构建记录与产物字节，冲突失败且不自动换端口；使用方式见README。不同协议/host/port/profile不共享存档，清除浏览器数据可能丢失本地存档；不承诺跨标签冲突治理、自动续档、云同步或wx。

## 网页种植收获与操作反馈

ProbeFarming.ts是无cc的outer选择辅助，只复制公开MenuRenderSnapshot中的选择项，管理地块/种子/作物ID、播种数量和命令草稿；数量带公开单位。挂载、每次操作完成及手动读取后重新核对选择，失效ID清除。不按名称或ID后缀推断身份，不持有或改写SaveFile。

CocosWebProbe使用真实Button连接现有plant_crop、advance_time、harvest_crop；推进一天是明确1440分钟的正常时间操作，不提供“直接成熟”。界面显示占用、可收获列表及材料实际数量；公开API不提供全部生长中作物，因此不显示完整生长条或倒计时。局部选择操作不发正式命令。

ProbeInteraction对menu_confirm核对本次preview动作类型、preview/ActionResult的success、完整性及拒绝信息，completed只表示处理完成；拒绝、缺失或preview动作不匹配不得显示成功。save/load仍只解释本次对应结果，不使用读档前遗留的菜单成功；不修改Queue契约、Session或核心规则。

tests/cocos-web-farming.test.ts加入既有生命周期full/blocker实际args，files/covers包含纯helper和测试；trace.cocos.web-farming-loop连接该行为、模块/索引和独立浏览器工具。真实农事完整点击在960×640 built/preview分别验收超量拒绝、播种/数量/占用、按天推进、存读档选择重建、实际收获与再次种植；原视口矩阵、本地存储与销毁回归保持，Node和根typecheck不替代真实Creator/Chrome。

## 网页库存与整批储存转移

ProbeInventory.ts只复制公开MaterialLot选项和储存目标，管理当前批次/目标选择，不拥有可变运行态。逐批浏览当前公开材料的名称、current_form、数量/单位与storage_ref，展示目标支持形态和容量/占用。名称只用于展示，身份和单位取公开选项；不展示DishLot通用库存、完整新鲜度或保鲜倒计时。

既有MenuActionBinding.ts将当前公开MaterialLot与储存目标解析为正式store_item草稿；预览、正式Action、存储审计与回滚沿既有路径。该适配作为已有能力保留，既有实现保留拆分数量与占用校验及配置依赖传播，不改变Session/Queue、ActionPipeline协议或SaveFile，不绕过组件菜单或直接写状态。

整批转移仍不携带数量；拆分是同页独立操作。容量单位为slot_weight；目标enabled只说明目标自身可用，不保证放得下所选批次，outer不以克数估算容量或复制footprint算法。形态不支持、容量不足和失效选择由既有绑定/preview/Action给出拒绝，失败保留状态，健康操作可继续。同容器移动在核心仍合法，界面只避免无意义重复提交，不新增核心拒绝规则。

挂载、动作及成功读档后重新消费公开列表，更新位置和容量，清除失效选择。界面切换/浏览仅改变本地视图，不发正式命令；转移按本次preview/ActionResult反馈，不把completed或旧菜单成功当本次业务结果。保留busy、销毁后迟到保护、农事闭环和手动存读档。

tests/cocos-web-inventory.test.ts加入既有test:cocos-engine-probe-lifecycle实际args，tests/cocos-minimal-menu-binding.test.ts验证唯一适配；helper、.meta和测试的files/covers及单文件affected闭合。trace.cocos.web-inventory-storage连接Node行为与独立真实点击。新增库存完整闭环至少在960×640 built-web/editor-preview分别验收；因布局受影响的既有农事、三按钮矩阵/resize、存储失败和来源/销毁回归继续验证，不把Node或observer调用冒充真实输入。

## 网页批次拆分与操作反馈

ProbeInventory只复制公开材料选项并管理数量原文、不可编辑的来源单位和本次预览。完整解析数量，不使用parseFloat吞尾、静默取整或默认全部；count整数、g/ml小数、超量及容量沿既有正式预览校验。来源变化清空数量，改量/切页/其他命令/读档使旧预览失效；仍合法的普通拒绝输入保留供修改。

ProbeLifetime窄消费既有menu_preview/split_lot；ProbeInteraction显式区分preview、confirm和save/load，preview只认本次last_preview_result，不要求ActionResult；confirm仍经既有controller重预览，成功须本次双结果。新批次ID从本次created_objects关联刷新后的公开材料，数量/位置由公开结果取得，不从输入伪造。状态应用异常不自动重发Action；busy/销毁保护保持。

CocosWebProbe接真实cc.EditBox、单位/选择摘要、预览与确认Button；observer只读观察，不提供设置数量或派发业务捷径。既有拆分规则、Session/Queue、SaveFile、正式schema/config/fixture/expected、依赖版本与门禁算法保持。既有拆分不提供全量快捷按钮；既有加工页见trace.cocos.web-processing-loop，既有烹饪页见trace.cocos.web-cooking-loop，不扩Stage1B或wx。

tests/cocos-web-split.test.ts进入现有test.cocos-engine-probe-lifecycle的实际args/files/covers，test.cocos-web-verification-contracts校验拆分观察断言负例。trace.cocos.web-inventory-split连接这些行为及独立Creator SDK/构建、built-web和editor-preview各960×640真实点击与键盘输入；旧矩阵/resize/农事/转移/存读档/故障及销毁回归保留。桌面输入不代表触摸或微信通过，版本完成仍按q:full及无缓存q:release和精确候选CI。

## 网页加工开工与领取

ProbeProcessing.ts/.meta只复制公开方法/逐要求候选、设施与完整任务列表，管理requirement_index本地选择和真实数量原文。工具要求与允许形态只读展示，不新增工具选择或消耗；缺料方法仍可查看，缺盐/不足交正式预览；不在outer解析SaveFile、复制freshness/数量匹配或增添role。既有menu_preview/confirm执行start_processing和collect_processing_result；确认重预览，实际任务/产物从本次created_objects关联刷新公开数据。改输入/切页/其他命令/读档清旧预览，busy/销毁及应用失败不自动重发保持。

任务显示现有active/ready_to_collect/completed等status，领取只对旧collectable列表开放；预计产物与实际领取分清。tests/cocos-web-processing.test.ts进入现有生命周期实际args，helper/.meta及测试登记准备/生命周期files；readiness验证app投影。trace.cocos.web-processing-loop连接Node行为与独立Creator/SDK、built/editor各960×640真实键盘和点击验收，未就绪/重复领取网页只记禁用0事件，正式失败另由Node验证。旧全部视口/resize、农事、库存/拆分、存读档/故障及销毁回归保留。

## 网页烹饪选料与菜品反馈

ProbeCooking.ts/.meta复制当前公开配方角色、材料、储存及实际DishLot，管理逐角色选择、数量/操作分钟原文、显式火候与本次preview/Action反馈，不读私有SaveFile或复制业务算法。第四页使用真实EditBox及Button，改输入/切页/其他命令/读档清旧预览，busy/销毁/迟到保护和应用失败不重发保持。必需角色缺失的绑定失败与正式预览拒绝均清旧成功，成功只以本次created_objects关联刷新后的真实DishLot，恢复列表不冒充本次产物。

当前实现硬边界与配置偏好分开，只读工具设施/时间成本不新增选择、扣时或消耗。tests/cocos-web-cooking.test.ts实际进入既有生命周期args/files/covers，helper/.meta登记准备/生命周期，readiness和工具契约继续full/blocker；trace.cocos.web-cooking-loop连接。真实Creator/SDK、built/editor各960×640鼠标键盘烹饪与手动恢复独立验收，正常燃料扣减和受控Node燃料不足分清，旧全部回归保留。该既有子流程不负责订单页面，不扩Stage1B或微信。

## 网页酒馆订单与结算反馈

SelectableVM.order_options复制issuer_id、deadline_absolute_minute、signed minutes_until_deadline、正式需求的hard/weighted/defects/threshold、submitted refs和实际result_summary。订单名来自正式Profile文本，缺配置为null并不可用，嵌套数据全部独立副本。enabled只表示状态/时限及配置允许尝试，不保证所选菜品匹配；正/零截止余量和负余量来自当前绝对时间，不从day Label反算。StateVM及核心摘要保持。

ProbeOrders.ts/.meta只消费公共数据，管理第五页的显式单订单/单菜品本地选择和本次反馈，不改正式submitted_object_refs数组规则。终态可浏览、无菜品显示真实空态；浏览/选择0命令。preview只认本次校验，不伪造预计奖励；base_reward明确只是配置参考。确认沿既有menu→DraftBuilder→ActionPipeline，并以本次合法preview/ActionResult、实际Order.result_summary、所选菜品真实移除及公共金钱/声望变化关联成功，其他菜品保持。

确认前捕获order/dish与经济基线，避免成功patch先移除选择后误拒本次回执；错误或陈旧结果在ProbeInteraction发布completed前拒绝，应用失败不重发Action。改选择、切页、其他命令和load清旧预览/本次成功，历史结算另行展示；普通拒绝保留合法选择供修正，失效对象清除，不自动换菜品。busy/销毁迟到及本地单槽手动存读档保持。

tests/cocos-web-orders.test.ts实际进入既有lifecycle的args/files/covers，helper/.meta及测试同时登记prepare/lifecycle；readiness、menu与web-verification继续full/blocker。trace.cocos.web-orders-loop连接这些测试与源/地图，全部旧追踪保持。真实Creator/SDK和built/editor各960×640订单链、实际图检另行验收，保留原视口/resize、农事、库存拆分、加工、烹饪、存读档/故障与销毁。网页禁用重交只记0事件，正式状态/安全/低分拒绝由合法受控Node另验，不冒称微信或手机通过。

## 五点恢复的真实浏览器证据

trace.cocos.cross-step-recovery新增verify-web的独立普通玩家recoveryLoop；生长中、加工中、可领取、菜品已成、订单完成各自然达成后手动保存，刷新及同context新页读取同一原点后实际继续。webProbeSupport通用恢复断言与既有web-verification任务负例闭合，保持原专用农事断言及全部五页/矩阵/resize/故障/销毁链。恢复链仍沿既有业务机制，outer仅增加布局/滚动只读诊断，不新增状态写入捷径；Node契约不执行真实浏览器，Creator/SDK及built/editor真实输入、图检另验。

## 触摸与小屏操作准备

trace.cocos.touch-small-screen：built-web约定800×360、844×390、960×432，另844×250→390模拟可视区缩高恢复。compact以真实CSS frame布局，正文至少14CSSpx、按钮/EditBox命中高至少44CSSpx。ProbeLayout纯几何与Cocos原生ScrollView/Mask保证内容可达，切页重置滚动、resize保持Host/observer/Button身份与单次CLICK绑定。

ProbeLayout.ts/.meta及tests/cocos-web-layout.test.ts登记prepare/lifecycle，布局测试真实进入lifecycle args/package脚本；工具观察与负例沿web-verification。按下/滑动取消、滚动后输入、单次tap及本次operation/公开世界需互证。旧鼠标、五页经营/五点恢复、Storage失败/坏档与生命周期链全部保留；Node契约不执行真实浏览器。

输入框通过公开tabIndex管理焦点顺序：compact模式Tab结束当前编辑，下一字段由玩家显式触摸或鼠标选择，避免跳入已初始化的隐藏或Mask外输入框；desktop保留当前页可用输入框的顺序Tab，隐藏或禁用字段不参与。初始创建、enabled状态更新和resize后同步，不改变数量文本解析或正式业务规则。此控件行为仍须真实浏览器核验，不能由源码登记推定手机软键盘通过。

compact重排前通过公开isFocused捕获当前编辑框，缩高/恢复后按布局计划计算夹在有效滚动范围内的offset，再由原生ScrollView.scrollToOffset完整揭示该框；原输入文本、选择、会话与按钮身份保持。无焦点时仍归顶，切页先沿原逻辑结束编辑，约定之外容不下完整字段的窗口才结束编辑。电脑触摸滚动可能自然结束编辑，仍须核原文和世界不变；built缩高证据不推定editor同项或真实手机键盘通过。

editor保留原矩阵，新增触摸用Creator原生WebpageFullScreen控件切换并逐实际canvas/frame几何标注，不篡改预览DOM造支持。电脑hasTouch/DPR或缩高恢复不证明vivo X200s真实键盘、安全区或微信触摸。busy/销毁迟到沿既有受控Node回归与浏览器实际可观察窗口分别说明，不伪造同步Storage pending。真实Creator/SDK、built/editor鼠标/触摸和逐图检查独立留证。

正常经营/存读档链console error必须为零，pageerror在全部场景都必须为零；旧missing-resource预期404单独归类。另有且仅有受控touch-native-cancel负例可记录一条SDK/Chrome诊断全文：Ignored attempt to cancel a touchcancel event with cancelable=false, for example because scrolling is in progress and cannot be interrupted. 必须同时证明原生cancel为trusted、cancelable=false、取消0CLICK/0command、世界保持及后续真实保存/推进/读取健康恢复；保留原始console。全文出现于其他case、被伪标missing-resource、次数非一、原生或恢复证据缺失、其他console error/pageerror均失败，不能泛过滤touch页面或报告原始console零error。该归属来自安装SDK原生touch-input回调与实际负例，不修改SDK或架构/门禁策略。
