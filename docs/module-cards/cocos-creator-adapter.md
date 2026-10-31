---
doc_type: module_card
status: active
applies_to: cocos-probe
source_of_truth: false
---

# cocos-creator-adapter

## 模块职责

纯TypeScript、engine-neutral的Creator适配探针：SessionHost、UI shell、menu/save-load binding、scene/component binding，以及从外部资源装配已ready宿主的bootstrap入口。

## 不负责什么

- 真实 Cocos 工程、Scene、Prefab
- wx 存储

## 允许依赖

- `cocos-app`、`game-core`（禁止 dev-api / testing-api 直接依赖）

## 禁止依赖

- `cc`、`wx`、`node:fs`

## 关键文件

- `src/cocos-creator-adapter/bootstrap/Stage1ABootstrap.ts`
- `src/cocos-creator-adapter/scene/CocosSceneBindingController.ts`
- `src/cocos-creator-adapter/component/QinglanUiSceneProbeComponent.ts`
- `src/cocos-creator-adapter/CocosSessionHost.ts`
- `src/cocos-creator-adapter/shell/CocosUiShellController.ts`
- `src/cocos-creator-adapter/shell/CocosUiCommandQueue.ts`
- `src/cocos-creator-adapter/menu/MinimalMenuInteractionController.ts`
- `src/cocos-creator-adapter/save/SaveLoadInteractionController.ts`

## 关键测试

- `tests/stage1a-bootstrap.test.ts`
- `tests/cocos-scene-binding-application.test.ts`
- `tests/cocos-component-node-binding-application.test.ts`
- `tests/support/controlledBindingPort.ts`（手动控制异步绑定，记录实际端口内容）
- `tests/cocos-ui-readiness.test.ts`
- `tests/cocos-minimal-menu-binding.test.ts`
- `tests/cocos-ui-shell-composition.test.ts`
- `tests/cocos-save-load-ui-binding.test.ts`
- `tests/cocos-ui-command-queue.test.ts`

## 修改前必须读取

- `docs/module_contracts/Stage1ABootstrap.contract.md`（装配边界说明；本模块卡仍为导航入口）
- `docs/maps/cocos-map.md`
- `docs/module_contracts/CocosSceneBindingController.contract.md`及scene/component端口与组件契约（按本模块卡定位边界说明）
- 相关 `docs/module_contracts/*.contract.md`

## 修改后必须运行

- `npm run test:stage1a-bootstrap`
- `npm run test:cocos-scene-binding`
- `npm run test:cocos-component-node-binding`
- `npm run test:cocos-ui-readiness`
- 涉及存储故障呈现与恢复时运行 `npm run test:cocos-save-load`、`npm run test:cocos-ui-command-queue`。

## 常见失败模式

- 把探针写成真实 Cocos 实现
- UI 命令队列当作业务事务
- 存储拒绝后旧成功结果未清除、错误未呈现或后续命令不再执行
- 资源未就绪即发布可用Host，或把Node集成结果当作真实Cocos兼容证明
- 对createStage1AHost返回的已创建Host再调用Probe.onLoad或createSession
- 异步绑定超出命令队列顺序、before在排队前读取或卸载被旧更新覆盖
- 绑定失败后普通diff漏掉未应用内容；将恢复错误地实现为重发Action或业务回滚
- 把实例级顺序承诺为全局锁，或端口重入等待同一控制器后续调用

## 绑定顺序与恢复

同一SceneBindingController实例的execute与applyInitialSnapshot按完整操作排序，组件生命周期复用该顺序。端口错误保持Promise拒绝，下一绑定操作全量同步当前四区；成功后恢复普通diff。diff仅表示Shell变化，恢复的applied_updates可全量，原因仍为initial_render。正式Action不重发、不回滚，端口部分副作用不保证撤销。

## 代码—地图同步

cocos-map、runtime-map、code-index/files.md与public-api.md；绑定顺序与恢复由`trace.cocos.binding-async-recovery`追踪，装配链路由`trace.runtime.bootstrap-resources`追踪。

## 跨操作结果归属

CocosUiCommandQueue按本次命令选择shell/menu/save_load错误来源，保留其他区历史错误；refresh和卸载不因历史面板失败而误报。本次失败返回独立且可观察，后续健康命令继续，不重发Action。Queue与公共bootstrap/component回归、外层本次反馈由trace.cocos.web-save-load-recovery连接，完整语义见CocosUiCommandQueue.contract.md。

## 正式store_item最小菜单适配

MenuActionBinding.ts从当前公开材料批次/储存目标解析选择，以MaterialLot object_ref和目标StorageRef调用cocos-app既有CocosActionDraftBuilder.storeItem；这是库存版本唯一src执行文件变化。不直接修改SaveFile、不新增业务规则、不改变Session或Queue，不接cc/wx/fs。预览、执行和回滚沿现有MinimalMenuInteractionController路径。

tests/cocos-minimal-menu-binding.test.ts / test:cocos-menu验证预览不写状态、整批位置和源/目标占用、数量/身份/时间保持、失效/禁用/不支持形态/容量拒绝及后续健康恢复。trace.cocos.web-inventory-storage连接该适配与outer库存、地图和真实点击；同步cocos/runtime地图、files/public-api索引。
