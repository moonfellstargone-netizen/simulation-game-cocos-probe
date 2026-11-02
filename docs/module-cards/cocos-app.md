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

## 加工最小只读投影

CocosSelectableViewModel.ts公开processing_method_options与processing_task_options：配置要求、只读tool_requirements、候选lot_ids、兼容设施及任务现有status/时间/设施。requirement_index仅为UI槽，不是formal role；工具只作说明，不新增选择或消耗。方法无料仍可查看，旧collectable_task_options保持原shape且仅ready。全部嵌套数组、Quantity与facility_ref复制，expected_output明确为预计，不表示已领取。

tests/cocos-ui-readiness.test.ts核配置来源、新鲜度/形态候选刷新、完整source save/config隔离和active→ready→completed跨新Session读取。沿既有test:cocos-ui-readiness full/blocker，trace.cocos.web-processing-loop连接外层消费；Session、预览器、正式参数与core业务保持。
