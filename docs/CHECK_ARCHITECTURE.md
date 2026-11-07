# CHECK_ARCHITECTURE — v0.0.3.0

v0.0.3.0 / WeChat Stage1A Pilot。本轮唯一目标是v0.0.3.0的M3微信加工包：在M2及M3种植、库存与拆分候选基础上，接入加工方法、材料、设施、任务、开工与领取，并保留时间推进、手动存读档和前后台保护。加工预览可选，直接确认使用独立正式校验；候选依赖PR25、PR26、PR27和PR28的既有变更，正式动作仍经公共Host/Binding/Queue与ActionPipeline。真实Creator、官方微信工具和手机结果分别验收，不由Node契约推断；本包不代表M3完整经营或M4手机验收完成。

## 1. 既有Web检查目标（保留）

既有trace.cocos.web-viewport-input继续追踪视口与物理输入；新增订单网页验证不替代既有矩阵、resize、农事、拆分、加工、烹饪与清理检查。

保留准备/生命周期full/blocker回归，沿用test:cocos-web-verification-contracts / registry test.cocos-web-verification-contracts验证浏览器工具的参数、来源、HTTP服务和断言失败保护；Node契约不执行真实浏览器。独立cocos:verify:web运行固定Creator构建产物的真实Chrome鼠标点击，记录Button事件、时间变化、Label同步与清理证据；根typecheck只覆盖src，不能代替实际Creator类型、构建或浏览器验收。

工具只读取仓库唯一src/design_snapshot派生的工作副本。prepare继续导出snapshot及全部58项Schema并记录Git来源/输入产物摘要；build记录实际Web产物清单摘要，verify核对构建关联和产物字节后才启动浏览器，拒绝替换或篡改的Web目录。工程、依赖、报告、缓存和构建仍位于仓库外，不形成第二源码权威。

构建网页built-web验收1440×1200、1280×720、960×640、800×600/DPR1，另960×640/DPR2仿真，并在同页按960×640→1440×1200→800×600→960×640执行四次resize点击。编辑器预览editor-preview独立验收1440×1200与960×640/DPR1，同页按960×640→1440×1200→960×640执行三次resize点击。所有约定案例均保持完整canvas/Button可见、scroll稳定、会话身份不变、Button事件恰好一次、推进命令时间+60和Label同步；存读档命令按本地单槽预期检查时间；不降低断言强度。官方Default设备模拟器在800窗口裁剪固定960px内容，该预览场景未承诺支持，不能据其失败推定构建网页800失败。DPR仿真不等于手机、触摸、微信或Windows系统缩放验证。

Node任务与独立真实验收分别追踪。本版新增trace.cocos.web-orders-loop，保留trace.orders.legal-state-deadline、trace.cocos.web-cooking-loop、trace.cocos.web-processing-loop、trace.cocos.web-inventory-split、trace.inventory.split-quantity及全部既有追踪。test.cocos-engine-probe-lifecycle实际运行cocos-web-orders.test.ts及既有八测试；test.cocos-web-verification-contracts实际运行烹饪、加工、拆分断言负例及既有工具契约。修改测试逐一登记args/files/covers并验证单文件affected。CI只执行Node完整门禁，不替代Creator/浏览器。

既有test:cocos-session / registry test.cocos-session继续验证Session边界。test-registry描述Node自动执行集合，traceability-map.json连接模块、文件与门禁追踪；独立真实验收另以构建关联和浏览器证据记录。

## 2. traceability-contracts

`test:traceability-contracts` 通过 `quality.config.json` 读取 `rules.traceabilityMap`，校验 active entries 的 module/test/gate/路径一致性、planned 负向约束，以及 `TRACEABILITY_MATRIX.md` 边界短语。该测试**不得**推动业务源码重构。

## 3. version-surface-contracts（继承）

`test:version-surface-contracts` 继续验证 `project-target.json`、BuildId 派生与 release 权威。与 traceability 互补，不重复替代。

## 4. 现有门禁（继承既有 affected 策略）

- `arch:check` 继续执行 legacy validator 与 `architecture-boundary-check.mjs`。
- `architecture-boundary.rules.json` 中 authoritative 规则仍是 blocker。
- 既有cocos-creator-adapter的token/state-leak规则继续shadow findings / shadow_aligned观察口径；新增真实outer的wx全局禁令独立authoritative，不改变旧状态泄漏规则的权威级别。

## 5. q:affected 流程

