# ARCHITECTURE — v0.0.3.0

当前版本：v0.0.3.0 / WeChat Stage1A Pilot。本轮唯一目标是v0.0.3.0的M3微信库存拆分包：在M2及M3种植与库存首包基础上，接入可选预览与独立校验的库存拆分确认，并保留播种、收获、整批转移、手动存读档和前后台保护。候选依赖PR25、PR26和PR27的既有变更；运行身份仍来自当前包的只读candidate_id和短commit，正式动作仍经公共Host/Binding/Queue与ActionPipeline。真实Creator、官方微信工具和手机结果分别验收，不由Node契约推断；本包不代表M3完整经营或M4手机验收完成。

## 1. 业务架构不变

`game-core 独立于 Cocos / wx / 表现层` 仍是核心红线。`cocos-creator-adapter` 仍是纯 TypeScript、engine-neutral 的 Cocos Creator 适配探针（cocos-creator-adapter 仍是 TypeScript probe），不接真实 Cocos、不接 wx、不接 fs。

本轮不改变 ActionPipeline，不改变 SaveFile，不改变正式 fixture，不新增 gameplay action，不进入 Stage 1B。

## 2. tools/quality/affected

`tools/quality/affected` 是检查工具层，不属于游戏业务逻辑。它只读取 changed files、module graph、test registry、gate policy 与 quality rules，用于计算受影响模块、任务集合和覆盖证据。

它不得修改 `src/game-core`，不得成为 ActionPipeline、SaveFile、fixture 或 runtime contract 的权威来源。

## 3. affected policy 与业务逻辑隔离

affected policy 的风险分级、fallbackLevel、minimumRequiredTasks、taskSelectionReasons 和 skippedTaskReasons 只决定开发期检查覆盖，不决定游戏玩法规则，不改变正式状态流转，不新增 formal action。

## 4. cache 边界

`tools/quality/cache` 管理 `.cache/quality` report-only probe。cache 不参与 release 权威判断，不跳过 release/full 的关键任务，不改变任务失败语义。

## 5. traceability 层

`tools/quality/rules/traceability-map.json` 与 `docs/TRACEABILITY_MATRIX.md` 是文档治理追踪层，不属于游戏业务逻辑，不替代 module-card 或源码。

## 6. 架构边界检查继承

`architecture-boundary.rules.json` 与 `architecture-boundary-check.mjs` 继续承担架构边界检查；authoritative blocker 与 shadow findings 的分层不因 `q:affected` 改变。旧 validator 仍保留高风险红线。

## 7. 固定边界短语

game-core 独立于 Cocos / wx / 表现层。tools/quality 仍是检查工具层，不属于游戏业务逻辑。不改变 ActionPipeline。不改变 SaveFile。不改变正式 fixture。

## 8. PR CI 执行入口

`.github/workflows/quality.yml` 归属 tools 检查基础设施，只调用锁定依赖安装和既有 `q:full`；工作流 YAML 契约、报告 artifact 与 `trace.quality.pr-ci` 提供执行追踪。它不进入 game-core 运行时依赖，不增加平台适配或正式状态入口，也不改变 full / release 的失败与缓存边界。

## 9. 存储故障验证边界

现有 `SaveStoragePort` 只隔离平台读写；Session 保持候选读档提交策略，Controller 展示错误并清除旧成功结果，Queue 保持串行执行和失败后继续。`tests/support/controlledSaveStoragePort.ts` 组合既有内存端口，验证即时或延迟拒绝及恢复，不接真实平台，不注入游戏运行时依赖。

本轮不扩展存储错误码治理、不改变byte_length、不承诺真实存储部分写入后的原子回滚；参见ADR-0003、SaveStoragePort契约与`trace.save.storage-failure-recovery`。

## 10. 启动装配与资源就绪

宿主装配属于既有运行模块外层，只接收外部提供的已解析快照、Schema集合、存储端口与明确启动参数，不导入文件系统、测试辅助或开发API。资源契约描述输入和装配关系，不替代正式配置或Schema权威，也不凭元数据字符串证明来源真实性。

就绪检查复用现有校验器，覆盖必要Schema及引用的编译可用性；新局仍经既有SaveFile校验与StorageAudit。只有检查和初始化成功才交付可操作宿主，失败不发生存储读写或正式Action副作用。创建Host的入口不能放在需要反向依赖creator-adapter的cocos-app内部。

