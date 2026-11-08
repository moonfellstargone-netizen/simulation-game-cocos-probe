# 模拟游戏 Cocos 微信试水代码项目 v0.0.3.0

**WeChat Stage1A Pilot / 微信真机Stage1A试水版**

本仓库是 Cocos 微信试水代码项目**日常代码权威源**。正式玩法与契约权威仍为正式三包 v1.5.2.2。

- 代码包版本：`v0.0.3.0`
- npm package version：`0.0.3-0`
- release 根目录：`模拟游戏_Cocos微信试水代码包_v0_0_3_0`（权威源：`tools/quality/rules/project-target.json`）
- 设计来源：`模拟游戏_正式开发总设定包_v1_5_2_2_practical_ready.zip`
- 规则权威源：`tools/quality/rules/project-target.json`、`tools/quality/rules/context-doc-surface.rules.json`、`tools/quality/rules/architecture-boundary.rules.json`、`tools/quality/rules/traceability-map.json`
- 代码权威：本 GitHub 仓库（非 zip 归档包）

## 入口文档

- [`docs/GITHUB_WORKFLOW.md`](docs/GITHUB_WORKFLOW.md)
- [`docs/PROJECT_MAP.md`](docs/PROJECT_MAP.md)
- [`docs/TRACEABILITY_MATRIX.md`](docs/TRACEABILITY_MATRIX.md)
- [`docs/DOCS_GOVERNANCE.md`](docs/DOCS_GOVERNANCE.md)
- [`docs/GLOSSARY.md`](docs/GLOSSARY.md)
- [`docs/CODE_CONTEXT_INDEX.md`](docs/CODE_CONTEXT_INDEX.md)

## Task Intent Lock

本轮唯一目标是v0.0.3.0的M3微信加工包：在M2及M3种植、库存与拆分候选基础上，接入加工方法、材料、设施、任务、开工与领取，并保留时间推进、手动存读档和前后台保护。加工预览可选，直接确认使用独立正式校验；候选依赖PR25、PR26、PR27和PR28的既有变更，正式动作仍经公共Host/Binding/Queue与ActionPipeline。真实Creator、官方微信工具和手机结果分别验收，不由Node契约推断；本包不代表M3完整经营或M4手机验收完成。

独立apps/cocos-wechat-probe模块只消费派生公共runtime与正式资源，可使用cc，禁止直接wx/fs、业务内部、工具和测试依赖；旧三层不得反向依赖它。微信outer通过Creator平台存储外层提供手动单槽存读档及备份恢复，不增加自动保存或离线补时。不进入 Stage 1B，不改变 ActionPipeline，不改变 SaveFile，不改变正式 fixture；planned Stage1B wx-storage-port不转active。

prepare固定web/wechat内部profile，共享tools/cocos-probe/lib/prepareProject.mjs，保留旧Web prepareCocosProbe/readProbeResources签名、默认格式、角色与CLI。两条链均继承绝对空目录/路径隔离/symlink、正式58Schema、实际源与依赖摘要、公共bootstrap preflight、来源重读和排他写入。微信candidate_id由唯一生产者在冻结outputs前生成，来自当前生成资源assets/resources/candidate-identity.json；不取自SaveFile。每个新构建要求新候选和新空目录，已有构建或失败不静默复用身份；相同version/commit的候选仍可区分。最终产物摘要只在包外保存，明确目录树/ZIP/二维码范围，不嵌回自身；本轮不上传或发码。

test:cocos-wechat-preparation / test.cocos-wechat-preparation实际执行tests/cocos-wechat-preparation.test.mjs；test:cocos-wechat-runtime / test.cocos-wechat-runtime实际执行tests/cocos-wechat-runtime.test.ts，均为full/blocker。trace.cocos.wechat-m1连接新outer、共享生产者、微信构建、候选身份、架构负例和质量登记。Node只能证明受控准备/行为契约；真实Creator3.8.8/SDK、官方微信工具场景/输入/日志/重载、受影响Web回归和最终提交CI各自验收。旧全部追踪、权威架构禁令和Web功能/来源检查保留，不以修改阈值、预期、CI或affected算法通过门禁。

