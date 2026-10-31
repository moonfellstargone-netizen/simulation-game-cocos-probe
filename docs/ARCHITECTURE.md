# ARCHITECTURE — v0.0.2.34

当前版本：v0.0.2.34 / Browser Local Save & Reload Recovery。本轮只在真实Web外层注入浏览器本地单槽Port，刷新后手动读取恢复；既有Queue本次结果、三层边界和玩法状态流转保持。

## 1. 业务架构不变

`game-core 独立于 Cocos / wx / 表现层` 仍是核心红线。`cocos-creator-adapter` 仍是纯 TypeScript、engine-neutral 的 Cocos Creator 适配探针（cocos-creator-adapter 仍是 TypeScript probe），不接真实 Cocos、不接 wx、不接 fs。

本轮不改变 ActionPipeline，不改变 SaveFile，不改变正式 fixture，不新增 gameplay action，不进入 Stage 1B。

## 2. tools/quality/affected

`tools/quality/affected` 是检查工具层，不属于游戏业务逻辑。它只读取 changed files、module graph、test registry、gate policy 与 quality rules，用于计算受影响模块、任务集合和覆盖证据。

它不得修改 `src/game-core`，不得成为 ActionPipeline、SaveFile、fixture 或 runtime contract 的权威来源。

## 3. affected policy 与业务逻辑隔离

affected policy 的风险分级、fallbackLevel、minimumRequiredTasks、taskSelectionReasons 和 skippedTaskReasons 只决定开发期检查覆盖，不决定游戏玩法规则，不改变正式状态流转，不新增 formal action。

## 4. cache 边界

`tools/quality/cache` 管理 `.cache/quality` report-only probe。cache 不参与 release 权威判断，不跳过 release/full 的关键任务，不改变任务失败语义。

## 5. traceability 层

`tools/quality/rules/traceability-map.json` 与 `docs/TRACEABILITY_MATRIX.md` 是文档治理追踪层，不属于游戏业务逻辑，不替代 module-card 或源码。

## 6. 架构边界检查继承

`architecture-boundary.rules.json` 与 `architecture-boundary-check.mjs` 继续承担架构边界检查；authoritative blocker 与 shadow findings 的分层不因 `q:affected` 改变。旧 validator 仍保留高风险红线。

## 7. 固定边界短语

game-core 独立于 Cocos / wx / 表现层。tools/quality 仍是检查工具层，不属于游戏业务逻辑。不改变 ActionPipeline。不改变 SaveFile。不改变正式 fixture。

## 8. PR CI 执行入口

`.github/workflows/quality.yml` 归属 tools 检查基础设施，只调用锁定依赖安装和既有 `q:full`；工作流 YAML 契约、报告 artifact 与 `trace.quality.pr-ci` 提供执行追踪。它不进入 game-core 运行时依赖，不增加平台适配或正式状态入口，也不改变 full / release 的失败与缓存边界。

## 9. 存储故障验证边界

现有 `SaveStoragePort` 只隔离平台读写；Session 保持候选读档提交策略，Controller 展示错误并清除旧成功结果，Queue 保持串行执行和失败后继续。`tests/support/controlledSaveStoragePort.ts` 组合既有内存端口，验证即时或延迟拒绝及恢复，不接真实平台，不注入游戏运行时依赖。

本轮不扩展存储错误码治理、不改变byte_length、不承诺真实存储部分写入后的原子回滚；参见ADR-0003、SaveStoragePort契约与`trace.save.storage-failure-recovery`。

## 10. 启动装配与资源就绪

宿主装配属于既有运行模块外层，只接收外部提供的已解析快照、Schema集合、存储端口与明确启动参数，不导入文件系统、测试辅助或开发API。资源契约描述输入和装配关系，不替代正式配置或Schema权威，也不凭元数据字符串证明来源真实性。

就绪检查复用现有校验器，覆盖必要Schema及引用的编译可用性；新局仍经既有SaveFile校验与StorageAudit。只有检查和初始化成功才交付可操作宿主，失败不发生存储读写或正式Action副作用。创建Host的入口不能放在需要反向依赖creator-adapter的cocos-app内部。

该链路由`trace.runtime.bootstrap-resources`追踪。测试可在边界外读取正式样本，但运行装配不能依赖runtimeHarness；Node集成结果仅证明平台无关链路，不证明真实Cocos资源加载、打包或依赖兼容。

