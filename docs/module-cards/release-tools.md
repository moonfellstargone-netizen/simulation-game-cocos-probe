---
doc_type: module_card
status: active
applies_to: cocos-probe
source_of_truth: false
---

# release-tools

## 模块职责

交付打包与 release zip 复验：`build_release_package.py`、`check_release_zip.py`；排除 logs、reports、node_modules。

## 不负责什么

- 日常 GitHub 开发流程（见 GITHUB_WORKFLOW）
- 玩法或业务逻辑

## 允许依赖

- tools 层

## 禁止依赖

- `reports/quality/**`、`*_logs/**` 进入 release 包

## 关键文件

- `tools/build_release_package.py`
- `tools/check_release_zip.py`

## 关键测试

- test-registry 中 `release.build` / `release.check`
- `npm run release:build` / `release:check`

## 修改前必须读取

- `tools/quality/rules/project-target.json`（release root/zip）

## 修改后必须运行

- `npm run q:release`

## 常见失败模式

- zip 含 mojibake 路径或临时报告
- 把 zip 当作日常代码权威

## 代码—地图同步

project-target release 字段；GITHUB_WORKFLOW 权威说明。
