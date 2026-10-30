---
doc_type: module_card
status: active
applies_to: cocos-probe
source_of_truth: false
---

# cocos-app

## 模块职责

Cocos 试水应用层：Session、ViewModel、Action 适配（Dispatcher、Previewer、DraftBuilder），通过 Port 访问 game-core。

## 不负责什么

- 游戏业务规则定义（在 game-core）
- 真实 Cocos 引擎 API

## 允许依赖

- `game-core`（见 module-graph）

## 禁止依赖

- `cc`、`wx`、`node:fs`、`tests/**`

## 关键文件

- `src/cocos-app/runtime/CocosAppRuntimeSession.ts`
- `src/cocos-app/adapters/CocosActionDispatcher.ts`
- `src/cocos-app/adapters/CocosRuntimeFacade.ts`

## 关键测试

- `tests/cocos-runtime-session.test.ts`
- `tests/cocos-adapter-boundary.test.ts`
- `tests/action-preview-boundary.test.ts`

## 修改前必须读取

- `docs/module_contracts/CocosAppRuntimeSession.contract.md`（遗留契约，保留）

## 修改后必须运行

- `npm run test:cocos-session`
- `npm run test:cocos-adapter`

## 常见失败模式

- dispatch 不经过 ActionPipeline
- preview 产生正式状态变化
- 将存储读取拒绝与空槽混同，或写入拒绝后返回成功摘要
- 只比较单一显示标签，漏掉故障前后完整存档状态的变化

## 代码—地图同步

runtime-map、cocos-map、public-api；存储故障保证见 save-load 模块卡、ADR-0003 与 `trace.save.storage-failure-recovery`。
