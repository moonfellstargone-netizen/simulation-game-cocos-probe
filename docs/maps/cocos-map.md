# Cocos Map — v0.0.2.29

## 系统职责

Cocos 试水适配与 Creator 探针：UI readiness、menu/save-load binding、scene/component binding。**非真实 Cocos 工程**。

## 涉及模块

- `cocos-app`
- `cocos-creator-adapter`

## 关键文件

- `src/cocos-creator-adapter/bootstrap/Stage1ABootstrap.ts`
- `src/cocos-app/runtime/CocosAppRuntimeSession.ts`
- `src/cocos-creator-adapter/CocosSessionHost.ts`
- `src/cocos-creator-adapter/shell/CocosUiShellController.ts`
- `src/cocos-creator-adapter/shell/CocosUiCommandQueue.ts`
- `src/cocos-creator-adapter/menu/MinimalMenuInteractionController.ts`
- `src/cocos-creator-adapter/save/SaveLoadInteractionController.ts`

## 关键测试

- `tests/stage1a-bootstrap.test.ts`（正式资源经公共入口的独立装配、失败保护与生命周期）
- `tests/cocos-ui-readiness.test.ts`
- `tests/cocos-minimal-menu-binding.test.ts`
- `tests/cocos-save-load-ui-binding.test.ts`
- `tests/cocos-runtime-session.test.ts`
- `tests/cocos-ui-command-queue.test.ts`（受控延迟读写拒绝和恢复）
- `tests/cocos-scene-binding-application.test.ts`

## 修改前必读

- [`module-cards/cocos-creator-adapter.md`](../module-cards/cocos-creator-adapter.md)
- 遗留契约：`docs/module_contracts/*`（保留，非 module-card 主入口）

## 修改后必跑

- `npm run test:stage1a-bootstrap`
- `npm run test:cocos-ui-readiness`
- 相关 cocos-ui 测试组

## 常见风险

- 接入真实 `cc` / wx API（当前禁止）
- 把探针写成 Stage 1B 已实现
- UI 层绕过 Session 直写 SaveFile
- 存储拒绝后仍展示旧成功摘要、队列超车或健康命令无法继续；追踪 `trace.save.storage-failure-recovery`
- 对createStage1AHost返回的已创建Host重复执行Probe.onLoad，或把装配验收当作真实Cocos工程运行证明

## 关联 module-cards

cocos-app, cocos-creator-adapter

## 后续候选（未进入）

- 真实 Cocos Component / Scene / Prefab
- wx storage port
