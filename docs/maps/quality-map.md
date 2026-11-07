# Quality Map — v0.0.3.0

## 系统职责

质量门禁：typecheck、architecture boundary、affected/full/release、版本一致性、release surface、**轻量 traceability**，以及复用 q:full 的 PR 自动执行入口。

## 涉及模块

- `tools`（module-graph）
- `tests`（契约测试）

## 关键文件

- `.github/workflows/quality.yml`（tools：Ubuntu PR 检查与报告保留）
- `tools/quality/run-quality-gate.mjs`
- `tools/quality/module-graph.json`
- `tools/quality/test-registry.json`
- `tools/quality/gate-policy.json`
- `tools/quality/rules/project-target.json`
- `tools/quality/rules/traceability-map.json`
- `tools/quality/quality.config.json`（`rules.traceabilityMap`）
- `tools/quality/affected/*`
- `tools/quality/plugins/*`

## 关键测试

- `tests/cocos-probe-preparation.test.mjs`、`tests/cocos-engine-probe-lifecycle.test.ts`（新full/blocker，trace.cocos.web-bootstrap-probe）

- `tests/stage1a-bootstrap.test.ts`（registry `test.stage1a-bootstrap`：正式资源经公共入口的独立集成验收，追踪`trace.runtime.bootstrap-resources`）
- `tests/cocos-scene-binding-application.test.ts`、`tests/cocos-component-node-binding-application.test.ts`（现有full/blocker绑定任务，受控辅助`tests/support/controlledBindingPort.ts`，追踪`trace.cocos.binding-async-recovery`）
- `tests/quality-affected-contracts.test.mjs`（验证各绑定测试及辅助单独变化时真实任务选择，不改算法）
- `tests/ci-workflow-contracts.test.mjs`（registry `test.ci-workflow-contracts`，追踪 `trace.quality.pr-ci`）
- `tests/traceability-contracts.test.mjs`
- `tests/quality-gate-contracts.test.mjs`
- `tests/quality-affected-policy-hardening.test.mjs`
- `tests/version-surface-contracts.test.mjs`
- `tests/context-governance-contracts.test.mjs`
- `tests/cocos-runtime-session.test.ts`（registry `test.cocos-session`：Session/ViewModel/SaveStoragePort 边界，登记闭合进 `q:full`）
- `tests/cocos-save-load-ui-binding.test.ts`、`tests/cocos-ui-command-queue.test.ts`：与 Session 测试共同扩充存储故障保护及恢复用例，沿用既有 full/blocker 任务，追踪 `trace.save.storage-failure-recovery`。

## 修改前必读

- [`CHECK_ARCHITECTURE.md`](../CHECK_ARCHITECTURE.md)
- [`GITHUB_WORKFLOW.md`](../GITHUB_WORKFLOW.md)
- [`TRACEABILITY_MATRIX.md`](../TRACEABILITY_MATRIX.md)

## 修改后必跑

- `npm run q:full`
- 涉及 release 时 `npm run q:release`

## 常见风险

- 把 q:affected 写成 release 替代品
- 修改 gate 核心逻辑超出 Task Intent Lock
- traceability active/planned 语义混淆
- project-target 与 README 版本不一致
- 报告上传掩盖门禁失败、旧运行报告误作新提交通过证据
- 把 CI 文件存在误认为云端已通过或分支保护已启用
- 测试已登记但仅改测试或共享辅助时affected漏选；只断言返回snapshot而未验证端口实际内容

## 关联 module-cards

quality-tools, release-tools

新outer与prepare工具的归属、单向依赖、来源摘要和实际affected选择纳入自动契约；真实Creator预览/Web构建另行验收，不能让无引擎CI的q:full冒充引擎通过。

## 桌面Web视口与输入

`apps/cocos-probe/template/build-templates/web-desktop/`是页面容器/resize源模板；`tools/cocos-probe/build.mjs`记录产物摘要，`tools/cocos-probe/verify-web.mjs`与`tools/cocos-probe/lib/webProbeSupport.mjs`核对来源后运行真实鼠标矩阵。`tests/cocos-web-verification-contracts.test.mjs`登记full/blocker，仅验证Node工具边界，不能作为实际Creator或浏览器通过证据。

`trace.cocos.web-viewport-input`连接模板、工具、契约、affected与实际验收说明；支持范围见[引擎探针模块卡](../module-cards/cocos-engine-probe.md)。不能用observer.advance绕过物理点击；窗口变化保留原会话；浏览器本地存储仅由外层Port承担，不接微信。

## 浏览器本地存档与刷新恢复

