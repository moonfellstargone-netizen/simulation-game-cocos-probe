# GITHUB_WORKFLOW — v0.0.2.27

GitHub 工作流与 Cursor 执行约束。

## 1. 为什么迁移到 GitHub 工作流

项目规模扩大后，继续依赖“每轮上传完整代码 zip”会导致上传、读取、审查和上下文承载成本持续升高。日常开发权威应迁移到 **GitHub 仓库 + 稳定 tag + 版本分支 + diff / PR + 质量门禁**。

`release root / release zip` 只服务阶段性归档与 release 检查，**不代表**日常开发回到 zip 工作流。

## 2. 权威边界

| 类型 | 权威来源 | 说明 |
|---|---|---|
| 代码权威 | 本 GitHub 仓库 | 日常开发、审查、合并、打 tag |
| 玩法与正式契约权威 | 正式三包 v1.5.2.2 | 不替代为技术指导或日志包 |
| 代码开发流程权威 | 技术指导 v0.0.8、GitHub 工作流规范 v0.0.2 | 拆分落地为仓库内文档，不得原样复制长文档进根目录 |
| 代码归档包 | release zip | 阶段性归档，不是日常代码权威 |
| 开发日志包 | 外部输入 | 讨论材料，**不是**代码生成依据 |

## 3. 每轮显式基线声明

每轮执行前必须声明：

```text
仓库：moonfellstargone-netizen/simulation-game-cocos-probe
起始 tag：v0.0.2.x
起始 commit：<hash>
目标版本：v0.0.2.x
Task Intent Lock：<本轮唯一目标>
```

`v0.0.2.22` 只是迁移确认基线，**不是**永久当前版本。

## 4. 四种工作模式

1. **讨论**：澄清目标、范围、权威，不写代码。
2. **更新指导**：GPT 生成执行指导，Cursor 不得跳过预检直接改文件。
3. **实际改代码**：预检通过后创建分支，按 Task Intent Lock 修改。
4. **审查收尾**：跑门禁、残留扫描、PR / tag 决策。

## 5. 分支、commit、PR、tag 规则

- 建议分支名：`version/v0.0.2.x-<short-topic>`
- commit 应聚焦：docs / test / chore 分离或单 PR 内清晰分段
- PR 必须含：基线、目标版本、Task Intent Lock、changed files、测试结果、残留扫描
- tag 仅在 q:full / q:release / release 验收通过后建议

## 6. 什么时候必须项目总览

- 跨多个模块或不确定影响面
- 版本 bump 涉及 project-target / test-registry / context docs
- 新增或删除 docs 导航层
- 发现权威冲突

先读 [`PROJECT_MAP.md`](PROJECT_MAP.md) 与 [`CODE_CONTEXT_INDEX.md`](CODE_CONTEXT_INDEX.md)。

## 7. 项目超出上下文时的分层读取

```text
L0 仓库入口（README / package.json / project-target.json）
L1 工作流与地图（GITHUB_WORKFLOW / PROJECT_MAP / DOCS_GOVERNANCE / GLOSSARY）
L2 领域地图（docs/maps/*）
L3 模块卡（docs/module-cards/*）
L4 代码索引（docs/code-index/*）
L5 源码与测试（src/** / tests/**）
```

不得只依赖更新指导摘要；必须读取仓库真实文件。

## 8. Scope Discovery

复杂任务必须先做 Scope Discovery：

- 任务类型（文档 / 业务 / 质量 / release）
- seed files 与必读文件
- 暂不读模块
- 扩大范围条件
- 预计 q:affected 覆盖

## 9. q:affected / q:full / q:release 边界

- `q:affected`：开发反馈，**不替代** `q:full` 或 `q:release`
- `q:full`：版本完成前完整检查
- `q:release`：出包前全量 + release build/check
- release gate **禁止 cache**

## 10. GitHub Actions 远端质量门禁（v0.0.2.27）

工作流文件：[`.github/workflows/quality-gate.yml`](../.github/workflows/quality-gate.yml)。

### 10.1 触发条件

| 触发 | 说明 |
|---|---|
| `pull_request` → `main` | 面向 main 的 PR 自动跑远端 `q:full` |
| `push` → `main` | main 推送自动跑远端 `q:full` |
| `workflow_dispatch` | 手动触发同一门禁 |

### 10.2 PR head commit 选择

- PR 事件检出：`github.event.pull_request.head.sha`（PR head，不是 merge commit）
- `push` / `workflow_dispatch` 检出：`github.sha`
- checkout 后用 `git rev-parse HEAD` 与期望 SHA 比对，防止检错提交

### 10.3 权限与并发

- 顶层 `permissions.contents: read`（无 write；不授予 contents 写权限）
- `concurrency.cancel-in-progress: true`，同 PR / 同 ref 的旧 run 可被取消

### 10.4 远端执行内容

远端 job 在干净环境执行：

1. `npm ci`（锁定依赖）
2. `npm run q:full`（正式完整检查）

Node 版本：`20`。workflow **不**单独再跑 `arch:check`（`q:full` 已包含架构检查链）。

### 10.5 本地 vs 远端验收边界

| 场景 | 权威命令 | 说明 |
|---|---|---|
| 本地开发反馈 | `q:affected` | **不**替代正式门禁 |
| 本地 / 远端完整验收 | `q:full` | 远端 CI 只跑此项 |
| 本地 release 出包 | `q:release` + `release:build` / `release:check` | **不**由本 workflow 自动执行 |

本轮**不**配置 branch protection，**不**自动 release / tag / merge。

### 10.6 远端运行证据

在 GitHub Actions 上针对目标 commit 的真实成功 run 出现之前，**不得**宣称“远端验收完成”。本地 `q:full` 通过只证明本地；远端完成须有对应 workflow run 证据。

防回退契约：`npm run test:github-actions-workflow-contracts`（registry：`test.github-actions-workflow-contracts`）。

## 11. 日志包、zip、reports、cache 禁入仓库

禁止把开发日志包、临时 reports、`.cache/quality` 产物当作代码权威或提交进 release zip。

## 12. 冲突处理

指导与仓库、正式三包、流程权威冲突时，**不得自行选边**，必须停止并报告，由用户 / GPT 确认。

## 13. Cursor 执行门禁

Cursor 执行方必须先输出预检报告，用户或 GPT 确认后才可修改文件。**不得**跳过预检直接执行。
