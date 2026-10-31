---
doc_type: module_card
status: active
applies_to: cocos-web-probe
source_of_truth: false
---

# cocos-engine-probe

## 模块职责

apps/cocos-probe/保存Creator3.8.8真实Web探针源模板和外层生命周期桥接。只有该outer可使用cc；旧game-core、cocos-app、cocos-creator-adapter保持engine-neutral。当前目标是本页固定临时单槽的三按钮交互、失败后继续操作及准确反馈，继承约定桌面视口/resize输入范围，不新增玩法或正式Action。

工程从唯一src/design_snapshot派生runtime、snapshot及全部58项Schema；工作副本、依赖、缓存、报告和构建均在仓库外，禁止手改副本成为第二源码权威。script.loose=false保留标准JavaScript语义，不能恢复Creator默认loose破坏Ajv继承getter的已知转换。

## 允许依赖

- cc引擎类型与节点API。
- 派生公共probe-runtime.js：createStage1AHost、QinglanUiSceneProbeComponent、InMemorySaveStoragePort。
- 派生正式资源与project-target派生BuildId；不散落第二版本权威。

## 禁止依赖

不直接导入核心内部、tools、tests或dev/testing API，不接wx/fs，不直接改SaveFile或调用ActionPipeline。旧三层不得反向依赖此outer；浏览器验证工具不能成为游戏运行时依赖。

## 关键入口与读取顺序

- apps/cocos-probe/template/assets/scripts/CocosWebProbe.ts：真实cc组件、资源加载及Label/Button端口。
- apps/cocos-probe/template/assets/scripts/ProbeLifetime.ts：无cc的异步加载和销毁保护。
- apps/cocos-probe/template/assets/scripts/ProbeInteraction.ts：无cc的单次操作协调、busy和销毁后迟到反馈保护。
- apps/cocos-probe/template/build-templates/web-desktop/index.ejs、probe-viewport.css、probe-viewport.js：官方构建模板上的页面容器和视口同步；保留cocosTemplate注入，不能手改派生index.html。
- tools/cocos-probe/prepare.mjs：唯一来源派生仓库外工程。
- tools/cocos-probe/build.mjs：真实构建及Web逐文件/目录摘要。
- tools/cocos-probe/verify-web.mjs：verifyWebProbe(options)与独立真实浏览器CLI。
- tools/cocos-probe/lib/webProbeSupport.mjs：构建/验收共享的HTTP、参数、来源与Web摘要辅助。
- [边界契约](../module_contracts/CocosEngineProbe.contract.md)、[Cocos地图](../maps/cocos-map.md)、[运行地图](../maps/runtime-map.md)、[API索引](../code-index/public-api.md)。

## 修改后验证

test:cocos-probe-preparation实际prepare并验证资源、来源及生成runtime；test:cocos-engine-probe-lifecycle同时执行cocos-engine-probe-lifecycle.test.ts与cocos-web-interaction.test.ts，验证受控异步生命周期及交互恢复；test:cocos-web-verification-contracts验证参数、HTTP安全、来源与失败保护。三项登记full/blocker，trace.cocos.web-bootstrap-probe和trace.cocos.web-viewport-input分别保留启动与视口追踪。Node契约不执行真实浏览器。

根typecheck只覆盖src；真实Creator类型、构建、预览和浏览器独立验收。cocos:verify:web要求--project、--browser、--report-dir、--build-record均为显式绝对路径；可选--preview-url只接受loopback HTTP。实际浏览器或引擎缺失必须失败或未执行，不能静默skip。

真实鼠标点击按mode区分：built-web覆盖1440×1200、1280×720、960×640、800×600/DPR1与960×640/DPR2仿真，并执行960×640→1440×1200→800×600→960×640四次resize点击；editor-preview只覆盖1440×1200与960×640/DPR1，并执行960×640→1440×1200→960×640三次resize点击。每次完整canvas/Button可见、scroll稳定、会话身份不变、Button事件恰好一次、推进命令时间+60与Label同步；存读档命令按临时槽预期检查时间，所有断言保持。官方Default设备模拟器在800窗口会裁剪固定960px内容，该预览范围未支持；不将预览裁剪写成构建网页800失败。内存存读档和退出释放保留，built-web另验证资源404及加载中销毁。禁止调用observer.advance代替点击。预览URL模式独立标记，不把构建摘要当作livepreview页面字节证明。

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

## 临时存读档交互

AdvanceOneHour、SaveTemporary、LoadTemporary均为真实cc Button，固定槽web_probe，页面明确“本页临时存档，刷新后清空”。loading、busy、closing、destroyed不受理新操作；每次受理只执行一次既有组件命令，保存读取不推进。readonly observer的operation仅描述本次{name,status,message,errorMessage,slotId,worldMinute,sequence}，busy与displayedOperation用于观察，不提供存储捷径。预期failed展示为失败反馈，意外异常仍可观察；迟到结果不写失效节点。

trace.cocos.web-save-load-recovery连接最小Queue修复、外层辅助及Node/真实浏览器验收。每个支持视口验证空槽失败、继续推进成功、保存后推进及读取恢复，resize期间继续检验三按钮；刷新后槽清空。旧面板历史错误仍可观察，不能聚合它们重新判定当前命令。