该链路由`trace.runtime.bootstrap-resources`追踪。测试可在边界外读取正式样本，但运行装配不能依赖runtimeHarness；Node集成结果仅证明平台无关链路，不证明真实Cocos资源加载、打包或依赖兼容。

## 11. 场景绑定顺序与重同步

`CocosSceneBindingController`以实例级顺序管理完整操作：执行前读取Shell快照、等待既有命令队列、生成差异并等待全部端口更新。`applyInitialSnapshot`进入同一顺序；组件mount/refresh/execute/unmount复用此入口。该顺序不替代业务事务，也不覆盖多个controller或外部直接Host调用。

端口批次失败使视图需要重同步，调用仍拒绝原始端口错误，后续排队可继续。下一次绑定操作全量刷新当前四区；成功后恢复普通diff。`diff`仅表示Shell前后变化，恢复的`applied_updates`可多于差异区。正式Action可能已提交，绑定恢复不能回滚或重发业务；端口已产生的部分副作用不保证撤销。由`trace.cocos.binding-async-recovery`追踪，使用受控端口的实际节点状态验收。

## 12. 真实Cocos Web外层

仓库内apps/cocos-probe保存最小工程源模板及外层桥接；tools/cocos-probe/prepare.mjs从现有src/design_snapshot派生浏览器runtime与全部58个声明Schema，在仓库外生成可打开工作副本。probe-source-manifest.json记录sourceCommit、sourceDirty、输入/产物摘要及project-target派生BuildId，副本不成为第二套代码或配置权威。

旧game-core、cocos-app、cocos-creator-adapter仍不接真实 Cocos、不接 wx或fs；已登记的Web与微信outer可导入cc，并受单向公开runtime边界约束。不进入 Stage 1B，不改变 ActionPipeline，不改变 SaveFile，不改变正式 fixture，不新增玩法或资源热更新；微信存储由独立outer适配，正式Schema保留构建期预编译兼容，其他AOT不在当前范围。旧模块禁止反向依赖apps/cocos-probe或apps/cocos-wechat-probe。新外层只能消费派生公共runtime，不直接访问核心内部、tests或dev/testing API；浏览器Storage仅由外层BrowserSaveStoragePort经现有Port注入，旧三层不接平台API，wx/fs禁令保持。

Node中的准备契约和外层生命周期测试登记为full/blocker，由trace.cocos.web-bootstrap-probe追踪；它们验证实际派生产物、资源完整性、异常路径和确定性生命周期，不冒充引擎运行证据。根typecheck仍仅覆盖src。真实Creator预览与Web构建另行执行，缺引擎时明确失败或未执行，不能静默skip或使用假cc类型声称通过。

## 真实Web视口与输入验收

工具只读取仓库唯一src/design_snapshot派生的工作副本。prepare继续导出snapshot及全部58项Schema并记录Git来源/输入产物摘要；build记录实际Web产物清单摘要，verify核对构建关联和产物字节后才启动浏览器，拒绝替换或篡改的Web目录。工程、依赖、报告、缓存和构建仍位于仓库外，不形成第二源码权威。

保留准备/生命周期full/blocker回归，沿用test:cocos-web-verification-contracts / registry test.cocos-web-verification-contracts验证浏览器工具的参数、来源、HTTP服务和断言失败保护；Node契约不执行真实浏览器。独立cocos:verify:web运行固定Creator构建产物的真实Chrome鼠标点击，记录Button事件、时间变化、Label同步与清理证据；根typecheck只覆盖src，不能代替实际Creator类型、构建或浏览器验收。

窗口变化不得重新创建Host或重复绑定按钮。布局与输入修复只属于apps/cocos-probe外层，浏览器测试工具不能反向成为运行时依赖。

## 浏览器本地存储边界

BrowserSaveStoragePort惰性取得Storage，只透传稳定key下的原始字符串，固定槽web_probe，不解析SaveFile、不改变Session候选校验后提交策略。启动不自动load/save或覆盖旧档，刷新后的新局通过用户点击读取才恢复。getter/read/write错误沿现有操作失败链路返回，无静默内存回退；坏档保留当前会话及原档，健康操作可继续。移除会写入该槽的observer.memoryRoundtrip诊断。

