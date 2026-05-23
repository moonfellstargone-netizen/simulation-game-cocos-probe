# GLOSSARY — v0.0.2.24

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
| **Stage 1B** | 未进入；真实 Cocos / wx 深度集成 |
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
