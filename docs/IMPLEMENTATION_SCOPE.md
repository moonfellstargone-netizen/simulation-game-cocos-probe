# IMPLEMENTATION_SCOPE — v0.0.2.42

版本：v0.0.2.42 / Web Cooking Selection & Dish Feedback / 网页烹饪选料与菜品反馈版。

## 本轮范围

本轮唯一目标是网页烹饪选料与菜品反馈：浏览现有配方的必需/可选角色和最低量，逐角色选择公开材料批次与数量，明确选择火候、填写操作时长并选择目标储存，经既有menu_preview/confirm获得真实DishLot，显示实际份数、材料和燃料状态，支持手动保存及全新会话读取后继续。outer管理选择和本次反馈，确认重校验最新状态；改输入、切页、其他命令或读档清旧预览。core业务、Session/Queue、SaveFile和正式资源保持，不新增配方、补给、时间或重复输入规则；既有农事、库存/拆分、加工和存读档回归保留。

工具只读取仓库唯一src/design_snapshot派生的工作副本。prepare继续导出snapshot及全部58项Schema并记录Git来源/输入产物摘要；build记录实际Web产物清单摘要，verify核对构建关联和产物字节后才启动浏览器，拒绝替换或篡改的Web目录。工程、依赖、报告、缓存和构建仍位于仓库外，不形成第二源码权威。

保留准备/生命周期full/blocker回归，沿用test:cocos-web-verification-contracts / registry test.cocos-web-verification-contracts验证浏览器工具的参数、来源、HTTP服务和断言失败保护；Node契约不执行真实浏览器。独立cocos:verify:web运行固定Creator构建产物的真实Chrome鼠标点击，记录Button事件、时间变化、Label同步与清理证据；根typecheck只覆盖src，不能代替实际Creator类型、构建或浏览器验收。

构建网页built-web验收1440×1200、1280×720、960×640、800×600/DPR1，另960×640/DPR2仿真，并在同页按960×640→1440×1200→800×600→960×640执行四次resize点击。编辑器预览editor-preview独立验收1440×1200与960×640/DPR1，同页按960×640→1440×1200→960×640执行三次resize点击。所有约定案例均保持完整canvas/Button可见、scroll稳定、会话身份不变、Button事件恰好一次、推进命令时间+60和Label同步；存读档命令按本地单槽预期检查时间；不降低断言强度。官方Default设备模拟器在800窗口裁剪固定960px内容，该预览场景未承诺支持，不能据其失败推定构建网页800失败。DPR仿真不等于手机、触摸、微信或Windows系统缩放验证。

本轮保留test:cocos-session / registry test.cocos-session、bootstrap、绑定恢复、存储故障和PR CI回归。traceability仍由traceability-map.json与TRACEABILITY_MATRIX对齐；trace.cocos.web-cooking-loop追踪本版，trace.cocos.web-processing-loop追踪既有加工页，trace.cocos.web-inventory-split与trace.inventory.split-quantity追踪既有拆分，trace.runtime.id-recovery追踪既有ID恢复，trace.processing.required-inputs追踪既有加工校验，trace.cocos.web-inventory-storage追踪既有库存能力，既有trace.cocos.browser-local-save保持；既有trace.cocos.web-save-load-recovery、trace.cocos.web-viewport-input及trace.cocos.web-bootstrap-probe继续有效。版本和BuildId由project-target.json派生。

## 明确不做

不进入 Stage 1B，不改变 ActionPipeline，不改变 SaveFile，不改变正式 fixture，不新增玩法、wx、AOT或通用UI框架；不做自动续存档、多槽、云同步、导入导出、跨标签冲突治理或正式版本迁移。旧game-core、cocos-app、cocos-creator-adapter仍不接真实 Cocos、不接 wx或fs；只有既有cocos-engine-probe外层使用cc。

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

既有农事outer、纯选择辅助ProbeFarming.ts和库存辅助ProbeInventory.ts及其回归保持；既有核心split_lot数量/占用及配置依赖保持，本版通过最小app只读投影和outer增加网页烹饪选料及真实菜品反馈，不增加燃料机制、完整进度条或新正式业务API，Session/Queue契约不变。

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

本版实际触及测试逐一登记args/files/covers并验证单文件affected真正执行自身任务；q:affected仍只用于反馈，版本完成和候选出包按q:full及无缓存q:release。核心进入Web bundle，真实Creator SDK/构建及既有built-web/editor-preview回归需独立执行。核心校验沿用既有实现；网页加工与真实输入由trace.cocos.web-processing-loop独立验收，不从核心Node通过推定。