tools/cocos-probe/serve.mjs复用严格构建来源和HTTP保护，显式固定端口且冲突失败，不自动变更origin。跨浏览器/profile/origin、多槽、自动续档、云同步、冲突治理与正式迁移均不属于本版；Node与真实Creator/浏览器证据分别记录。见trace.cocos.browser-local-save。

## 网页农事选择与结果反馈

ProbeFarming位于apps/cocos-probe外层，只复制公开选项、管理当前选择和播种数量；正式状态始终由menu_confirm经过既有preview和ActionPipeline改变。成功读档后重新消费公开列表并清除失效选择，不直接修补SaveFile。

ProbeInteraction区分队列处理完成与本次业务成功，menu_confirm核对公开preview/ActionResult及动作类型；save/load只读取对应本次结果。保留旧面板历史，不因旧结果改变本次判断，不重新定义Queue.completed或新增事务入口。trace.cocos.web-farming-loop追踪这条outer消费链。

## 网页库存与整批储存转移

ProbeInventory.ts只复制公开MaterialLot选项和储存目标，管理当前批次/目标选择，不拥有可变运行态。逐批浏览当前公开材料的名称、current_form、数量/单位与storage_ref，展示目标支持形态和容量/占用。名称只用于展示，身份和单位取公开选项；不展示DishLot通用库存、完整新鲜度或保鲜倒计时。

既有MenuActionBinding.ts将当前公开MaterialLot与储存目标解析为正式store_item草稿；预览、正式Action、存储审计与回滚沿既有路径。该适配作为已有能力保留，既有实现保留拆分数量与占用校验及配置依赖传播，不改变Session/Queue、ActionPipeline协议或SaveFile，不绕过组件菜单或直接写状态。

整批转移仍不携带数量；拆分是同页独立操作。容量单位为slot_weight；目标enabled只说明目标自身可用，不保证放得下所选批次，outer不以克数估算容量或复制footprint算法。形态不支持、容量不足和失效选择由既有绑定/preview/Action给出拒绝，失败保留状态，健康操作可继续。同容器移动在核心仍合法，界面只避免无意义重复提交，不新增核心拒绝规则。

挂载、动作及成功读档后重新消费公开列表，更新位置和容量，清除失效选择。界面切换/浏览仅改变本地视图，不发正式命令；转移按本次preview/ActionResult反馈，不把completed或旧菜单成功当本次业务结果。保留busy、销毁后迟到保护、农事闭环和手动存读档。

## 加工必需输入校验与失败保护

按当前加工方法配置校验全部必需输入，缺料在任何消耗、任务创建和任务ID分配前拒绝。公开preview与直接正式dispatch共享验证；preview不得改变完整游戏状态、事件、库存/储存缓存或正式对象ID。正式失败保留既有失败反馈，不要求ActionRequestBuilder请求序号回滚。

契约、预览和公开Host/Component回归分别核对缺白菜、缺盐、盐不足/阈值边界，以及合法不同数量的消耗、任务、推进和领取。失败后健康请求与存读档恢复继续；不通过私有SaveFile写入构造假通过，不新增重复同lot或多primary拒绝/聚合规则。trace.processing.required-inputs连接ProcessingSystem.ts、ProcessingConfigResolver.ts及现有test.stage1a-contract、test.action-preview、test.cocos-session和test.cocos-menu。

实际触及测试逐一登记args/files/covers并验证单文件affected真正执行自身任务；q:affected仍只用于反馈，版本完成和候选出包按q:full及无缓存q:release。核心进入Web bundle，真实Creator SDK/构建及既有built-web/editor-preview回归需独立执行。核心校验沿用既有实现；网页加工与真实输入由trace.cocos.web-processing-loop独立验收，不从核心Node通过推定。

## 持久ID恢复与预览一致性

IdService观察完整GameState的字符串值及记录键，恢复生成格式ID的每前缀高水位；这只决定技术ID分配，不用于判断材料身份。十进制字符串递增避免Number大后缀精度停滞。同一runtime高水位只升不降，GameRuntime包装全部已注册handler，使直接pipeline、Session和预览新runtime均在业务分配前恢复。ActionPipeline、存档结构与正式业务规则保持。

