---
doc_type: module_card
status: active
applies_to: cocos-probe
source_of_truth: false
---

# game-core

## 模块职责

核心游戏逻辑：ActionPipeline、GameRuntime、库存/加工/烹饪/需求/存档等领域系统。必须 engine-neutral、platform-neutral。

## 不负责什么

- UI 渲染、Cocos 生命周期、wx 存储
- 直接暴露给表现层的 SaveFile 写入口

## 允许依赖

- game-core 内部模块
- 标准库、ajv 等已声明依赖

## 禁止依赖

- `src/cocos-app/**`、`src/cocos-creator-adapter/**`
- `cc`、`wx`、`node:fs`、`fs`（见 module-graph）

## 关键文件

- `src/game-core/action/ActionPipeline.ts`
- `src/game-core/runtime/GameRuntime.ts`
- `src/game-core/index.ts`

## 关键测试

- `tests/stage1a-contract.test.ts`
- `tests/stage1a-baseline.test.ts`
- `tests/api-boundary.test.ts`

## 修改前必须读取

- `docs/ARCHITECTURE.md`
- `docs/adr/ADR-0002-actionpipeline-as-only-formal-state-entry.md`

## 修改后必须运行

- `npm run test:stage1a-baseline`
- `npm run q:affected -- --changed-files src/game-core/<file>`

## 常见失败模式

- 新增非 formal action 路径
- 绕过 ActionPipeline 改状态

## 代码—地图同步

改动公开 API 或目录结构时更新 `docs/code-index/public-api.md` 与本卡。
