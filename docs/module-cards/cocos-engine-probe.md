---
doc_type: module_card
status: active
applies_to: cocos-web-probe
source_of_truth: false
---

# cocos-engine-probe

## 模块职责

`apps/cocos-probe/`保存Creator3.8.8真实Web探针的最小工程源模板及外层生命周期桥接。只有这一外层使用`cc`；既有game-core、cocos-app、cocos-creator-adapter保持engine-neutral。

工程从仓库唯一`src`和`design_snapshot`派生公共runtime及全部58个声明Schema；可打开工作副本、依赖、缓存与构建产物位于仓库外，禁止手改副本建立第二套实现。

模板settings/v2/packages/project.json的script.loose=false不可省略。真实浏览器已复现Creator默认loose转译使Ajv继承getter丢失正确接收者；标准模式保持JavaScript语义，不涉及核心或正式资源变更。准备测试锁定实际派生配置，修复后的引擎结果仍以独立Creator构建和浏览器验收为准。

## 允许依赖

- `cc`引擎类型与节点API。
- 由公开入口派生的`probe-runtime.js`：createStage1AHost、QinglanUiSceneProbeComponent、InMemorySaveStoragePort。
- 派生资源与明确启动参数；BuildId由project-target派生。

## 禁止依赖

不直接导入game-core/cocos-app/creator-adapter内部源码、tools、tests或dev/testing API；不接wx/fs，不直接改SaveFile或调用ActionPipeline。旧运行模块不得反向依赖该外层。

## 关键入口与读取顺序

- `apps/cocos-probe/template/assets/scripts/CocosWebProbe.ts`：真实cc组件、资源加载和界面端口。
- `apps/cocos-probe/template/assets/scripts/ProbeLifetime.ts`：纯TypeScript异步加载与销毁桥接。
- `apps/cocos-probe/template/assets/Probe.scene`及同级.meta：场景与稳定资源标识，属于源模板。
- `tools/cocos-probe/prepare.mjs`：生成仓库外空目录中的可打开工程。
- `tools/cocos-probe/build.mjs`：显式Creator路径、工程和日志目录的真实Web构建。
- [边界契约](../module_contracts/CocosEngineProbe.contract.md)：输入、迟到加载保护与验收限制。
- [Cocos地图](../maps/cocos-map.md)、[运行地图](../maps/runtime-map.md)及[公开API索引](../code-index/public-api.md)。

## 修改后验证

`test:cocos-probe-preparation`实际执行prepare，核对资源、来源摘要、坏资源和生成runtime的Node冒烟。`test:cocos-engine-probe-lifecycle`用受控异步信号验证加载/销毁，均为full/blocker；`trace.cocos.web-bootstrap-probe`连接执行登记与边界。

根typecheck只覆盖src，不证明外层Creator编译。真实Creator预览与Web构建独立验收；缺引擎时明确失败或未执行，不能用假cc类型、Node模拟或CI通过代替。版本完成仍运行q:full/q:release并核对对应提交PR检查。

真实onDestroy须同步捕获asset与lifetime引用，诊断observer须独立保留lifetime；异步释放和退出观测不能读取可能已被Creator清空的Component字段。当前Web桌面运行页默认1280×960，使用足够的桌面窗口做真实按钮验收；本版不承诺小视口滚动、输入适配或移动端布局。

## 常见失败模式

- 把加载完成后的迟到Host交给已销毁节点。
- 在异步清理或诊断中读取销毁后已被清空的Component字段。
- 对bootstrap已创建Host重复执行旧Probe.onLoad。
- 在源码checkout打开工程，混入library/temp/build/嵌套依赖。
- 无引擎时跳过实际验证，却宣称真实Cocos通过。
- 把内存端口冒烟写成微信或持久化保证。

## 代码—地图同步

同步module-graph、architecture边界、test-registry、traceability、cocos/runtime/quality地图、files/public-api及本模块卡。真实引擎证据不改变正式玩法权威。