### 既有Web交互范围（保留）

既有Web支持现有Stage1A五页在约定横屏逻辑视口下的电脑触摸与小屏操作准备：built-web覆盖800×360、844×390、960×432，另以844×250→390模拟可视区缩高恢复；compact以实际CSS frame布局，正文至少14CSSpx、按钮和EditBox命中高至少44CSSpx。仅在outer使用纯ProbeLayout、原生ScrollView/Mask、resize与视觉视口同步，选择/数量输入/确认/结果及手动存读档可达，按下或滑动取消不误提交、有效tap只发一次请求，切页重置滚动且resize保留会话和按钮身份。保留原桌面鼠标、全部五页经营、五点手动恢复及失败/销毁保护；core、Session/Queue、SaveFile、正式资源、数量/重复材料/时间/奖励规则与依赖保持。不新增通用UI框架、多点手势、横竖双套设计、自动存档、迁移、多槽、Stage1B或微信；电脑模拟不代表vivo X200s安全区、真实软键盘或微信触摸通过。

工具只读取仓库唯一src/design_snapshot派生的工作副本。prepare继续导出snapshot及全部58项Schema并记录Git来源/输入产物摘要；build记录实际Web产物清单摘要，verify核对构建关联和产物字节后才启动浏览器，拒绝替换或篡改的Web目录。工程、依赖、报告、缓存和构建仍位于仓库外，不形成第二源码权威。

保留准备/生命周期full/blocker回归，保留test:cocos-web-verification-contracts / registry test.cocos-web-verification-contracts验证浏览器工具的参数、来源、HTTP服务和断言失败保护；Node契约不执行真实浏览器。独立cocos:verify:web运行固定Creator构建产物的真实Chrome鼠标点击，记录Button事件、时间变化、Label同步与清理证据；根typecheck只覆盖src，不能代替实际Creator类型、构建或浏览器验收。

不进入 Stage 1B，不改变 ActionPipeline，不改变 SaveFile，不改变正式 fixture，不新增玩法、wx或通用UI框架；仅允许下述正式Schema构建期预编译兼容，其他AOT不在当前范围；不做自动续存档、多槽、云同步、导入导出、跨标签冲突治理或正式版本迁移。旧game-core、cocos-app、cocos-creator-adapter仍不接真实 Cocos、不接 wx或fs；现Web与独立微信两个outer使用cc，旧三层边界保持；微信M1不接wx/fs。

构建网页矩阵含800×600、DPR2及四次resize点击；编辑器预览只承诺1440×1200和960×640/DPR1及960→1440→960三次resize点击，官方Default设备模拟器800裁剪场景未支持。具体范围见外层契约，不推导手机或微信适配。

导航与追踪：本版trace.cocos.wechat-m1，保留trace.cocos.touch-small-screen，保留既有trace.cocos.cross-step-recovery、trace.cocos.web-orders-loop、trace.orders.legal-state-deadline、trace.cocos.web-cooking-loop、trace.cocos.web-processing-loop、trace.inventory.split-quantity、trace.runtime.id-recovery、trace.processing.required-inputs、trace.cocos.web-inventory-storage，以及trace.cocos.web-farming-loop、trace.cocos.browser-local-save、trace.cocos.web-save-load-recovery、trace.cocos.web-viewport-input和trace.cocos.web-bootstrap-probe。实际失败先定位，不通过降低架构检查、跳过门禁或调用observer.advance代替物理点击制造通过。

执行方使用Cursor时必须先做预检报告，用户或GPT确认后才可修改文件。复杂任务须先做Scope Discovery。

## q:affected 与 release 边界

微信Schema编译兼容只采用[ADR-0005](docs/adr/ADR-0005-independent-wechat-m1-outer.md)规定的构建期预编译：锁定Ajv standalone编译全部正式Schema，运行facade显式注入与资源内容绑定的同步校验集合。默认Node/Web路径保持，缺失或错配集合拒绝，不回退动态编译。公共接口与失败边界见[API索引](docs/code-index/public-api.md)，其他AOT仍不在当前范围。