## 11. 场景绑定顺序与重同步

`CocosSceneBindingController`以实例级顺序管理完整操作：执行前读取Shell快照、等待既有命令队列、生成差异并等待全部端口更新。`applyInitialSnapshot`进入同一顺序；组件mount/refresh/execute/unmount复用此入口。该顺序不替代业务事务，也不覆盖多个controller或外部直接Host调用。

端口批次失败使视图需要重同步，调用仍拒绝原始端口错误，后续排队可继续。下一次绑定操作全量刷新当前四区；成功后恢复普通diff。`diff`仅表示Shell前后变化，恢复的`applied_updates`可多于差异区。正式Action可能已提交，绑定恢复不能回滚或重发业务；端口已产生的部分副作用不保证撤销。由`trace.cocos.binding-async-recovery`追踪，使用受控端口的实际节点状态验收。

## 12. 真实Cocos Web外层

仓库内apps/cocos-probe保存最小工程源模板及外层桥接；tools/cocos-probe/prepare.mjs从现有src/design_snapshot派生浏览器runtime与全部58个声明Schema，在仓库外生成可打开工作副本。probe-source-manifest.json记录sourceCommit、sourceDirty、输入/产物摘要及project-target派生BuildId，副本不成为第二套代码或配置权威。

旧game-core、cocos-app、cocos-creator-adapter仍不接真实 Cocos、不接 wx或fs；只有新增cocos-engine-probe外层可导入cc，并受单向公开runtime边界约束。不进入 Stage 1B，不改变 ActionPipeline，不改变 SaveFile，不改变正式 fixture，不新增玩法、微信存储、AOT或资源热更新。旧模块禁止反向依赖apps/cocos-probe。新外层只能消费派生公共runtime，不直接访问核心内部、tests或dev/testing API；浏览器Storage仅由外层BrowserSaveStoragePort经现有Port注入，旧三层不接平台API，wx/fs禁令保持。

Node中的准备契约和外层生命周期测试登记为full/blocker，由trace.cocos.web-bootstrap-probe追踪；它们验证实际派生产物、资源完整性、异常路径和确定性生命周期，不冒充引擎运行证据。根typecheck仍仅覆盖src。真实Creator预览与Web构建另行执行，缺引擎时明确失败或未执行，不能静默skip或使用假cc类型声称通过。

## 真实Web视口与输入验收

工具只读取仓库唯一src/design_snapshot派生的工作副本。prepare继续导出snapshot及全部58项Schema并记录Git来源/输入产物摘要；build记录实际Web产物清单摘要，verify核对构建关联和产物字节后才启动浏览器，拒绝替换或篡改的Web目录。工程、依赖、报告、缓存和构建仍位于仓库外，不形成第二源码权威。

保留准备/生命周期full/blocker回归，新增test:cocos-web-verification-contracts / registry test.cocos-web-verification-contracts验证浏览器工具的参数、来源、HTTP服务和断言失败保护；Node契约不执行真实浏览器。独立cocos:verify:web运行固定Creator构建产物的真实Chrome鼠标点击，记录Button事件、时间变化、Label同步与清理证据；根typecheck只覆盖src，不能代替实际Creator类型、构建或浏览器验收。

窗口变化不得重新创建Host或重复绑定按钮。布局与输入修复只属于apps/cocos-probe外层，浏览器测试工具不能反向成为运行时依赖。

## 浏览器本地存储边界

BrowserSaveStoragePort惰性取得Storage，只透传稳定key下的原始字符串，固定槽web_probe，不解析SaveFile、不改变Session候选校验后提交策略。启动不自动load/save或覆盖旧档，刷新后的新局通过用户点击读取才恢复。getter/read/write错误沿现有操作失败链路返回，无静默内存回退；坏档保留当前会话及原档，健康操作可继续。移除会写入该槽的observer.memoryRoundtrip诊断。

tools/cocos-probe/serve.mjs复用严格构建来源和HTTP保护，显式固定端口且冲突失败，不自动变更origin。跨浏览器/profile/origin、多槽、自动续档、云同步、冲突治理与正式迁移均不属于本版；Node与真实Creator/浏览器证据分别记录。见trace.cocos.browser-local-save。
