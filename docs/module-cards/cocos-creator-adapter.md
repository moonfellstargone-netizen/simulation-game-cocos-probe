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
- `src/cocos-creator-adapter/CocosSessionHost.ts`
- `src/cocos-creator-adapter/shell/CocosUiShellController.ts`
- `src/cocos-creator-adapter/shell/CocosUiCommandQueue.ts`
- `src/cocos-creator-adapter/menu/MinimalMenuInteractionController.ts`
- `src/cocos-creator-adapter/save/SaveLoadInteractionController.ts`

## 关键测试

- `tests/stage1a-bootstrap.test.ts`
- `tests/cocos-ui-readiness.test.ts`
- `tests/cocos-minimal-menu-binding.test.ts`
- `tests/cocos-ui-shell-composition.test.ts`
- `tests/cocos-save-load-ui-binding.test.ts`
- `tests/cocos-ui-command-queue.test.ts`

## 修改前必须读取

- `docs/module_contracts/Stage1ABootstrap.contract.md`（装配边界说明；本模块卡仍为导航入口）
- `docs/maps/cocos-map.md`
- 相关 `docs/module_contracts/*.contract.md`

## 修改后必须运行

- `npm run test:stage1a-bootstrap`
- `npm run test:cocos-ui-readiness`
- 涉及存储故障呈现与恢复时运行 `npm run test:cocos-save-load`、`npm run test:cocos-ui-command-queue`。

## 常见失败模式

- 把探针写成真实 Cocos 实现
- UI 命令队列当作业务事务
- 存储拒绝后旧成功结果未清除、错误未呈现或后续命令不再执行
- 资源未就绪即发布可用Host，或把Node集成结果当作真实Cocos兼容证明
- 对createStage1AHost返回的已创建Host再调用Probe.onLoad或createSession

## 代码—地图同步

cocos-map、runtime-map、code-index/files.md与public-api.md；装配链路由`trace.runtime.bootstrap-resources`追踪。
