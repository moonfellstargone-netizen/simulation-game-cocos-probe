---
doc_type: module_card
status: active
applies_to: cocos-probe
source_of_truth: false
---

# quality-tools

## 模块职责

质量门禁配置与插件：module-graph、test-registry、gate-policy、affected/cache、architecture-boundary 插件。

## 不负责什么

- 游戏玩法规则
- 替代 release 权威判断

## 允许依赖

- tools 内部；不得反向依赖 game-core 源码（见 module-graph）

## 禁止依赖

- `src/game-core/**`

## 关键文件

- `tools/quality/run-quality-gate.mjs`
- `tools/quality/module-graph.json`
- `tools/quality/test-registry.json`
- `tools/quality/gate-policy.json`
- `tools/quality/lib/projectTarget.mjs`
- `tools/quality/lib/versionSurface.mjs`
- `tools/quality/plugins/*`

## 关键测试

- `tests/quality-gate-contracts.test.mjs`
- `tests/quality-affected-policy-hardening.test.mjs`
- `tests/version-surface-contracts.test.mjs`

## 修改前必须读取

- `docs/CHECK_ARCHITECTURE.md`
- `docs/GITHUB_WORKFLOW.md`

## 修改后必须运行

- `npm run q:full`

## 常见失败模式

- q:affected 语义扩写成 release 替代
- project-target 与 package 版本漂移

## 代码—地图同步

quality-map、GLOSSARY 中 q:* 术语。
