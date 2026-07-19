# SOURCE_DESIGN_PACK — v0.0.2.27

本代码包基于：`模拟游戏_正式开发总设定包_v1_5_2_2_practical_ready.zip`。

设计/规范来源仍是正式包 v1.5.2.2；修改规范包和日志包只用于工作流约束与人工复查，不是玩法规则权威，不并入代码包。

v0.0.2.27 是 PR 远端质量门禁基线版：为面向 main 的 Pull Request 与 main 推送建立 GitHub Actions 远端 `q:full` 门禁（`.github/workflows/quality-gate.yml`），并以 workflow 契约测试防回退；项目地图与 GitHub 工作流文档仍由 `docs/PROJECT_MAP.md` 与 `docs/GITHUB_WORKFLOW.md` 维护；不改变正式设定、不新增玩法、不修改 ActionPipeline、不修改 SaveFile、不进入 Stage 1B。

code package version: `v0.0.2.27`

版本名称：Pull Request CI Quality Gate Baseline / PR 远端质量门禁基线版。

本轮只治理远端 CI 与质量检查登记；这是代码包内部检查体系治理，不改变正式包设定。不把日志包或规划对话作为正式设计来源。