`q:affected` 用于开发反馈，**不替代** `q:full`、`q:release`、`release:build` 或 `release:check`。release gate 禁止 cache。

详见 [`docs/CHECK_ARCHITECTURE.md`](docs/CHECK_ARCHITECTURE.md) 与 [`docs/GITHUB_WORKFLOW.md`](docs/GITHUB_WORKFLOW.md)。

## 常用命令

- `npm run cocos:prepare -- --output <仓库外空目录>`
- `npm run cocos:build -- --creator <Creator绝对路径> --project <派生工程绝对路径> --log-dir <仓库外日志目录>`
- `npm run cocos:verify:web -- --project <工程绝对路径> --browser <浏览器绝对路径> --report-dir <仓库外报告目录> --build-record <构建result.json绝对路径>`
- `npm run cocos:serve:web -- --project <工程绝对路径> --build-record <构建result.json绝对路径> --port <固定端口>`
- `npm run test:cocos-web-verification-contracts`
- `npm run test:cocos-probe-preparation`
- `npm run test:cocos-engine-probe-lifecycle`

- `npm run test:cocos-scene-binding`
- `npm run test:cocos-component-node-binding`
- `npm run test:stage1a-bootstrap`
- `npm run test:cocos-session`
- `npm run test:cocos-save-load`
- `npm run test:cocos-ui-command-queue`
- `npm run typecheck`
- `npm run test:ci-workflow-contracts`
- `npm run test:traceability-contracts`
- `npm run test:project-map-contracts`
- `npm run test:version-surface-contracts`
- `npm run quality:version`
- `npm run q:full`
- `npm run q:release`
- `npm run arch:check`
- `npm run release:build`
- `npm run release:check`

## PR 自动质量验证

入口为 [`.github/workflows/quality.yml`](.github/workflows/quality.yml)，单个 Ubuntu 24.04 job 使用 Node 24、Python 3.12，按 `npm ci` → `npm run q:full` 执行。PR 不按路径跳过检查；也提供 `workflow_dispatch` 手动入口。质量报告 `latest.json` / `latest.md` 在成功或失败时均尝试上传，保留 7 天。

CI 使用只读仓库权限、固定官方 Action 提交，不持久化 checkout 凭据。同一 PR 的新提交取消旧运行。工作流及测试登记由 `trace.quality.pr-ci` 追踪，操作和失败定位见 [`docs/GITHUB_WORKFLOW.md`](docs/GITHUB_WORKFLOW.md)。实际 GitHub 运行结果须查看对应 PR 的 Checks / Actions；工作流文件不代表分支保护已启用，也不替代发布门禁。

## 架构边界

启动入口为`src/cocos-creator-adapter/bootstrap/Stage1ABootstrap.ts`中的`createStage1AHost`。成功返回的Host已创建Session，可交给现有UI Shell/Queue或通过requireSession使用；结束时调用destroySession，不再执行Probe.onLoad二次创建。

模块导航主入口为[creator模块卡](docs/module-cards/cocos-creator-adapter.md)，真实引擎外层见[引擎探针模块卡](docs/module-cards/cocos-engine-probe.md)。

[装配边界契约](docs/module_contracts/Stage1ABootstrap.contract.md)保留为资源输入、失败保护及生命周期的边界说明，不替代模块卡导航。

`game-core 独立于 Cocos / wx / 表现层` 仍是核心红线。`cocos-creator-adapter` 当前仍是纯 TypeScript、engine-neutral 探针，不接真实 Cocos、不接 wx。

`docs/module_contracts/` 为遗留上下文治理契约，**保留**；新版项目地图主入口为 `docs/module-cards/`。

后续建议不是授权目标。

## 浏览器本地存档与固定来源

本地存档key为qinglan.simulation-game.cocos-probe.save.web_probe，不随package版本或BuildId改变。适配器只透传原始字符串，Storage getter/read/write在操作时惰性调用；权限拒绝、配额或读写异常沿既有失败反馈返回，不以临时内存冒充保存成功。读档仍由既有Session完成反序列化、Schema和StorageAudit校验，失败保持当前状态及原始存档；本版不承诺任意旧档迁移或未知版本必拒绝。