保证覆盖存档中仍存在的对象和任意历史引用，以及同一runtime已知分配；整个SaveFile已无任何记录的历史ID不能无新增持久化字段地恢复。预览不修改领域状态或正式ID服务；失败保持既有事务语义，不承诺请求序号或已分配ID回滚。

trace.runtime.id-recovery连接IdService.ts、GameRuntime.ts、CocosActionPreviewer.ts与Session；test.stage1a-contract、test.action-preview、test.cocos-session核对各对象/事件、历史引用、跨实例加载、极大后缀及合法恢复。该ID恢复能力不新增数量规则；网页拆分由outer单独提供，既有加工页独立消费正式加工，既有烹饪页消费既有cook_dish，不扩Stage1B或wx。真实Creator及既有built/editor浏览器回归独立执行，核心/Session回归与网页真实输入分别验收。

## 拆分数量、定义占用与失败保护

正式split_lot要求请求和源数量为有效正数/finite，count保持整数，各单位整数请求须按请求原值扣减，partial须实际减少源；不新增g/ml最小量或一律整数限制。连续小数沿用Number舍入，未引入任意精度十进制语义。全量保留既有成功语义，归零源移出active inventory，新的正量批次保留inventory_split来源、lineage和旧源ID审计；该策略是兼容实现选择，不是正式包唯一指定的全量规则。

InventorySystem经ConfigRepository读取当前已加载材料/种子定义，按ceil(quantity/base_quantity*footprint)、正数至少1slot_weight分别重算源余量和新批次占用；不从已取整旧占用继续按比例缩放，也不以直接数量比较容器容量。Runtime及Farming/Processing/Cooking只传播构造依赖，consume算法不改。数量/定义拒绝发生在修改及ID分配前；容量失败沿既有事务恢复领域状态，已消耗ID不要求回滚。

trace.inventory.split-quantity连接InventorySystem及配置调用方，现有test.stage1a-contract、test.action-preview、test.cocos-session、test.cocos-menu验证完整状态、正/负例、定义变化、连续拆分、全量来源、预留/容量保护、公开预览与失败后存读档/健康恢复。正式资源、SaveFile、管线和核心规则保持；真实Creator与现有built/editor回归独立执行，网页拆分由trace.cocos.web-inventory-split独立真实输入验收，不从核心测试推定。

## 网页批次拆分与操作反馈

ProbeInventory只复制公开材料选项并管理数量原文、不可编辑的来源单位和本次预览。完整解析数量，不使用parseFloat吞尾、静默取整或默认全部；count整数、g/ml小数、超量及容量沿既有正式预览校验。来源变化清空数量，改量/切页/其他命令/读档使旧预览失效；仍合法的普通拒绝输入保留供修改。

ProbeLifetime窄消费既有menu_preview/split_lot；ProbeInteraction显式区分preview、confirm和save/load，preview只认本次last_preview_result，不要求ActionResult；confirm仍经既有controller重预览，成功须本次双结果。新批次ID从本次created_objects关联刷新后的公开材料，数量/位置由公开结果取得，不从输入伪造。状态应用异常不自动重发Action；busy/销毁保护保持。

CocosWebProbe接真实cc.EditBox、单位/选择摘要、预览与确认Button；observer只读观察，不提供设置数量或派发业务捷径。既有拆分规则、Session/Queue、SaveFile、正式schema/config/fixture/expected、依赖版本与门禁算法保持。既有拆分不提供全量快捷按钮；既有加工页见trace.cocos.web-processing-loop，既有烹饪页见trace.cocos.web-cooking-loop，不扩Stage1B或wx。

tests/cocos-web-split.test.ts进入现有test.cocos-engine-probe-lifecycle的实际args/files/covers，test.cocos-web-verification-contracts校验拆分观察断言负例。trace.cocos.web-inventory-split连接这些行为及独立Creator SDK/构建、built-web和editor-preview各960×640真实点击与键盘输入；旧矩阵/resize/农事/转移/存读档/故障及销毁回归保留。桌面输入不代表触摸或微信通过，版本完成仍按q:full及无缓存q:release和精确候选CI。

## 加工页面与只读公开边界

CocosSelectableViewModel既有方法/任务选项，只复制配置和SaveFile现有字段；outer ProbeProcessing管理本地输入和本次反馈，不依赖私有状态。正式input_lots不增加role，核心匹配/数量/等待时间与任务状态机保持；菜单确认仍重预览。trace.cocos.web-processing-loop连接app、outer与独立真实验收，旧三层不接cc/wx/fs，该网页行为的cc仅在Web outer使用。

