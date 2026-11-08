---
doc_type: module_card
status: active
applies_to: cocos-wechat-probe
source_of_truth: false
---

# cocos-wechat-probe

## 模块职责与读取入口

当前v0.0.3.0 M3候选保留微信加工，并按用户确认修订概率播种及拆分交互：种植位数与每位粒数分开，1至3粒对应80%/96%/99.2%成苗率，失败可补种；拆分用实时说明和直接确认。加工预览可选，直接确认使用独立正式校验；候选依赖PR25、PR26、PR27和PR28，正式动作仍经公共Host/Binding/Queue与ActionPipeline。时间推进、手动存读档和前后台保护保留。真实Creator、微信工具和手机结果分别验收，本包不代表完整M3或M4完成。

独立apps/cocos-wechat-probe模块只消费派生公共runtime与正式资源，可使用cc，禁止直接wx/fs、业务内部、工具和测试依赖；旧三层不得反向依赖它。微信outer通过Creator平台存储外层提供手动单槽存读档及备份恢复，不增加自动保存或离线补时。不进入 Stage 1B，不改变 ActionPipeline，不改变正式 fixture；本次SaveFile内CropInstance的兼容成苗字段及派生Schema/config修订见SOURCE_DESIGN_PACK，旧作物不补抽。planned Stage1B wx-storage-port不转active。

- `apps/cocos-wechat-probe/template/assets/scripts/CocosWechatProbe.ts`：真实cc场景、资源加载、Label/Button与只读观察，提供概率播种、库存选择、拆分数量实时说明和直接确认。
- 主存档读取返回空槽时，微信界面提示“未找到主存档；无备份时可先保存”，不将空槽记为命令成功；单独存在备份时仍保留备份保护。只有精确的主槽空档错误按提示记录，读取/坏档/备份恢复等失败仍按错误处理。微信storage读取遇到平台异常伪装成同一个空槽错误时改报存储读取失败，防止误认空档。
- `apps/cocos-wechat-probe/template/assets/scripts/WechatProbeController.ts`：无cc的资源/身份校验、公共Host/Binding、busy与前后台、销毁迟到保护；通过正式菜单绑定提交播种、推进、收获、整批储存、直接拆分及手动存读档命令，并协调备份恢复和首档撤销。拆分预览API仅作兼容保留，页面不展示独立预览按钮。
- `apps/cocos-wechat-probe/template/assets/scripts/WechatPriorSaveValidator.ts`：在隔离的公开Host会话中校验现有存档，拒绝写入平台存储，验证结束销毁临时Host；用于备份和恢复前置检查。
- `tools/cocos-probe/lib/prepareProject.mjs`：固定共享生产者，不开放任意template/runtime入口/BuildId角色。
- `tools/cocos-wechat-probe/prepare.mjs`：prepareWechatProbe({rootDir?, outputDir, appId})，固定wechat profile。
- `tools/cocos-wechat-probe/build.mjs`：buildWechatProbe({creator, project, logDir})，独立微信记录；rootDir仅受控fixture入口，CLI不能选择。
- `tools/cocos-wechat-probe/lib/source.mjs`和`tools/cocos-wechat-probe/lib/sourceProvenance.mjs`：准备/构建关联、实际Git输入与依赖、工具字节及微信产物树摘要。

## 来源、身份与外部配置

prepare固定web/wechat内部profile，共享tools/cocos-probe/lib/prepareProject.mjs，保留旧Web prepareCocosProbe/readProbeResources签名、默认格式、角色与CLI。两条链均继承绝对空目录/路径隔离/symlink、正式58Schema、实际源与依赖摘要、公共bootstrap preflight、来源重读和排他写入。微信candidate_id由唯一生产者在冻结outputs前生成，来自当前生成资源assets/resources/candidate-identity.json；不取自SaveFile。每个新构建要求新候选和新空目录，已有构建或失败不静默复用身份；相同version/commit的候选仍可区分。最终产物摘要只在包外保存，明确目录树/ZIP/二维码范围，不嵌回自身；本轮不上传或发码。

AppID由明确本地参数提供，派生工程和开发者工具配置位于仓库外；不把账号凭据或AppID硬编码到源模板。微信BuildId沿project-target的snakeVersion经deriveBuildId('cocos_wechat_probe', ...)派生；candidate_id另行生成，不改变原版本/BuildId与存档语义。固定候选要求完整commit及dirty=false；开发dirty来源须明确记录，不能称固定候选。

## 修改后验证

test:cocos-wechat-preparation / test.cocos-wechat-preparation实际执行tests/cocos-wechat-preparation.test.mjs；test:cocos-wechat-runtime / test.cocos-wechat-runtime实际执行tests/cocos-wechat-runtime.test.ts，均为full/blocker。trace.cocos.wechat-m1连接新outer、共享生产者、微信构建、候选身份、架构负例和质量登记。Node只能证明受控准备/行为契约；真实Creator3.8.8/SDK、官方微信工具场景/输入/日志/重载、受影响Web回归和最终提交CI各自验收。旧全部追踪、权威架构禁令和Web功能/来源检查保留，不以修改阈值、预期、CI或affected算法通过门禁。