trace.cocos.browser-local-save连接外层BrowserSaveStoragePort.ts、CocosWebProbe.ts、ProbeInteraction.ts及浏览器/固定来源工具；保留trace.cocos.web-save-load-recovery对既有Queue命令结果归属的追踪。既有三按钮AdvanceOneHour、SaveLocal、LoadLocal使用固定单槽web_probe和稳定项目key，启动不读写存储；同origin/profile刷新先创建新局，手动读取恢复保存状态。getter/读写拒绝和坏档保持当前会话，不回退内存。tests/cocos-browser-storage.test.ts与既有生命周期/交互回归由test.cocos-engine-probe-lifecycle实际执行，tests/cocos-web-serve-contracts.test.mjs由test.cocos-web-verification-contracts执行；files/covers、单文件affected及full/blocker闭合。ProbeInteraction保留本次反馈、busy和销毁后迟到保护；真实Creator/Chrome物理点击、刷新及同context新页面手动恢复独立验收，根typecheck只覆盖src，Node通过不能替代引擎或持久化证据。

## 网页农事验证登记

tests/cocos-web-farming.test.ts加入test.cocos-engine-probe-lifecycle实际执行集合；ProbeFarming.ts/.meta及测试登记files/covers，保持既有full/blocker和任务选择策略。trace.cocos.web-farming-loop连接Node的真实公开接口行为测试和独立Creator/Chrome农事物理点击；前者不能证明真实界面已通过。新增helper、测试与verify变更分别核对单文件affected，最终仍须q:full及无缓存q:release。

## 网页库存与正式整批转移

trace.cocos.web-inventory-storage连接MenuActionBinding.ts唯一最小store_item适配、outer ProbeInventory.ts/.meta、CocosWebProbe及公开结果反馈、tests/cocos-minimal-menu-binding.test.ts和tests/cocos-web-inventory.test.ts。库存辅助只复制公开批次/目标并管理本地选择，核心容量、形态、数量与Session/Queue规则保持。

库存行为测试加入既有test.cocos-engine-probe-lifecycle实际args/files/covers，菜单适配沿test.cocos-menu验证；prepare和工具契约继续full/blocker，新增helper/测试及唯一适配的单文件affected须闭合。真实库存点击至少独立960×640 built/editor验收，布局影响的农事、存读档/矩阵/resize和生命周期回归继续；Node不代替真实Creator/Chrome，未扩大门禁算法或平台范围。

## 网页加工验证登记

新增ProbeProcessing.ts/.meta及cocos-web-processing.test.ts登记既有准备/生命周期files，行为测试进入生命周期实际args与package脚本；readiness登记只读VM。trace.cocos.web-processing-loop连接这些full/blocker任务及既有menu和工具契约，不新增独立gate、不改策略/阈值。单文件affected核实际执行，Creator/SDK和built/editor真实输入独立验收，完整及出包仍按q:full和无缓存q:release。

## 网页烹饪验证登记

ProbeCooking.ts/.meta及cocos-web-cooking.test.ts登记既有准备/生命周期files，行为测试进入生命周期实际args与package脚本；readiness验证合并角色/操作说明/燃料只读投影。trace.cocos.web-cooking-loop连接这些full/blocker任务及既有menu、工具契约；新增测试/源单文件affected必须真正执行，不新建gate或改策略。受控Node燃料负例与自然网页扣减分清，Creator/SDK及built/editor真实数量/时长键盘和点击独立验收，旧全部回归保持。

## 订单保护验收登记

trace.orders.legal-state-deadline连接三源及test.stage1a-contract、test.action-preview、test.cocos-session、test.cocos-ui-readiness现有full/blocker，实际测试args/files保持。traceability与affected契约分别核追踪可达和单文件执行选择；quality.self-test虽非test.前缀仍是type=test，版本断言修改须纳入审计。门禁任务数、策略和架构阈值保持；真实Creator及既有网页全部回归独立执行，不把受控Node订单状态当网页提交。

## 网页订单验收登记

ProbeOrders.ts/.meta与cocos-web-orders.test.ts登记既有prepare/lifecycle，测试实际进入lifecycle args和package脚本；readiness/menu与web-verification沿原full/blocker。trace.cocos.web-orders-loop连接分层公开数据/outer/工具和真实Creator/built/editor验收，旧27条追踪与全部47任务保持。每个修改测试和主要源/.meta分别执行affected核真实覆盖，最终仍完整45与无缓存发布47，不把Node或DPR仿真当手机/微信。

## 触摸与小屏验证登记

tests/cocos-web-layout.test.ts进入既有test.cocos-engine-probe-lifecycle实际args/package脚本，ProbeLayout.ts/.meta及测试登记prepare/lifecycle files；工具断言负例沿既有web-verification。trace.cocos.touch-small-screen与affected/traceability契约闭合，47任务/full45/release47及全部旧回归保持。最终提交独立Creator/SDK、built/editor原生touch与逐图验收不由Node/CI推定。

