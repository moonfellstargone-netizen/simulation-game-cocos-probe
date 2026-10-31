# CHECK_ARCHITECTURE — v0.0.2.32

v0.0.2.32 / Cocos Web Viewport & Input Reliability验证桌面视口和真实输入可靠性，保留旧层业务架构边界。

## 1. 本轮检查目标

保留准备/生命周期full/blocker回归，新增test:cocos-web-verification-contracts / registry test.cocos-web-verification-contracts验证浏览器工具的参数、来源、HTTP服务和断言失败保护；Node契约不执行真实浏览器。独立cocos:verify:web运行固定Creator构建产物的真实Chrome鼠标点击，记录Button事件、时间变化、Label同步与清理证据；根typecheck只覆盖src，不能代替实际Creator类型、构建或浏览器验收。

工具只读取仓库唯一src/design_snapshot派生的工作副本。prepare继续导出snapshot及全部58项Schema并记录Git来源/输入产物摘要；build记录实际Web产物清单摘要，verify核对构建关联和产物字节后才启动浏览器，拒绝替换或篡改的Web目录。工程、依赖、报告、缓存和构建仍位于仓库外，不形成第二源码权威。

构建网页built-web验收1440×1200、1280×720、960×640、800×600/DPR1，另960×640/DPR2仿真，并在同页按960×640→1440×1200→800×600→960×640执行四次resize点击。编辑器预览editor-preview独立验收1440×1200与960×640/DPR1，同页按960×640→1440×1200→960×640执行三次resize点击。所有约定案例均保持完整canvas/Button可见、scroll稳定、会话身份不变、Button事件恰好一次、时间+60和Label同步；不降低断言强度。官方Default设备模拟器在800窗口裁剪固定960px内容，该预览场景未承诺支持，不能据其失败推定构建网页800失败。DPR仿真不等于手机、触摸、微信或Windows系统缩放验证。

Node任务与独立真实验收分别追踪。新增trace.cocos.web-viewport-input，保留既有trace.cocos.web-bootstrap-probe及存储/绑定/启动回归。CI只执行Node完整门禁，不安装Creator或浏览器，不改变full/release/affected策略。

既有test:cocos-session / registry test.cocos-session继续验证Session边界。test-registry描述Node自动执行集合，traceability-map.json连接模块、文件与门禁追踪；独立真实验收另以构建关联和浏览器证据记录。

## 2. traceability-contracts

`test:traceability-contracts` 通过 `quality.config.json` 读取 `rules.traceabilityMap`，校验 active entries 的 module/test/gate/路径一致性、planned 负向约束，以及 `TRACEABILITY_MATRIX.md` 边界短语。该测试**不得**推动业务源码重构。

## 3. version-surface-contracts（继承）

`test:version-surface-contracts` 继续验证 `project-target.json`、BuildId 派生与 release 权威。与 traceability 互补，不重复替代。

## 4. 现有门禁（继承既有 affected 策略）

- `arch:check` 继续执行 legacy validator 与 `architecture-boundary-check.mjs`。
- `architecture-boundary.rules.json` 中 authoritative 规则仍是 blocker。
- 既有cocos-creator-adapter的token/state-leak规则继续shadow findings / shadow_aligned观察口径；新增真实outer的wx全局禁令独立authoritative，不改变旧状态泄漏规则的权威级别。

## 5. q:affected 流程

`q:affected` 的目标是开发反馈，不是 release 验收。流程：changed files -> file risk classification -> owning modules -> affected tasks -> minimum required tasks -> report。

## 6. q:affected 与 full/release

`q:affected` **仍只是开发反馈**，affected 不可作为 release 验收，不替代 `q:full` 或 `q:release`。

## 7. 业务边界不变

旧game-core、cocos-app、cocos-creator-adapter仍不接真实 Cocos、不接 wx或fs；只有新增cocos-engine-probe外层可导入cc，并受单向公开runtime边界约束。不进入 Stage 1B，不改变 ActionPipeline，不改变 SaveFile，不改变正式 fixture，不新增玩法、微信存储、AOT或资源热更新。

## 8. Cursor 预检

Cursor 预检是执行门禁，不是可选步骤。未确认预检报告前不得改文件。

## 9. cache 与 release

cache probe 位于 `.cache/quality`，report-only。`q:release` 不 include affected，`allowCache=false`。release gate 仍全量、无缓存、可复现。`release:build` / `release:check` 通过 `--project-target` 读取 release root/zip。

## 10. 后续路线（不是授权目标）

Nightly gate 实装、Wx Storage Port、完整 AST/symbol 自动索引均为后续候选，不是 v0.0.2.32 范围。traceability map 中 `planned` 条目**不是**当前实现。

## 11. 固定检查短语

`q:affected` 不可作为 release 验收。release gate 禁止 cache。`architecture-boundary.rules.json` 与 `architecture-boundary-check.mjs` 继续有效。`test:project-map-contracts` 与 `docs/GITHUB_WORKFLOW.md`、`docs/PROJECT_MAP.md` 保持 project-map-contracts 导航口径。
