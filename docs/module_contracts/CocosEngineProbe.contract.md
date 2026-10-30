---
doc_type: module_contract
status: active
applies_to: cocos-web-probe
source_of_truth: false
---

# Module Contract：CocosEngineProbe

导航主入口为[引擎探针模块卡](../module-cards/cocos-engine-probe.md)。本契约说明真实外层边界，不替代正式配置、Schema或代码。

## 来源与工程准备

`apps/cocos-probe/`只保存最小工程源模板。`tools/cocos-probe/prepare.mjs`导出prepareCocosProbe({rootDir, outputDir})与readProbeResources(rootDir)，CLI要求--output为仓库外的绝对空目录；禁止覆盖非空目录、仓库内/祖先位置或符号链接目标。

准备工具读取唯一src/design_snapshot，生成assets/generated/probe-runtime.js及assets/resources/probe-resources.json。资源集合包含snapshot、schemas和project-target派生buildId，声明Schema必须完整对应全部58项，缺失、损坏或引用无效必须失败。工具在写入工程前用生成bundle的公共bootstrap做Node资源就绪预检，这不等于引擎通过。

probe-source-manifest.json记录sourceCommit/sourceDirty、版本与BuildId、Creator版本、输入/产物bytes和SHA-256。正式验收需固定候选提交并核对摘要；派生副本不能成为手改源，不凭元数据字符串承诺正式资源来源真实。

源模板的settings/v2/packages/project.json必须保留script.loose=false。真实Creator3.8.8浏览器探针已复现默认loose转译破坏Ajv的super.names继承getter接收者，导致有效资源启动失败；标准模式用于保留正确JavaScript语义，不改变正式资源、核心逻辑或改用AOT。准备契约检查实际派生配置，不能省略该设置或恢复默认值。配置断言仅防止已复现回归，修复后的真实引擎结果仍须独立构建与浏览器验收。

## 运行与生命周期

真实cc组件只负责资源加载、节点显示及按钮事件。运行对象经createStage1AHost建立，使用QinglanUiSceneProbeComponent和节点端口提交既有正式Action，不直接访问内部状态。Host已ready，不再调用旧SessionProbe.onLoad创建同一会话。

加载期间销毁必须使迟到结果失效：不发布Host、不写无效Node；已创建会话须释放。不得假设引擎自动等待异步销毁。绑定失败/命令失败保持原公开边界，恢复不能重放Action或回滚已提交业务。当前只做Web与内存端口冒烟，不提供真实持久化或微信保证。

真实onDestroy必须同步捕获清理所需的asset和lifetime引用，诊断observer也须保留独立lifetime引用。Creator可能在回调返回后清空Component字段，异步释放和销毁后诊断不得再依赖这些字段；asset须按已持有的引用释放，会话与迟到加载仍按既有销毁保护收口。

## 架构边界

旧三层保持不接真实Cocos/wx/fs，新outer才可导入cc；只消费派生公共runtime，不直接依赖核心内部、tools、tests、dev/testing API。旧层禁止反向依赖apps/cocos-probe。新增归属与禁令不是删除旧检查或增加历史白名单的理由。

## 验收与限制

自动任务test.cocos-probe-preparation及test.cocos-engine-probe-lifecycle登记full/blocker，验证真实准备产物、异常资源、来源清单和受控生命周期。根typecheck仅检查src，Ubuntu q:full不包含Creator安装或真实构建。

真实Creator3.8.8预览与Web构建使用独立入口cocos:build，显式提供--creator、--project、--log-dir。记录精确版本、候选commit/dirty、派生摘要、构建日志及真实节点动作/退出；CLI成功码36且产物有效才映射工具成功。缺引擎应明确失败或未执行，不能静默skip或把Node模拟当作实际引擎验证。

当前Web桌面运行页默认1280×960，应使用足够的桌面窗口验证按钮与显示。小视口滚动、输入适配及移动端布局不在本版承诺范围内；这些限制不能通过只调用诊断observer绕过真实按钮验收。

不改变ActionPipeline、SaveFile、正式schema/config/fixture，不新增玩法，不进入Stage1B，不接wx，不做AOT迁移。若真实探针证明需要广泛核心兼容改造，应重新界定范围，不静默扩大任务。