## 网页批次拆分与操作反馈

ProbeInventory只复制公开材料选项并管理数量原文、不可编辑的来源单位和本次预览。完整解析数量，不使用parseFloat吞尾、静默取整或默认全部；count整数、g/ml小数、超量及容量沿既有正式预览校验。来源变化清空数量，改量/切页/其他命令/读档使旧预览失效；仍合法的普通拒绝输入保留供修改。

ProbeLifetime窄消费既有menu_preview/split_lot；ProbeInteraction显式区分preview、confirm和save/load，preview只认本次last_preview_result，不要求ActionResult；confirm仍经既有controller重预览，成功须本次双结果。新批次ID从本次created_objects关联刷新后的公开材料，数量/位置由公开结果取得，不从输入伪造。状态应用异常不自动重发Action；busy/销毁保护保持。

CocosWebProbe接真实cc.EditBox、单位/选择摘要、预览与确认Button；observer只读观察，不提供设置数量或派发业务捷径。核心、Session/Queue、SaveFile、正式schema/config/fixture/expected、依赖版本与门禁算法保持。既有拆分不提供全量快捷按钮；既有加工页见trace.cocos.web-processing-loop，本版烹饪页见trace.cocos.web-cooking-loop，不扩Stage1B或wx。

tests/cocos-web-split.test.ts进入现有test.cocos-engine-probe-lifecycle的实际args/files/covers，test.cocos-web-verification-contracts校验拆分观察断言负例。trace.cocos.web-inventory-split连接这些行为及独立Creator SDK/构建、built-web和editor-preview各960×640真实点击与键盘输入；旧矩阵/resize/农事/转移/存读档/故障及销毁回归保留。桌面输入不代表触摸或微信通过，版本完成仍按q:full及无缓存q:release和精确候选CI。

## 网页加工公开数据与outer边界

CocosSelectableViewModel既有processing_method_options与processing_task_options。方法逐配置要求提供requirement_index本地槽、constraints、min_quantity、候选lot_ids及compatible_facility_ids；缺料仍可查看。任务保留现有status、起止分钟、设施和明确为预计的expected_output，旧collectable_task_options仍仅ready且对象shape保持。数组、Quantity和facility_ref复制，不向outer暴露可变SaveFile。

ProbeProcessing仅管理本地选择、完整正数输入、本次预览和实际结果；不复制材料匹配、最低量或容量算法。请求仍用正式input_lots，不附加UI角色，不新增重复同lot/多primary语义。process_duration_minutes用于说明正式等待时间，time_cost_minutes不由UI补扣；完整进度条、补盐/补救、刀具选择或新设施规则不在本版。Node覆盖未就绪/重复领取正式拒绝，真实UI只要求对应禁用0事件。

## 网页烹饪选料与真实DishLot

ProbeCooking.ts/.meta只复制公开配方、MaterialLot、储存目标和现有实际DishLot选项，管理逐角色选择、数量/时长原文及本次preview/Action反馈。CocosSelectableViewModel按现有CookingSystem合并structure与recipe的角色约束，补齐形态/单位匹配、操作硬边界与偏好说明、工具设施配置说明和实际燃料当前量/成本；不修改核心或正式参数。可选油/姜不升级成必需，工具设施无新增选择或消耗行为。

操作分钟不是time_cost_minutes；不把测试high/8当默认，不补扣世界时间/体力。目标enabled不保证本次菜品放得下，outer不复制占用算法。缺必需角色可能由MenuActionBinding直接产生command failed，须清旧成功；preview只认本次结果，confirm仍重预览，成功以本次created_objects和刷新后的真实DishLot核对份数/位置。读档后列表恢复与本次产物反馈分清，失效选择/旧预览清除。

tests/cocos-web-cooking.test.ts进入既有生命周期full/blocker实际args/files/covers，readiness核只读来源和隔离，工具契约核烹饪观察负例；trace.cocos.web-cooking-loop连接。合法烹饪、缺角色/单位、储存回滚、预览无副作用、失败后恢复与新Host手动读档分层验收。标准新局腊肉先于15份燃料耗尽，燃料不足仅用受控合法Node状态验证，不把它写成网页玩家路径。真实Creator/SDK、built/editor各960×640真实输入另验，旧全部回归保留；不新增配方/补给/通用DishLot搬运、订单页或微信。