`q:affected` 的目标是开发反馈，不是 release 验收。流程：changed files -> file risk classification -> owning modules -> affected tasks -> minimum required tasks -> report。

## 6. q:affected 与 full/release

`q:affected` **仍只是开发反馈**，affected 不可作为 release 验收，不替代 `q:full` 或 `q:release`。

## 7. 业务边界不变

旧game-core、cocos-app、cocos-creator-adapter仍不接真实 Cocos、不接 wx或fs；已登记Web与微信outer可导入cc，并受单向公开runtime边界约束。不进入 Stage 1B，不改变 ActionPipeline，不改变 SaveFile，不改变正式 fixture，不新增玩法或资源热更新；微信存储由独立outer适配，正式Schema保留构建期预编译兼容，其他AOT不在当前范围。

## 8. Cursor 预检

Cursor 预检是执行门禁，不是可选步骤。未确认预检报告前不得改文件。

## 9. cache 与 release

cache probe 位于 `.cache/quality`，report-only。`q:release` 不 include affected，`allowCache=false`。release gate 仍全量、无缓存、可复现。`release:build` / `release:check` 通过 `--project-target` 读取 release root/zip。

## 10. 后续路线（不是授权目标）

Nightly gate 实装、Wx Storage Port、完整 AST/symbol 自动索引均为后续候选，不是 v0.0.3.0 范围。traceability map 中 `planned` 条目**不是**当前实现。

## 11. 固定检查短语

`q:affected` 不可作为 release 验收。release gate 禁止 cache。`architecture-boundary.rules.json` 与 `architecture-boundary-check.mjs` 继续有效。`test:project-map-contracts` 与 `docs/GITHUB_WORKFLOW.md`、`docs/PROJECT_MAP.md` 保持 project-map-contracts 导航口径。

## 网页农事验收边界

test.cocos-engine-probe-lifecycle实际执行生命周期、交互、浏览器存储、cocos-web-farming.test.ts及cocos-web-inventory.test.ts及cocos-web-split.test.ts六个文件，保持full/blocker。公开Host/Component路径验证播种消耗、占用、正常推进、收获实际数量、读档选择重建与拒绝不改状态；聚焦交互用例验证completed但preview拒绝、结果缺失/不匹配不能误报成功。登记不代替实际执行。

cocos:verify:web在built-web和editor-preview各增加独立960×640农事物理点击闭环：显式选择、超量拒绝、播种保存、按天推进至公开可收获、读档恢复并清除失效选择、再次成熟收获和重新种植。本地选择/数量调整应不发送正式命令、不改变世界状态。原三按钮矩阵、Storage受控故障/坏档、刷新及同context新页面恢复、来源与销毁检查保留；不以observer调用替代点击，不将单个农事视口推导为全部新控件全矩阵通过。

## 库存适配与真实验证边界

Node覆盖正式store_item草稿/preview不变性、整批位置与占用变化、ID/形态/容量拒绝后的状态保护和健康恢复；既有MenuActionBinding.ts适配保持，不修改架构机器禁令、门禁策略或正式预期。真实库存点击另在960×640 built/editor验收，批次和位置显示须与公开结果一致；界面切换/浏览0命令，正式转移单击单命令。q:affected分别核对核心源和所有修改测试的实际执行任务，版本完成仍以q:full及无缓存q:release和真实Creator/Chrome证据收口。

## 加工必需输入校验与失败保护

按当前加工方法配置校验全部必需输入，缺料在任何消耗、任务创建和任务ID分配前拒绝。公开preview与直接正式dispatch共享验证；preview不得改变完整游戏状态、事件、库存/储存缓存或正式对象ID。正式失败保留既有失败反馈，不要求ActionRequestBuilder请求序号回滚。

契约、预览和公开Host/Component回归分别核对缺白菜、缺盐、盐不足/阈值边界，以及合法不同数量的消耗、任务、推进和领取。失败后健康请求与存读档恢复继续；不通过私有SaveFile写入构造假通过，不新增重复同lot或多primary拒绝/聚合规则。trace.processing.required-inputs连接ProcessingSystem.ts、ProcessingConfigResolver.ts及现有test.stage1a-contract、test.action-preview、test.cocos-session和test.cocos-menu。

实际触及测试逐一登记args/files/covers并验证单文件affected真正执行自身任务；q:affected仍只用于反馈，版本完成和候选出包按q:full及无缓存q:release。核心进入Web bundle，真实Creator SDK/构建及既有built-web/editor-preview回归需独立执行。核心校验沿用既有实现；网页加工与真实输入由trace.cocos.web-processing-loop独立验收，不从核心Node通过推定。