## 网页烹饪只读消费

CocosSelectableViewModel从既有recipe/structure及正式Action Schema投影角色约束、操作硬边界/偏好、配置设施工具说明与当前燃料；合并和候选匹配对齐现有CookingSystem，不成为新规则源。ProbeCooking只管理公开选项副本、本地数量/操作参数和本次回传，正式写入经已有MenuActionBinding.cook_dish与ActionPipeline。成功关联本次真实DishLot，失败、读档与改输入清旧预览，不重发Action。trace.cocos.web-cooking-loop连接；烹饪规则、Session/Queue和SaveFile保持，无燃料补给或菜品通用搬运。

## 订单提交与截止事务边界

available与accepted在当前分钟不超过deadline时可按现有需求规则提交。DemandResolver先验证状态和时限，再做既有菜品匹配；通过后仅在同步事务内部进入submitted，既有消费、储存审计、金钱/声望结算后completed。重复提交与submitted/completed/failed/expired/cancelled均拒绝，失败不得消耗菜品、增加奖励或改订单/事件；旧failed不迁移或重开。

GameRuntime既有advance_time截止settlement将available/accepted在now>deadline时转为expired，恰到截止仍保持开放。直接提交过期开放单复用ERR_ORDER_NOT_AVAILABLE，可带:deadline诊断，但保持提交前完整状态，不在拒绝路径偷偷结算。CocosSelectableViewModel只读order_options按同一合法状态和时限给enabled/reason，既有字段语义保持，新增展示字段见网页订单投影；enabled不是需求匹配保证。

trace.orders.legal-state-deadline连接DemandResolver、GameRuntime与CocosSelectableViewModel，以及test.stage1a-contract、test.action-preview、test.cocos-session和test.cocos-ui-readiness的现有full/blocker。核心、预览、Session受控合法加载与只读选项按层验收D-1/D/D+1、终态拒绝、需求失败完整保护、合法恢复、成功事件/奖励恰一次和新会话防重交。accepted及过期开放单可用合法受控存档验证；订单领域受控Node用例不冒充网页或真机实测；玩家页面另由trace.cocos.web-orders-loop及真实浏览器验证。不新增接单、刷新、聚合/部分交付、评分奖励或数量/时间/重复输入规则。

## 网页订单本次回执与状态写入边界

SelectableVM.order_options复制issuer_id、deadline_absolute_minute、signed minutes_until_deadline、正式需求的hard/weighted/defects/threshold、submitted refs和实际result_summary。订单名来自正式Profile文本，缺配置为null并不可用，嵌套数据全部独立副本。enabled只表示状态/时限及配置允许尝试，不保证所选菜品匹配；正/零截止余量和负余量来自当前绝对时间，不从day Label反算。StateVM及核心摘要保持。

ProbeOrders.ts/.meta只消费公共数据，管理第五页的显式单订单/单菜品本地选择和本次反馈，不改正式submitted_object_refs数组规则。终态可浏览、无菜品显示真实空态；浏览/选择0命令。preview只认本次校验，不伪造预计奖励；base_reward明确只是配置参考。确认沿既有menu→DraftBuilder→ActionPipeline，并以本次合法preview/ActionResult、实际Order.result_summary、所选菜品真实移除及公共金钱/声望变化关联成功，其他菜品保持。

确认前捕获order/dish与经济基线，避免成功patch先移除选择后误拒本次回执；错误或陈旧结果在ProbeInteraction发布completed前拒绝，应用失败不重发Action。改选择、切页、其他命令和load清旧预览/本次成功，历史结算另行展示；普通拒绝保留合法选择供修正，失效对象清除，不自动换菜品。busy/销毁迟到及本地单槽手动存读档保持。

tests/cocos-web-orders.test.ts实际进入既有lifecycle的args/files/covers，helper/.meta及测试同时登记prepare/lifecycle；readiness、menu与web-verification继续full/blocker。trace.cocos.web-orders-loop连接这些测试与源/地图，全部旧追踪保持。真实Creator/SDK和built/editor各960×640订单链、实际图检另行验收，保留原视口/resize、农事、库存拆分、加工、烹饪、存读档/故障与销毁。网页禁用重交只记0事件，正式状态/安全/低分拒绝由合法受控Node另验，不冒称微信或手机通过。