版本完成仍按q:full和无缓存q:release，真实平台结果写包外报告。运行工具只读observer不得提供执行命令替代真实Button输入。相同候选重载后仍须核运行身份；M1内存新局重载不承诺恢复进度，不用它冒充M2平台读档。

## 地图同步

维护module-graph、authoritative import/token边界、test-registry、traceability-map、cocos/runtime/quality地图和files/public-api。旧Web与旧三层禁令保留，不扩大白名单。决定见[ADR-0005](../adr/ADR-0005-independent-wechat-m1-outer.md)。

## 微信Schema预编译

正式Schema构建期预编译最初用于微信M1的动态编译兼容：微信prepare使用当前锁定Ajv standalone，沿既有strict=false、allErrors=true、allowUnionTypes=true校验选项编译全部58项正式Schema，并生成安全ESM导出及明确ID映射。不改正式Schema或业务校验语义，不新增依赖，不猴补Function/eval或使用恒true替代校验器；其他AOT仍不在当前范围。

M2包体修复在上述选项上增加loopRequired=1，inlineRefs保留默认值；此前M1生成未使用该选项。微信构建固定debug=false并在来源校验中拒绝其他值；微信engine模板裁去M2未用功能，保留2D、UI、Graphics、Animation和Tween及配置的WebGL后端。受控测试比较58项Schema的动态校验与两种standalone的结果和完整errors，不能替代真实构建或设备验证。

微信compileWechatSchemas位于tools/cocos-wechat-probe/lib/precompiledSchemas.mjs，在唯一prepare生产链冻结outputs前生成wechat-precompiled-validators.mjs、wechat-schema-precompile.json及wechat-runtime-entry.mjs。前两者记录安全schema_NNN导出/ID映射、完整Schema内容、编译器版本与选项、实际CommonJS编译器依赖闭包及生成摘要；Node编译器依赖通过Ajv入口的require.cache闭包记录，不能冒称由esbuild运行bundle的metafile捕获。facade显式注入precompiledValidators后再打包到assets/generated/probe-runtime.js，Cocos不直接导入额外standalone文件。核心的绑定检查不以自声明元数据证明函数可信；真实Ajv生成代码及工具/源/依赖字节由prepare和构建来源记录约束。

tests/runtime-precompiled-schema.test.ts进入现有test:stage1a-bootstrap / registry test.stage1a-bootstrap实际args/files/covers，沿用full/blocker，不新增任务或降低门禁。该测试覆盖禁用动态Function后的正式启动/合法动作及坏请求、集合/内容拒绝；微信preparation契约覆盖实际facade、全部Schema、来源与生成物篡改，资源预检标记为node-aot-public-bootstrap-passed。Web旧resourcePreflight和默认动态路径保持。Node不替代新提交的Creator/SDK、微信真实输入/日志/重载、Web回归或审查/CI。

运行期资源绑定仅容许Creator JsonAsset对对象键作无语义重排：源侧schemaSources仍保留完整原JSON，原始Schema/生成物及工具/产物字节SHA保持严格；运行期解析后递归排序对象键并比较完整JSON内容。字段集合、数组次序与全部值必须一致，未知字段不忽略；坏JSON、非JSON或任何内容差异均拒绝，不回退动态编译。

## 微信目标DTO复制

WechatDataClone.ts提供微信目标内的纯DTO复制适配，导出structuredClone供wechat profile的esbuild inject局部绑定runtime中的标准自由标识符。不修改globalThis或Cocos引擎，不在src中新增指向apps的源import，也不改变默认Node/Web路径；它不是通用Web API polyfill。支持数组、普通对象/空原型DTO输入及原始值，保留undefined、数组空位、共享引用/别名、循环和特殊属性键；非DTO对象、函数、Symbol与options（包括transfer）明确DataCloneError拒绝，不用JSON往返静默丢失数据。

源位于apps/cocos-wechat-probe/runtime/WechatDataClone.ts，仍由新outer已有module roots和authoritative .ts规则扫描；无cc/wx/fs依赖。helper经prepare实际onLoad进入manifest.inputs，并由sourceProvenance要求存在，源与依赖/生成物字节校验不放宽。微信facade受控预检同时禁用动态Function并移除原生structuredClone，正式启动/动作/坏请求仍须经过公共运行时；这不能替代最终候选的Creator/微信真实输入或手机验收。

tests/cocos-wechat-data-clone.test.ts追加到原test:cocos-wechat-runtime / test.cocos-wechat-runtime实际args/files/covers，验证原生DTO复制对比与拒绝路径；helper和测试同步登记preparation files。原两项微信full/blocker任务保留，不新增任务、CI或算法；M2存储及生命周期由独立outer提供。M3种植与库存首包及后续拆分包继续沿用既有门禁；完整M3、M4和Stage1B尚未完成。

## M2微信存储与生命周期