保存后刷新会先显示新局，点击“读取本地存档”才恢复。浏览器存储按协议、主机、端口及浏览器存储环境隔离；不同来源/浏览器不共享，数据也可能被用户清除。使用cocos:serve:web显式指定固定端口，并始终打开其输出的127.0.0.1地址；端口占用时失败，不自动换端口。不要使用file://，也不要混用localhost与127.0.0.1。该最小服务先核对固定构建来源与产物字节，开发期cocos:verify:web的随机端口/全新BrowserContext用于隔离自动验收，不能当作日常存档地址。

完整Creator类型/构建、真实Chrome点击和持久化证据仍须独立执行；Node契约或CI通过不能替代。同origin同context的刷新与新页面恢复、坏档/受控Storage故障和健康恢复均纳入真实浏览器验收；测试故障注入不等于真实权限或配额耗尽实测。验证工具不调用observer.memoryRoundtrip覆盖玩家存档。

## 网页农事操作与结果

从公开SelectableViewModel选择当前可用地块、种子批次和播种数量；数量始终携带所选批次的单位。界面显示地块占用、可收获项和材料批次实际数量，不用批次数代替收获数量。公开收获列表不含全部生长中的作物，因此不显示完整生长条或成熟倒计时。

ProbeFarming只管理外层选择与显示快照；挂载、动作完成及手动读取后重新核对选择，失效ID清除。ProbeInteraction保留busy/销毁保护，menu_confirm核对本次preview动作类型、preview/ActionResult的success与结果完整性；队列completed仅代表处理完成，业务拒绝、缺失或不匹配结果均不能显示成功。save/load只解释各自本次结果，不读取历史菜单成功摘要。

BrowserSaveStoragePort保留稳定单槽web_probe、同origin/profile手动恢复和启动不访问存储约束；失败保护与原始字符串透传不变。tests/cocos-web-farming.test.ts加入既有test:cocos-engine-probe-lifecycle实际执行集合，full/blocker及args/files/covers闭合。真实农事完整点击闭环在960×640的built-web和editor-preview分别验收；既有三按钮视口矩阵、存储故障、刷新/新页面及销毁回归继续执行，Node不替代真实Creator/Chrome证据。

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

## 网页加工开工至领取

加工页按公开方法要求逐项选批次并输入数量、选择兼容设施，先预览再开工。任务区区分加工中、可领取与已完成；正常时间推进后领取，实际产物按本次created_objects关联公开库存。方法缺料仍可浏览；配置最低量只是要求提示，缺料/不足由正式预览拒绝。未就绪和已完成任务可查看，领取按钮禁用；直接正式拒绝由Node测试覆盖。

加工中可手动保存，刷新或新页面创建新局后手动读取继续。改输入/选择、切页、其他命令或读档使旧预览失效；失败可修改继续，应用异常不自动重发。trace.cocos.web-processing-loop连接readiness、既有菜单、生命周期/准备与工具契约；Creator/SDK及built/editor各960×640真实点击、键盘输入和图检须独立验收，保留旧矩阵、resize及农事/库存/拆分/存读档/销毁回归。

## 网页烹饪选料与菜品反馈

第四页按公开配方角色逐项选批次和数量，使用真实EditBox填写数量与操作分钟，显式选择火候及储存目标。必需材料缺失、单位不符、操作参数或储存失败沿既有菜单/正式预览拒绝；失败清旧成功且不自动换料、重试或半扣料。成功只以本次created_objects中的DishLot关联刷新后的公开菜品，显示真实份数/位置及实际材料和燃料状态。

当前操作硬约束与结构偏好分开显示，不把测试high/8或配方time_cost_minutes作为默认操作参数，不增加世界时间或工具消耗。正常网页核对燃料扣减；燃料耗尽负例由受控合法Node状态覆盖，不能称普通网页耗尽实测，也不新增补给入口。ProbeCooking、readiness和行为/工具契约由trace.cocos.web-cooking-loop连接；真实Creator/SDK与built/editor各960×640鼠标键盘验收独立执行，旧回归保持，桌面不推定手机/微信通过。

