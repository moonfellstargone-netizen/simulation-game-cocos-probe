# SOURCE_DESIGN_PACK — v0.0.2.27

本代码包基于：`模拟游戏_正式开发总设定包_v1_5_2_2_practical_ready.zip`。

设计/规范来源仍是正式包 v1.5.2.2；修改规范包和日志包只用于工作流约束与人工复查，不是玩法规则权威，不并入代码包。

v0.0.2.27 是 PR 自动质量验证版：通过 GitHub Actions 在 PR 中运行现有 `q:full` 并保留报告；工作流 YAML 契约登记为完整门禁任务，并通过 `traceability-map.json` 串联 module-graph、test-registry、module-card 与 gate。项目地图与 GitHub 工作流文档由 `docs/PROJECT_MAP.md` 与 `docs/GITHUB_WORKFLOW.md` 维护；不改变正式设定、不新增玩法、不修改 ActionPipeline、不修改 SaveFile、不进入 Stage 1B。

code package version: `v0.0.2.27`

版本名称：PR Quality Gate / PR 自动质量验证版。

本轮只增加 PR 质量执行入口及其必要契约、包卫生兼容与版本同步；这是代码包内部检查体系治理，不改变正式包设定。不把日志包或规划对话作为正式设计来源。
