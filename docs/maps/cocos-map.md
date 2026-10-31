# Cocos Map — v0.0.2.33

## 系统职责

Cocos 试水适配与 Creator 探针：UI readiness、menu/save-load binding、scene/component binding。旧creator-adapter仍是**非真实 Cocos 工程**；新增cocos-engine-probe为真实Web外层源模板，派生工作副本位于仓库外。

## 涉及模块

- `cocos-app`
- `cocos-creator-adapter`
- `cocos-engine-probe`

## 关键文件

- `apps/cocos-probe/`（真实外层源模板）
- `apps/cocos-probe/template/assets/scripts/CocosWebProbe.ts`（cc组件、正式资源加载与Label/Button端口）
- `apps/cocos-probe/template/assets/scripts/ProbeLifetime.ts`（异步启动、销毁和迟到结果保护）
- `tools/cocos-probe/prepare.mjs`（仓库外派生准备）
- `tools/cocos-probe/build.mjs`（真实Creator构建入口）

- `src/cocos-creator-adapter/bootstrap/Stage1ABootstrap.ts`
- `src/cocos-creator-adapter/scene/CocosSceneBindingController.ts`
- `src/cocos-creator-adapter/component/QinglanUiSceneProbeComponent.ts`
- `src/cocos-app/runtime/CocosAppRuntimeSession.ts`
- `src/cocos-creator-adapter/CocosSessionHost.ts`
- `src/cocos-creator-adapter/shell/CocosUiShellController.ts`
- `src/cocos-creator-adapter/shell/CocosUiCommandQueue.ts`
- `src/cocos-creator-adapter/menu/MinimalMenuInteractionController.ts`
- `src/cocos-creator-adapter/save/SaveLoadInteractionController.ts`

## 关键测试

- `tests/cocos-probe-preparation.test.mjs`
- `tests/cocos-engine-probe-lifecycle.test.ts`

- `tests/stage1a-bootstrap.test.ts`（正式资源经公共入口的独立装配、失败保护与生命周期）
- `tests/cocos-ui-readiness.test.ts`
- `tests/cocos-minimal-menu-binding.test.ts`
- `tests/cocos-save-load-ui-binding.test.ts`
- `tests/cocos-runtime-session.test.ts`
- `tests/cocos-ui-command-queue.test.ts`（受控延迟读写拒绝和恢复）
- `tests/cocos-scene-binding-application.test.ts`
- `tests/cocos-component-node-binding-application.test.ts`
- `tests/support/controlledBindingPort.ts`（手动延迟/拒绝和实际端口状态）

## 修改前必读

- [`module-cards/cocos-creator-adapter.md`](../module-cards/cocos-creator-adapter.md)
- 遗留契约：`docs/module_contracts/*`（保留，非 module-card 主入口）

## 修改后必跑

- `npm run test:stage1a-bootstrap`
- `npm run test:cocos-scene-binding`
- `npm run test:cocos-component-node-binding`
- `npm run test:cocos-ui-readiness`
- 相关 cocos-ui 测试组

## 常见风险

- 在旧三层接入真实`cc`或任何层接wx（新outer只开放cc）
- 把探针写成 Stage 1B 已实现
- UI 层绕过 Session 直写 SaveFile
- 存储拒绝后仍展示旧成功摘要、队列超车或健康命令无法继续；追踪 `trace.save.storage-failure-recovery`
- 对createStage1AHost返回的已创建Host重复执行Probe.onLoad，或把装配验收当作真实Cocos工程运行证明
- 异步旧绑定覆盖新视图或卸载结果；失败后diff遗漏未应用区，恢复错误地重发正式Action

`trace.cocos.binding-async-recovery`覆盖同一绑定实例的完整顺序及失败后重同步；两项既有full/blocker任务登记tests覆盖和共享辅助，不修改affected算法。

## 关联 module-cards

cocos-app, cocos-creator-adapter

## 真实Web外层与后续范围

新增outer源模板由[引擎探针模块卡](../module-cards/cocos-engine-probe.md)导航，trace.cocos.web-bootstrap-probe连接自动准备与生命周期验证；真实Creator预览/构建独立验收。微信导出、真实wx storage及AOT仍未进入。

## 桌面Web视口与输入

`apps/cocos-probe/template/build-templates/web-desktop/`是页面容器/resize源模板；`tools/cocos-probe/build.mjs`记录产物摘要，`tools/cocos-probe/verify-web.mjs`与`tools/cocos-probe/lib/webProbeSupport.mjs`核对来源后运行真实鼠标矩阵。`tests/cocos-web-verification-contracts.test.mjs`登记full/blocker，仅验证Node工具边界，不能作为实际Creator或浏览器通过证据。

`trace.cocos.web-viewport-input`连接模板、工具、契约、affected与实际验收说明；支持范围见[引擎探针模块卡](../module-cards/cocos-engine-probe.md)。不能用observer.advance绕过物理点击；窗口变化保留原会话，不引入真实存储或微信。

## 临时存读档交互与恢复

trace.cocos.web-save-load-recovery连接apps/cocos-probe/template/assets/scripts/CocosWebProbe.ts、ProbeInteraction.ts和src/cocos-creator-adapter/shell/CocosUiCommandQueue.ts；根typecheck仍只覆盖src。外层真实三按钮使用固定本页内存槽web_probe，当前反馈读取command_result，历史面板错误保留但不覆盖本次结果。ProbeInteraction保证busy与销毁后迟到保护；tests/cocos-web-interaction.test.ts由既有test.cocos-engine-probe-lifecycle实际执行并登记files/covers，新增helper和test分别验证单文件affected选择。Queue/component行为回归与浏览器工具契约保持full/blocker；真实Creator/Chrome物理点击、读取恢复及刷新清空独立验收，不能由Node通过推导。