## 微信M1质量登记

trace.cocos.wechat-m1新增test.cocos-wechat-preparation与test.cocos-wechat-runtime，实际args/files/covers登记，均full/blocker。preparation覆盖微信prepare/build/source/sourceProvenance及共享prepareProject、webProbeSupport与template；旧test.cocos-probe-preparation补共享helper。新outer import/wx-global及旧三层反向依赖为authoritative负例，旧Web禁令保留。Node不执行真实Creator或官方工具；q:affected不替代完整、无缓存发布及对应提交CI。

## Schema预编译质量覆盖

tests/runtime-precompiled-schema.test.ts进入现有test:stage1a-bootstrap / registry test.stage1a-bootstrap实际args/files/covers，沿用full/blocker，不新增任务或降低门禁。该测试覆盖禁用动态Function后的正式启动/合法动作及坏请求、集合/内容拒绝；微信preparation契约覆盖实际facade、全部Schema、来源与生成物篡改，资源预检标记为node-aot-public-bootstrap-passed。Web旧resourcePreflight和默认动态路径保持。Node不替代新提交的Creator/SDK、微信真实输入/日志/重载、Web回归或审查/CI。

trace.cocos.wechat-m1同时连接核心校验/公共bootstrap、编译器工具与既有bootstrap full/blocker任务；trace.runtime.bootstrap-resources保持现有资源装配权威，planned条目不变。

## 微信DTO复制覆盖

tests/cocos-wechat-data-clone.test.ts追加到原test:cocos-wechat-runtime / test.cocos-wechat-runtime实际args/files/covers，验证原生DTO复制对比与拒绝路径；helper和测试同步登记preparation files。原两项微信full/blocker任务保留，不新增任务、CI或算法；M2存储及生命周期由独立outer提供。M3种植与库存首包及后续拆分包继续沿用既有门禁；完整M3、M4和Stage1B尚未完成。

sourceProvenance及prepare真实输入记录helper，.ts架构扫描和旧三层不得反向依赖apps的规则保持；只在微信构建目标注入，不对全局作polyfill。

## M2微信存储与生命周期

M2运行时改动集中于独立微信outer，并同步构建来源、测试和文档：手动单逻辑槽经Creator sys.localStorage接入平台存储，保存与读取沿既有Session/SaveManager及校验；前后台事件只限制输入与维护会话，不自动存档或补算时间。旧三层及outer直接wx/fs禁令保持，正式SaveFile和玩法不变。

受控契约分别覆盖隔离Session验证、port复验与字节复核、持久提升及Binding读取；准备/提升失败和Session读取校验失败保留原会话。Binding的UI补丁可能在Session提交后才失败，这类错误不能一概归为原会话未改变，相关运行结果须分阶段核验。

备份与中断保护须同时考虑失败前后可能发生写入：备份、主档与恢复信息分开；读取、恢复和失败路径以源码及针对性测试为准，不能将异常等同于未落盘。故障保护依赖存储键相互独立和可读回一致的有限模型，真实微信断电、设备故障及底层原子性未证明。备份恢复不等于跨平台导入或自动存档。

tests/cocos-wechat-storage.test.ts登记进既有test:cocos-wechat-runtime的args/files，相关源及meta也进入preparation/runtime登记和trace.cocos.wechat-m1。受控Node契约不替代真实Creator、官方微信工具输入/存储/生命周期、最终提交CI或手机验收；具体结果以仓库外证据为准。

## 微信M2包体修复覆盖

tests/cocos-wechat-schema-optimization.test.mjs纳入既有test:cocos-wechat-runtime及test.cocos-wechat-runtime实际args、files和covers，相关编译与来源文件登记受影响范围，保留full/blocker和原测试。测试以受控样本比较58项Schema在动态、默认standalone与loopRequired=1生成器下的结果及完整errors，并覆盖来源参数拒绝。preparation继续覆盖debug=false和微信engine模板；这些Node测试不替代真实Creator、微信工具或设备验收。

## M3微信库存拆分

微信运行回归继续沿用test.cocos-wechat-runtime和test.cocos-wechat-preparation的full/blocker，拆分场景覆盖正式预览、确认、拒绝及旧预览失效；保留M2存储和M3种植库存回归。受控测试、Creator构建、微信工具输入、浏览器回归和对应提交CI分别验收，不以历史结果代替。


拆分独立校验覆盖现有test.stage1a-contract、test.cocos-session、test.cocos-ui-command-queue、test.cocos-scene-binding-application及test.cocos-wechat-runtime的正式执行、拒绝和回执行为；保留full/blocker与既有Web、其他仓储动作回归。实际结果以本轮执行及对应提交为准。
