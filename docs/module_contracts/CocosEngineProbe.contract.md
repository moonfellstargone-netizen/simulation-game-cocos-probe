---
doc_type: module_contract
status: active
applies_to: cocos-web-probe
source_of_truth: false
---

# Module Contract：CocosEngineProbe

导航主入口为[引擎探针模块卡](../module-cards/cocos-engine-probe.md)。本契约描述外层行为和验收限制，不替代正式资源或源码。

## 来源与工程准备

apps/cocos-probe/仅保存最小工程源模板，tools/cocos-probe/prepare.mjs导出prepareCocosProbe({rootDir, outputDir})和readProbeResources(rootDir)。CLI --output要求仓库外绝对空目录，拒绝非空目录、仓库内/祖先位置和链接目标。

生成runtime与probe-resources.json包含唯一snapshot、完整58项声明Schema及project-target派生BuildId。缺失、损坏和引用无效必须失败；写工程前用真实bundle公共bootstrap做Node资源预检，不能称作引擎通过。probe-source-manifest.json保留sourceCommit/sourceDirty、Creator版本及输入/产物bytes/SHA-256；固定候选验收核对真实字节，不凭元数据字符串保证来源。

源模板settings/v2/packages/project.json必须保留script.loose=false，避免已证实的Creator3.8.8 loose转译改变Ajv super.names继承getter接收者。标准模式只保持JavaScript语义，不修改Schema/核心或迁移AOT。

## 桌面视口与输入

官方Web构建源模板保持cocosTemplate注入，约束页面容器在可见视口内并同步引擎所需像素尺寸和resize；修复源头，不能手改生成Web或SDK。原故障为小窗口canvas.focus触发页面滚动后mouseup偏离按钮，禁止屏蔽真实点击验收制造通过。

构建网页built-web覆盖1440×1200、1280×720、960×640、800×600/DPR1和960×640/DPR2仿真，同页960×640→1440×1200→800×600→960×640四次resize点击。编辑器预览editor-preview只覆盖1440×1200与960×640/DPR1，同页960×640→1440×1200→960×640三次resize点击。两个mode均要求完整canvas/Button可见、scroll稳定、会话身份不变，每次真实鼠标点击恰好一次Button事件、既有advance_time增加60分钟、Label与公开ViewModel一致；窗口变化不重建Host或重复绑定事件，断言强度不变。官方Default设备模拟器固定960px内容在800窗口发生裁剪，该预览场景未支持，不将其诊断失败写成构建网页800失败。

DPR仿真不能推导手机、触摸、软键盘、安全区、微信或Windows系统缩放通过，未测平台不承诺。

## 运行与生命周期

真实cc组件只负责加载、节点与按钮，使用createStage1AHost和QinglanUiSceneProbeComponent公开命令。bootstrap返回已ready Host，不再调用旧Probe.onLoad创建同一会话。加载期间销毁不得发布迟到Host或更新失效Node。

Creator不await异步onDestroy，并可能清空Component字段；必须同步捕获asset/lifetime，observer独立保留lifetime，清理使用已持有引用。保留memoryRoundtrip、缺资源失败、加载中销毁与正常退出释放回归。内存端口冒烟不等于真实持久化或微信存储。

## 真实构建与浏览器证据

cocos:build显式要求--creator、--project、--log-dir；实际Creator3.8.8返回成功码36且Web产物有效才成功。成功result记录Web逐文件bytes/SHA-256与目录摘要。构建前仍逐项严格核对prepare清单；Creator允许且仅允许迁移engine.json，记录creatorNormalizations前后SHA及完整preparedSurfaceAfter。其他源变化必须失败，verify逐项核对精确构建后映像，不能将该迁移扩大为来源放行。

cocos:verify:web的verifyWebProbe(options)要求--project、--browser、--report-dir、--build-record，均为显式绝对路径。复算已构建Web并与记录匹配，缺摘要/篡改/替换必须失败；记录来源提交、dirty、构建关联、实际浏览器和真实点击结果，报告不写入仓库。可选--preview-url限loopback HTTP，预览结果独立标记；构建摘要不证明livepreview页面字节。

不得用observer.advance代替鼠标点击，不捕获错误后仍报告passed；缺引擎、浏览器、来源或产物应明确失败，不静默skip。正常运行控制台和pageerror无错误；缺资源案例允许明确记录预期404，但不能混成正常运行错误。

## 自动门禁与边界

test.cocos-probe-preparation、test.cocos-engine-probe-lifecycle、test.cocos-web-verification-contracts登记full/blocker；最后一项仅验证工具HTTP/参数/来源/失败契约，Node契约不执行真实浏览器。根typecheck只检查src，Ubuntu q:full不安装Creator或启动真实浏览器。实际Creator SDK类型、构建、预览与Chrome矩阵独立验收，q:affected不替代q:full/q:release，release禁止缓存。

旧三层禁真实Cocos/wx/fs；仅新outer可导入cc，且单向消费派生公共runtime，不能依赖tools/tests或核心内部。保持ActionPipeline、SaveFile和正式schema/config/fixture，不新增玩法或Stage1B、真实存储、wx、Nightly/CI平台或通用UI框架。
