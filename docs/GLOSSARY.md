# GLOSSARY — v0.0.2.31

术语表。防止权威与工具边界混淆。

## 核心术语

| 术语 | 定义 |
|---|---|
| **代码权威** | 本 GitHub 仓库的日常开发与审查来源 |
| **玩法与正式契约权威** | 正式三包 v1.5.2.2 |
| **代码开发流程权威** | 技术指导 v0.0.8、GitHub 工作流规范 v0.0.2（仓库内拆分文档） |
| **代码项目** | 本仓库所代表的 Cocos 微信试水代码工程 |
| **GitHub 仓库** | `moonfellstargone-netizen/simulation-game-cocos-probe` |
| **代码归档包** | release zip，阶段性归档，≠ 日常代码权威 |
| **开发日志包** | 外部讨论记录，≠ 代码生成依据 |
| **Task Intent Lock** | 本轮唯一目标与明确不做清单 |
| **Scope Discovery** | 执行前范围发现：seed files、必读、暂不读模块 |
| **Project Map** | L0–L5 分级导航，≠ 源码替代品 |
| **Traceability Matrix** | `TRACEABILITY_MATRIX.md` + `traceability-map.json`，追踪层 ≠ 玩法权威 |
| **Cocos Web Bootstrap Probe** | 真实Creator Web最小启动外层，通过公开runtime和正式资源驱动场景，独立验收真实引擎 |
| **异步场景绑定顺序与恢复** | 同一绑定实例内按序完成命令和界面应用，端口失败后重新同步当前视图，不回滚或重发正式Action |
| **启动装配与资源契约** | 核对外部资源、编译Schema引用并经公共入口装配宿主，资源失败时不交付可操作会话 |
| **存储故障保护与恢复** | 通过受控读写拒绝，验证Session状态保护、错误展示、队列顺序及恢复重试 |
| **PR 自动完整检查** | PR 中自动执行现有 q:full 并保留报告的 CI 入口；发布验收仍按 q:release |
| **traceability-lite/v1** | 当前轻量追踪 schema 版本 |
| **active / planned** | active=当前追踪；planned+notCurrentAuthority=预留，非当前实现 |
| **Module Card** | `docs/module-cards/*`，模块职责与边界卡片 |
| **ADR** | 架构决策记录，`docs/adr/*` |
| **RFC** | 待决方案讨论稿 |
| **q:affected** | 开发反馈门禁，≠ q:full / q:release |
| **q:full** | 版本完成前完整检查 |
| **q:release** | 出包前 full + release build/check |
| **正式状态变化** | 须经 ActionPipeline 的状态变更 |
| **ActionPipeline** | game-core 唯一正式 action 入口 |
| **SaveFile** | 存档结构；表现层不得直接写入 |
| **Stage 1A** | 当前 headless + 探针阶段 |
| **Stage 1B** | 未进入；后续玩法与微信平台深度集成，现有Web启动探针不代表进入Stage 1B |
| **release root** | release zip 内根目录名 |
| **release zip** | 阶段性代码归档包 |
| **project-target** | `tools/quality/rules/project-target.json` |
| **Cursor 执行方** | 读仓库、预检、改文件、跑门禁 |
| **GPT 审查方** | 规划、审查预检与最终汇报 |

## 易混淆对照

| 错误理解 | 正确理解 |
|---|---|
| 代码项目 = zip 归档包 | GitHub 仓库是日常权威 |
| GitHub 仓库 = 玩法权威 | 玩法权威仍是正式三包 |
| 日志包 = 代码生成依据 | 日志包仅讨论材料 |
| 项目地图 = 源码 | 地图是导航 |
| q:affected = q:full | affected 只是开发反馈 |
| Cursor 执行 = 自动越界 | 须预检 + Task Intent Lock |

## 遗留目录说明

`docs/module_contracts/` 是上下文治理遗留契约目录，**保留**。新版项目地图主入口是 `docs/module-cards/`，不是 `docs/module_contracts/`。

## Cocos Web Bootstrap Probe

真实Creator Web最小启动外层；旧三层仍engine-neutral，只有新outer可用cc。仓库保存源模板，prepare从唯一runtime/正式资源生成外部可打开副本。Node准备/生命周期契约与真实Creator预览/构建是不同验收证据，不能互相代替。
