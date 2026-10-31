---
doc_type: module_card
status: active
applies_to: cocos-web-probe
source_of_truth: false
---

# cocos-engine-probe

## 模块职责

apps/cocos-probe/保存Creator3.8.8真实Web探针源模板和外层生命周期桥接。只有该outer可使用cc；旧game-core、cocos-app、cocos-creator-adapter保持engine-neutral。当前目标是连接既有Stage1A播种、时间推进和收获，准确反馈本次业务结果并重建读档后的有效选择；继承本地单槽、约定桌面视口/resize和失败保护，不新增玩法或正式Action。

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
- tools/cocos-probe/prepare.mjs：唯一来源派生仓库外工程。
- tools/cocos-probe/build.mjs：真实构建及Web逐文件/目录摘要。
- tools/cocos-probe/verify-web.mjs：verifyWebProbe(options)与独立真实浏览器CLI。
- tools/cocos-probe/lib/webProbeSupport.mjs：构建/验收共享的HTTP、参数、来源与Web摘要辅助。
- [边界契约](../module_contracts/CocosEngineProbe.contract.md)、[Cocos地图](../maps/cocos-map.md)、[运行地图](../maps/runtime-map.md)、[API索引](../code-index/public-api.md)。

## 修改后验证

test:cocos-probe-preparation实际prepare并验证资源、来源及生成runtime；test:cocos-engine-probe-lifecycle同时执行cocos-engine-probe-lifecycle.test.ts、cocos-web-interaction.test.ts、cocos-browser-storage.test.ts与cocos-web-farming.test.ts，验证受控异步生命周期、交互恢复与公开农事行为；test:cocos-web-verification-contracts执行既有工具契约及cocos-web-serve-contracts.test.mjs，验证参数、HTTP安全、来源、固定端口与失败保护。三项登记full/blocker，trace.cocos.web-bootstrap-probe和trace.cocos.web-viewport-input分别保留启动与视口追踪。Node契约不执行真实浏览器。

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