## 跨步骤手动恢复的验证边界

trace.cocos.cross-step-recovery补齐五保存点的公共bootstrap和浏览器续玩验证；生产Session仍先读取并校验candidate，成功才替换健康状态，SaveManager仍仅保存SaveFile并在加载时清领域事件。既有ID高水位恢复、Host/Queue机制保持，outer布局和只读诊断见触摸与小屏章节，不新增公开API、自动存档、迁移、多槽或跨标签仲裁。真实Creator/SDK与built/editor输入证据独立记录。

## 触摸与小屏外层边界

ProbeLayout只根据CSS frame生成只读节点矩形；CocosWebProbe在既有outer中应用布局、原生ScrollView/Mask及resize清理。选择、数量和正式命令仍沿既有公共玩家入口，不把滚动或触摸事件变为新业务事务。窗口变化保持Host/observer/Button身份，销毁移除订阅；trace.cocos.touch-small-screen连接纯几何/工具负例和独立引擎验收。

## 独立微信M1外层

独立apps/cocos-wechat-probe模块只消费派生公共runtime与正式资源，可使用cc，禁止直接wx/fs、业务内部、工具和测试依赖；旧三层不得反向依赖它。微信outer通过Creator平台存储外层提供手动单槽存读档及备份恢复，不增加自动保存或离线补时。不进入 Stage 1B，不改变 ActionPipeline，不改变 SaveFile，不改变正式 fixture；planned Stage1B wx-storage-port不转active。

prepare固定web/wechat内部profile，共享tools/cocos-probe/lib/prepareProject.mjs，保留旧Web prepareCocosProbe/readProbeResources签名、默认格式、角色与CLI。两条链均继承绝对空目录/路径隔离/symlink、正式58Schema、实际源与依赖摘要、公共bootstrap preflight、来源重读和排他写入。微信candidate_id由唯一生产者在冻结outputs前生成，来自当前生成资源assets/resources/candidate-identity.json；不取自SaveFile。每个新构建要求新候选和新空目录，已有构建或失败不静默复用身份；相同version/commit的候选仍可区分。最终产物摘要只在包外保存，明确目录树/ZIP/二维码范围，不嵌回自身；本轮不上传或发码。

test:cocos-wechat-preparation / test.cocos-wechat-preparation实际执行tests/cocos-wechat-preparation.test.mjs；test:cocos-wechat-runtime / test.cocos-wechat-runtime实际执行tests/cocos-wechat-runtime.test.ts，均为full/blocker。trace.cocos.wechat-m1连接新outer、共享生产者、微信构建、候选身份、架构负例和质量登记。Node只能证明受控准备/行为契约；真实Creator3.8.8/SDK、官方微信工具场景/输入/日志/重载、受影响Web回归和最终提交CI各自验收。旧全部追踪、权威架构禁令和Web功能/来源检查保留，不以修改阈值、预期、CI或affected算法通过门禁。

决定见[ADR-0005](adr/ADR-0005-independent-wechat-m1-outer.md)，入口见[微信模块卡](module-cards/cocos-wechat-probe.md)。

## 微信正式Schema预编译边界

正式Schema构建期预编译最初用于微信M1的动态编译兼容：微信prepare使用当前锁定Ajv standalone，沿既有strict=false、allErrors=true、allowUnionTypes=true校验选项编译全部58项正式Schema，并生成安全ESM导出及明确ID映射。不改正式Schema或业务校验语义，不新增依赖，不猴补Function/eval或使用恒true替代校验器；其他AOT仍不在当前范围。

M2包体修复为微信预编译增加loopRequired=1，inlineRefs维持默认；M1历史生成未使用该选项。微信构建固定debug=false并验证其来源，微信engine模板仅裁减M2未用功能。Node/Web默认校验路径不变；受控Schema对比不替代真实Creator与微信测试。