M2候选建立微信存储及生命周期基础；M3种植与库存首包在此基础上推进，后续拆分和加工候选继续依赖该能力。

M2运行时改动集中于独立微信outer，并同步构建来源、测试和文档：手动单逻辑槽经Creator sys.localStorage接入平台存储，保存与读取沿既有Session/SaveManager及校验；前后台事件只限制输入与维护会话，不自动存档或补算时间。旧三层及outer直接wx/fs禁令保持，正式SaveFile和玩法不变。

备份与中断保护须同时考虑失败前后可能发生写入：备份、主档与事务标记使用独立物理key；旧主档经公开存档校验、备份及回读确认后才更新主档。标记存在时拒绝普通读写；显式备份恢复先经隔离Session校验，port内部再次校验并复核备份与标记字节，再将相同备份写回主档并核实后清标记，随后经Binding由玩家会话读取。标记清理抛错时当前实例锁定结果不确定；若清理先生效又抛错，重启后的提交结果无法仅凭标记判定。首次保存失败无旧档备份：识别到完整首存标记且无备份时，可经界面二次确认撤销未完成首档，保留当前会话；未知或损坏标记、无可用备份等部分状态无法通过此按钮恢复，应保留现场而非假称能恢复旧档。

受控测试中，备份准备/提升失败和Session读档校验失败保留原会话。Binding的UI补丁应用可能在Session提交后失败，这类错误不能一概称为原会话未改变；错误反馈与实际会话结果须分别观察，不因此重发正式操作。

故障保护依赖存储键相互独立和可读回一致的有限模型，真实微信断电、设备故障及底层原子性未证明，不能将异常等同于未落盘，也不能承诺任意中断的原子提交。备份恢复不等于跨平台导入或自动存档。

tests/cocos-wechat-storage.test.ts登记进既有test:cocos-wechat-runtime的args/files，相关源及meta也进入preparation/runtime登记和trace.cocos.wechat-m1。受控Node契约不替代真实Creator、官方微信工具输入/存储/生命周期、最终提交CI或手机验收；具体结果以仓库外证据为准。

## M3微信库存拆分包

M3微信库存拆分支持可选预览；玩家可直接确认当前批次和数量。共享队列以menu_confirm_split_direct调用独立只读校验，通过后才同步提交正式split_lot，校验与执行共用正式数量、预留、定义及容量规则，不依赖preview。切换材料、数量或会话使旧预览失效，预览不成为确认的前置条件；提交后异常或无法核实回执提示结果待确认，不自动重试。原Web菜单确认仍先预览。M2存读档与M3种植库存能力继续保留；不修改SaveFile、正式Schema、配置或玩法规则。PR25、PR26、PR27依赖须随候选核对，本包不包含M3完整经营、M4或Stage1B。

针对性覆盖进入既有test.cocos-wechat-runtime与preparation登记；q:full、无缓存q:release、Creator、微信工具、浏览器回归和对应提交CI各自验证，测试登记不代表已通过。

## M3微信加工包

微信加工页面读取公开方法、必需材料、兼容设施和任务；支持数量输入、可选预览、直接开工、推进时间和领取。正式结果从本次ActionResult与公开快照核对，预计产物只作预计；异常或结果不确定提示核实，不自动重试。继续保护已有存读档、切页和前后台；本包依赖PR25、PR26、PR27、PR28，完整M3和M4未完成。

## 加工分步与结果核对

方法、材料要求、批次、数量、设施、汇总与任务使用明确步骤及分页；直接开工和可选预览保持。开工明确拒绝保留可编辑草稿，失效或不确定结果隔离已提交草稿并锁定开工，须只读刷新当前会话并查看任务和库存，再由玩家重新选择材料；领取不确定锁定当前任务，重新核对使用refreshProcessingView刷新当前Session公开数据，不读写存档或自动重发。刷新失败、缺任务、状态矛盾和后台过期结果保持锁，成功核对依一致的最新状态等待玩家操作。此锁仅属于当前界面实例，不表述为跨重启持久性。

## 农事数量与拆分简化

field_options透传capacity_tiles/available_tiles；页面明确种植位数、每位1至3粒、总耗种与每位成苗率，出苗失败后显示可补种空位。正式批量播种仍经公共Queue及ActionPipeline，超量不截断或偷偷改数量，未揭晓随机结果不显示。拆分页面移除独立预览按钮，输入实时展示拆出与剩余，直接确认继续使用Session独立校验；后台、回执不确定或提交后异常不得重发旧输入，通过显式只读核对当前库存后重新输入。Controller可选预览API保留兼容，不作为页面前提。trace.farming.seed-quantity和既有微信追踪覆盖这些路径，Node结果不代替真实设备输入。

通用menu_confirm只接受当前命令和动作对应的预览/正式回执，Controller实例内记住已观察请求ID以拒绝重复回执；普通load不重建dispatcher，记录不清空。新Controller创建新集合。完成次数不因旧回执增加，不自动重发；此保护不承诺跨控制器去重。