## 订单合法状态与失败保护

available与accepted在当前分钟不超过deadline时可按现有需求规则提交。DemandResolver先验证状态和时限，再做既有菜品匹配；通过后仅在同步事务内部进入submitted，既有消费、储存审计、金钱/声望结算后completed。重复提交与submitted/completed/failed/expired/cancelled均拒绝，失败不得消耗菜品、增加奖励或改订单/事件；旧failed不迁移或重开。

GameRuntime既有advance_time截止settlement将available/accepted在now>deadline时转为expired，恰到截止仍保持开放。直接提交过期开放单复用ERR_ORDER_NOT_AVAILABLE，可带:deadline诊断，但保持提交前完整状态，不在拒绝路径偷偷结算。CocosSelectableViewModel只读order_options按同一合法状态和时限给enabled/reason，既有字段语义保持，新增展示字段见网页订单投影；enabled不是需求匹配保证。

trace.orders.legal-state-deadline连接DemandResolver、GameRuntime与CocosSelectableViewModel，以及test.stage1a-contract、test.action-preview、test.cocos-session和test.cocos-ui-readiness的现有full/blocker。核心、预览、Session受控合法加载与只读选项按层验收D-1/D/D+1、终态拒绝、需求失败完整保护、合法恢复、成功事件/奖励恰一次和新会话防重交。accepted及过期开放单可用合法受控存档验证；订单领域受控Node用例不冒充网页或真机实测；玩家页面另由trace.cocos.web-orders-loop及真实浏览器验证。不新增接单、刷新、聚合/部分交付、评分奖励或数量/时间/重复输入规则。

## 网页酒馆订单与结算反馈

SelectableVM.order_options复制issuer_id、deadline_absolute_minute、signed minutes_until_deadline、正式需求的hard/weighted/defects/threshold、submitted refs和实际result_summary。订单名来自正式Profile文本，缺配置为null并不可用，嵌套数据全部独立副本。enabled只表示状态/时限及配置允许尝试，不保证所选菜品匹配；正/零截止余量和负余量来自当前绝对时间，不从day Label反算。StateVM及核心摘要保持。

ProbeOrders.ts/.meta只消费公共数据，管理第五页的显式单订单/单菜品本地选择和本次反馈，不改正式submitted_object_refs数组规则。终态可浏览、无菜品显示真实空态；浏览/选择0命令。preview只认本次校验，不伪造预计奖励；base_reward明确只是配置参考。确认沿既有menu→DraftBuilder→ActionPipeline，并以本次合法preview/ActionResult、实际Order.result_summary、所选菜品真实移除及公共金钱/声望变化关联成功，其他菜品保持。

确认前捕获order/dish与经济基线，避免成功patch先移除选择后误拒本次回执；错误或陈旧结果在ProbeInteraction发布completed前拒绝，应用失败不重发Action。改选择、切页、其他命令和load清旧预览/本次成功，历史结算另行展示；普通拒绝保留合法选择供修正，失效对象清除，不自动换菜品。busy/销毁迟到及本地单槽手动存读档保持。

tests/cocos-web-orders.test.ts实际进入既有lifecycle的args/files/covers，helper/.meta及测试同时登记prepare/lifecycle；readiness、menu与web-verification继续full/blocker。trace.cocos.web-orders-loop连接这些测试与源/地图，全部旧追踪保持。真实Creator/SDK和built/editor各960×640订单链、实际图检另行验收，保留原视口/resize、农事、库存拆分、加工、烹饪、存读档/故障与销毁。网页禁用重交只记0事件，正式状态/安全/低分拒绝由合法受控Node另验，不冒称微信或手机通过。

## 跨步骤存读档恢复

trace.cocos.cross-step-recovery：五个独立保存点为生长中、加工中、可领取、菜品已成和订单完成，每点从正式资源新局经既有玩家入口自然达成，手动保存后由全新会话读取并实际继续。加工恢复后领取并再开工；完成订单恢复后保持不可重复领奖，并继续创建对象核既有存档对象/引用及新ID。测试者显式Save不表示自动保存。