RuntimeSchemaValidator支持显式PrecompiledSchemaValidatorSet：format为runtime-precompiled-schemas/v1，schemaSources在源侧按完整资源路径保留JSON.stringify(schema)原JSON绑定，validators按正式$id记录ValidateFunction。运行期将源JSON解析后与实际Schema作完整JSON语义规范化比较，仅允许Creator的对象键重排；字段集合、数组次序和全部嵌套值必须一致，不忽略未知字段、数组或数值变化，坏JSON和非JSON内容拒绝。原始Schema、预编译生成物和工具/产物的字节SHA来源仍严格，不因运行期对象键规范化而放宽。Stage1ABootstrapResources的可选precompiledValidators字段透明转交该集合。显式提供集合时不创建Ajv、不回退动态编译；完整路径/ID/内容不匹配、重复或无$id、无效/异步函数及非布尔结果均拒绝。未提供时Node/Web维持原Ajv路径。核心仍不接cc/wx/fs、工具或资源读取。

微信compileWechatSchemas位于tools/cocos-wechat-probe/lib/precompiledSchemas.mjs，在唯一prepare生产链冻结outputs前生成wechat-precompiled-validators.mjs、wechat-schema-precompile.json及wechat-runtime-entry.mjs。前两者记录安全schema_NNN导出/ID映射、完整Schema内容、编译器版本与选项、实际CommonJS编译器依赖闭包及生成摘要；Node编译器依赖通过Ajv入口的require.cache闭包记录，不能冒称由esbuild运行bundle的metafile捕获。facade显式注入precompiledValidators后再打包到assets/generated/probe-runtime.js，Cocos不直接导入额外standalone文件。核心的绑定检查不以自声明元数据证明函数可信；真实Ajv生成代码及工具/源/依赖字节由prepare和构建来源记录约束。

tests/runtime-precompiled-schema.test.ts进入现有test:stage1a-bootstrap / registry test.stage1a-bootstrap实际args/files/covers，沿用full/blocker，不新增任务或降低门禁。该测试覆盖禁用动态Function后的正式启动/合法动作及坏请求、集合/内容拒绝；微信preparation契约覆盖实际facade、全部Schema、来源与生成物篡改，资源预检标记为node-aot-public-bootstrap-passed。Web旧resourcePreflight和默认动态路径保持。Node不替代新提交的Creator/SDK、微信真实输入/日志/重载、Web回归或审查/CI。

## 微信目标的局部DTO复制绑定

WechatDataClone.ts提供微信目标内的纯DTO复制适配，导出structuredClone供wechat profile的esbuild inject局部绑定runtime中的标准自由标识符。不修改globalThis或Cocos引擎，不在src中新增指向apps的源import，也不改变默认Node/Web路径；它不是通用Web API polyfill。支持数组、普通对象/空原型DTO输入及原始值，保留undefined、数组空位、共享引用/别名、循环和特殊属性键；非DTO对象、函数、Symbol与options（包括transfer）明确DataCloneError拒绝，不用JSON往返静默丢失数据。

源位于apps/cocos-wechat-probe/runtime/WechatDataClone.ts，仍由新outer已有module roots和authoritative .ts规则扫描；无cc/wx/fs依赖。helper经prepare实际onLoad进入manifest.inputs，并由sourceProvenance要求存在，源与依赖/生成物字节校验不放宽。微信facade受控预检同时禁用动态Function并移除原生structuredClone，正式启动/动作/坏请求仍须经过公共运行时；这不能替代最终候选的Creator/微信真实输入或手机验收。

## M2微信存储与生命周期

M2运行时改动集中于独立微信outer，并同步构建来源、测试和文档：手动单逻辑槽经Creator sys.localStorage接入平台存储，保存与读取沿既有Session/SaveManager及校验；前后台事件只限制输入与维护会话，不自动存档或补算时间。旧三层及outer直接wx/fs禁令保持，正式SaveFile和玩法不变。

备份与中断保护须同时考虑失败前后可能发生写入：备份、主档与恢复信息分开；读取、恢复和失败路径以源码及针对性测试为准，不能将异常等同于未落盘。故障保护依赖存储键相互独立和可读回一致的有限模型，真实微信断电、设备故障及底层原子性未证明。备份恢复不等于跨平台导入或自动存档。

tests/cocos-wechat-storage.test.ts登记进既有test:cocos-wechat-runtime的args/files，相关源及meta也进入preparation/runtime登记和trace.cocos.wechat-m1。受控Node契约不替代真实Creator、官方微信工具输入/存储/生命周期、最终提交CI或手机验收；具体结果以仓库外证据为准。