## 网页批次拆分与操作反馈

ProbeInventory只复制公开材料选项并管理数量原文、不可编辑的来源单位和本次预览。完整解析数量，不使用parseFloat吞尾、静默取整或默认全部；count整数、g/ml小数、超量及容量沿既有正式预览校验。来源变化清空数量，改量/切页/其他命令/读档使旧预览失效；仍合法的普通拒绝输入保留供修改。

ProbeLifetime窄消费既有menu_preview/split_lot；ProbeInteraction显式区分preview、confirm和save/load，preview只认本次last_preview_result，不要求ActionResult；confirm仍经既有controller重预览，成功须本次双结果。新批次ID从本次created_objects关联刷新后的公开材料，数量/位置由公开结果取得，不从输入伪造。状态应用异常不自动重发Action；busy/销毁保护保持。

CocosWebProbe接真实cc.EditBox、单位/选择摘要、预览与确认Button；observer只读观察，不提供设置数量或派发业务捷径。既有拆分规则、Session/Queue、SaveFile、正式schema/config/fixture/expected、依赖版本与门禁算法保持。既有拆分不提供全量快捷按钮；既有加工页见trace.cocos.web-processing-loop，既有烹饪页见trace.cocos.web-cooking-loop，不扩Stage1B或wx。

tests/cocos-web-split.test.ts进入现有test.cocos-engine-probe-lifecycle的实际args/files/covers，test.cocos-web-verification-contracts校验拆分观察断言负例。trace.cocos.web-inventory-split连接这些行为及独立Creator SDK/构建、built-web和editor-preview各960×640真实点击与键盘输入；旧矩阵/resize/农事/转移/存读档/故障及销毁回归保留。桌面输入不代表触摸或微信通过，版本完成仍按q:full及无缓存q:release和精确候选CI。

## 网页加工检查入口

trace.cocos.web-processing-loop连接最小app只读投影、outer加工与既有工具。tests/cocos-ui-readiness.test.ts验证投影来源/隔离，tests/cocos-web-processing.test.ts随test.cocos-engine-probe-lifecycle实际运行，ProbeProcessing.ts/.meta同时登记准备与生命周期files。full/blocker、原args及既有trace保留；缺盐/不足正式预览、任务状态及跨新会话读取按层验证，真实Creator/SDK及built/editor键盘/点击另行留证，不由Node或CI推定。

## 网页烹饪检查入口

trace.cocos.web-cooking-loop登记最小app只读烹饪投影、ProbeCooking.ts/.meta及真实组件/工具；cocos-web-cooking.test.ts加入既有生命周期实际args/files/covers，readiness及工具契约继续full/blocker。核合并约束、必需/可选角色、单位、操作硬边界与偏好区别、预览无副作用、储存与受控燃料失败回滚、恢复和真实DishLot。Node燃料负例不冒充自然网页耗尽；真实Creator/SDK和built/editor物理输入独立留证，不降低旧检查。

## 订单合法状态与截止检查

trace.orders.legal-state-deadline登记DemandResolver、GameRuntime、CocosSelectableViewModel及四个既有full/blocker任务：test.stage1a-contract、test.action-preview、test.cocos-session、test.cocos-ui-readiness。tests/traceability-contracts.test.mjs核实际args/files和full/release可达；tests/quality-affected-contracts.test.mjs保留订单保护相关测试及三处来源的单文件任务验证。完整失败保护、合法恢复及读档防重交与deadline边界由行为测试核验；正式资源、门禁算法和旧追踪保持。核心进入Web bundle，真实Creator及既有built/editor全部回归仍须本轮独立执行，不能把Node订单测试写成网页订单验收。

## 网页订单验证登记

trace.cocos.web-orders-loop连接SelectableVM、ProbeOrders/Interaction/Lifetime/CocosWebProbe、既有菜单/草稿及verify/support。readiness/menu/prepare/lifecycle/web-verification沿原full/blocker；新orders测试进入实际args，helper/.meta及测试登记prepare/lifecycle的files/covers。tests/traceability-contracts.test.mjs与quality-affected-contracts.test.mjs核真实登记/执行及所有改动测试单文件选择，不改变runner、策略、timeout或阈值。Creator先实际构建产生SDK后检查，built/editor各960×640订单链、截图及预览后SDK独立执行，旧全部回归保持。