`tests/stage1a-bootstrap.test.ts`沿公共bootstrap/Host和既有菜单/Queue验证集成；`tools/cocos-probe/verify-web.mjs`、`lib/webProbeSupport.mjs`及`tests/cocos-web-verification-contracts.test.mjs`连接独立recoveryLoop与断言负例。复用既有test.stage1a-bootstrap和test.cocos-web-verification-contracts实际args/files/covers及full/blocker，不新增任务；Session/save-load/Queue/lifecycle旧保护继续运行。

刷新及同context新页均手动读入原保存点后续玩；坏JSON/Schema/Audit、读写拒绝、busy和销毁迟到场景与健康链隔离，失败load保留健康完整状态。该恢复链沿既有Session/core及正式资源；当前outer触摸/布局调整另见下节，无自动恢复、多槽、迁移或跨标签仲裁。真实Creator/SDK、built/editor物理输入与对应截图须独立留证，Node契约不执行真实浏览器，不代表手机/微信通过。

## 触摸与小屏操作准备

trace.cocos.touch-small-screen连接ProbeLayout、真实组件/模板、Node负例与独立浏览器触摸场景。built-web约定800×360、844×390、960×432及844×250→390缩高恢复；原鼠标、经营和五点恢复链保留。完整范围见docs/module-cards/cocos-engine-probe.md和保留的CocosEngineProbe契约，电脑模拟不代表手机或微信通过。

## 微信DTO复制适配

WechatDataClone.ts提供微信目标内的纯DTO复制适配，导出structuredClone供wechat profile的esbuild inject局部绑定runtime中的标准自由标识符。不修改globalThis或Cocos引擎，不在src中新增指向apps的源import，也不改变默认Node/Web路径；它不是通用Web API polyfill。支持数组、普通对象/空原型DTO输入及原始值，保留undefined、数组空位、共享引用/别名、循环和特殊属性键；非DTO对象、函数、Symbol与options（包括transfer）明确DataCloneError拒绝，不用JSON往返静默丢失数据。

tests/cocos-wechat-data-clone.test.ts追加到原test:cocos-wechat-runtime / test.cocos-wechat-runtime实际args/files/covers，验证原生DTO复制对比与拒绝路径；helper和测试同步登记preparation files。原两项微信full/blocker任务保留，不新增任务、CI或算法；M2存储及生命周期由独立outer提供，M3种植库存首包已进入，完整M3、M4及Stage1B尚未完成。

详见[微信模块卡](docs/module-cards/cocos-wechat-probe.md)与[API索引](docs/code-index/public-api.md)。

## M2微信存储与生命周期

M2运行时改动集中于独立微信outer，并同步构建来源、测试和文档：手动单逻辑槽经Creator sys.localStorage接入平台存储，保存与读取沿既有Session/SaveManager及校验；前后台事件只限制输入与维护会话，不自动存档或补算时间。旧三层及outer直接wx/fs禁令保持，正式SaveFile和玩法不变。

备份与中断保护须同时考虑失败前后可能发生写入：备份、主档与恢复信息分开；读取、恢复和失败路径以源码及针对性测试为准，不能将异常等同于未落盘。故障保护依赖存储键相互独立和可读回一致的有限模型，真实微信断电、设备故障及底层原子性未证明。备份恢复不等于跨平台导入或自动存档。

tests/cocos-wechat-storage.test.ts登记进既有test:cocos-wechat-runtime的args/files，相关源及meta也进入preparation/runtime登记和trace.cocos.wechat-m1。受控Node契约不替代真实Creator、官方微信工具输入/存储/生命周期、最终提交CI或手机验收；具体结果以仓库外证据为准。

## 微信加工页面与结果核对

加工页面按方法、材料要求、批次、数量、设施、核对和任务分步组织；列表提供明确的分页、返回及选择/移除，玩家可直接开工，预览为可选。开工结果不确定时锁定旧选择，先只读刷新当前会话并查看任务和库存，再由玩家重新选择材料；领取结果不确定时锁定该任务并提供“重新核对”，该操作只刷新当前会话的公开状态，不读写存档或自动领取。锁定是当前界面实例内的保护，不代表跨关闭或重启持久化保证。
