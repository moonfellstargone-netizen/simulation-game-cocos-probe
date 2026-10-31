---
doc_type: module_contract
status: active
applies_to: cocos-probe
source_of_truth: false
---

# Module Contract：Stage1ABootstrap

## 模块路径与公开入口

- `src/cocos-creator-adapter/bootstrap/Stage1ABootstrap.ts`
- `Stage1ABootstrapResources`描述外部注入的`snapshot`、`schemas`、`storage`、`buildId`和`nowIso8601`。
- `createStage1AHost(input): CocosSessionHost`经bootstrap子目录及creator-adapter顶层入口导出。

模块导航主入口为[creator-adapter模块卡](../module-cards/cocos-creator-adapter.md)。本文件说明装配边界，不替代源码、正式配置或Schema权威。

## 职责与输入

外部宿主负责取得并解析正式运行快照及Schema对象；本入口只接收这些数据、`SaveStoragePort`和明确启动参数。快照的`schema_paths`必须为非空唯一列表，路径采用`schemas/...schema.json`的规范相对形式，不含反斜杠、空段或`.`/`..`路径段。

`schemas`按完整声明路径索引，必须与声明集合对应：缺少声明项或提供未声明项均拒绝。每项须为带非空`$id`的Schema对象，标识全局唯一且与资源文件名一致；所有声明Schema的引用闭包均须可编译，不能只验证新局恰好用到的部分。

`buildId`和`nowIso8601`由外部明确提供；前者须非空，后者须符合入口要求的ISO形式且可解析，不读取开发脚本、测试辅助或工具层派生版本。装配只接受当前Stage1A配置，不据此开放其他阶段。资源元数据字符串仅参与结构和装配检查，不足以证明资源来源真实，也不构成所有配置语义都已验证的保证。

## 装配与就绪边界

1. 核对输入资源与必要启动参数，使用现有`ConfigRepository`装配配置。
2. 使用`RuntimeSchemaValidator.assertSchemasAvailable(ids)`直接确认Schema可取得并编译引用闭包；不得通过校验假数据后忽略失败模拟成功。
3. 使用`RuntimeContractValidator.assertReady()`确认既有操作契约的Schema均可用；必要Schema标识集中在既有契约校验器，不另造长期分叉清单。
4. 创建`CocosSessionHost`并初始化新Session；新局仍须通过现有SaveFile校验与StorageAudit。
5. 只有上述步骤成功，才返回包含可操作Session的宿主。失败直接抛错，不返回半初始化结果，不进行存储读写或正式Action副作用。

本入口复用既有校验语义，不修改正式Schema、配置、SaveFile或ActionPipeline，不新增玩法。

## 生命周期与使用方式

成功返回的Host已完成`createSession`。调用方可通过`requireSession()`取得现有公开Session能力，或交给UI Shell/Queue执行正式动作及存读档；结束时调用`host.destroySession()`。

不要再对该Host调用`createSession`，也不要调用会再次创建会话的`QinglanSessionProbeComponent.onLoad`。原组件探针仍服务其既有“未创建Host由onLoad创建”的生命周期，不因新增装配入口改变。

## 依赖与限制

- 本入口位于creator-adapter外层，可依赖game-core及cocos-app现有公开能力。
- game-core和cocos-app不得反向依赖bootstrap宿主层。
- 运行代码不得依赖`cc`、`wx`、`fs / node:fs`、tools、runtimeHarness或game-core的dev/testing API。
- bootstrap自身不引入资源缓存、热更新、通用依赖注入框架或平台API；浏览器外层可提供既有SaveStoragePort实现，装配期间不访问存储，详见CocosEngineProbe契约。
- Node集成验收不证明Cocos资源加载、打包及依赖兼容；真实平台接入需独立验证。

## 关联验收与追踪

- `tests/stage1a-bootstrap.test.ts`：测试层读取正式样本，经公共装配入口构造对象；覆盖正常启动、缺失/无效资源、损坏引用、已有正式动作、存读档和销毁。
- `test:stage1a-bootstrap` / registry `test.stage1a-bootstrap`：新增`full`+`blocker`任务。
- `test:cocos-session` / registry `test.cocos-session`：继承Session边界回归。
- active追踪：`trace.runtime.bootstrap-resources`，gate为full/release。