## 跨步骤存读档恢复检查

trace.cocos.cross-step-recovery的新增集成行为由test.stage1a-bootstrap实际运行；工具断言负例由test.cocos-web-verification-contracts实际运行，两项沿用原args/files/covers与full/blocker，不新增task。保留Session/save-load/Queue/lifecycle旧保护；坏档失败核健康完整状态，恢复后实际动作与新ID须有真实结果。最终固定提交仍须q:full、无缓存q:release含build/check、独立Creator/SDK、built/editor新增五点及旧全部回归和精确headCI，不能沿用旧提交数字。

## 触摸与小屏检查

trace.cocos.touch-small-screen复用prepare/lifecycle/web-verification三项full/blocker；ProbeLayout及.meta、布局测试登记files，测试进入实际lifecycle args/package脚本。quality-affected和traceability契约验证单文件执行与追踪闭合，门禁仍47任务/full45/release47；Node契约不执行真实浏览器，最终固定提交另验Creator/SDK、旧built/editor链及新增真实触摸与逐图检查。

## M1微信独立验收

test:cocos-wechat-preparation / test.cocos-wechat-preparation实际执行tests/cocos-wechat-preparation.test.mjs；test:cocos-wechat-runtime / test.cocos-wechat-runtime实际执行tests/cocos-wechat-runtime.test.ts，均为full/blocker。trace.cocos.wechat-m1连接新outer、共享生产者、微信构建、候选身份、架构负例和质量登记。Node只能证明受控准备/行为契约；真实Creator3.8.8/SDK、官方微信工具场景/输入/日志/重载、受影响Web回归和最终提交CI各自验收。旧全部追踪、权威架构禁令和Web功能/来源检查保留，不以修改阈值、预期、CI或affected算法通过门禁。

独立apps/cocos-wechat-probe模块只消费派生公共runtime与正式资源，可使用cc，禁止直接wx/fs、业务内部、工具和测试依赖；旧三层不得反向依赖它。微信outer通过Creator平台存储外层提供手动单槽存读档及备份恢复，不增加自动保存或离线补时。不进入 Stage 1B，不改变 ActionPipeline，不改变 SaveFile，不改变正式 fixture；planned Stage1B wx-storage-port不转active。

共享helper进入旧preparation的files；新增两项任务实际args/files/covers闭合。新构建记录只认可微信game.js/game.json/project.config.json，Web记录仍要求index.html，两者不可互换。官方工具运行和一次真实输入的证据独立记录，不从安装、CLI或普通小程序页面自动化推断小游戏Canvas已可控。

## 正式Schema预编译覆盖

tests/runtime-precompiled-schema.test.ts进入现有test:stage1a-bootstrap / registry test.stage1a-bootstrap实际args/files/covers，沿用full/blocker，不新增任务或降低门禁。该测试覆盖禁用动态Function后的正式启动/合法动作及坏请求、集合/内容拒绝；微信preparation契约覆盖实际facade、全部Schema、来源与生成物篡改，资源预检标记为node-aot-public-bootstrap-passed。Web旧resourcePreflight和默认动态路径保持。Node不替代新提交的Creator/SDK、微信真实输入/日志/重载、Web回归或审查/CI。

Schema预编译只解除微信运行时动态编译依赖；M2存储通过独立outer适配，不因此开放Stage1B、其他AOT或M3—M4。

## M2微信存储与生命周期

M2运行时改动集中于独立微信outer，并同步构建来源、测试和文档：手动单逻辑槽经Creator sys.localStorage接入平台存储，保存与读取沿既有Session/SaveManager及校验；前后台事件只限制输入与维护会话，不自动存档或补算时间。旧三层及outer直接wx/fs禁令保持，正式SaveFile和玩法不变。

备份与中断保护须同时考虑失败前后可能发生写入：备份、主档与恢复信息分开；读取、恢复和失败路径以源码及针对性测试为准，不能将异常等同于未落盘。故障保护依赖存储键相互独立和可读回一致的有限模型，真实微信断电、设备故障及底层原子性未证明。备份恢复不等于跨平台导入或自动存档。

tests/cocos-wechat-storage.test.ts登记进既有test:cocos-wechat-runtime的args/files，相关源及meta也进入preparation/runtime登记和trace.cocos.wechat-m1。受控Node契约不替代真实Creator、官方微信工具输入/存储/生命周期、最终提交CI或手机验收；具体结果以仓库外证据为准。
