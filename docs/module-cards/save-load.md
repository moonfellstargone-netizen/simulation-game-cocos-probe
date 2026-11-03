---
doc_type: module_card
status: active
applies_to: cocos-probe
source_of_truth: false
---

# save-load

## 模块职责

存档序列化与迁移：`SaveManager`、`SaveMigrationRegistry`、`NewGameBuilder`；端口 `SaveStoragePort` 定义在 game-core。

## 不负责什么

- 表现层 slot UI（在 cocos-creator-adapter）
- 直接 wx 文件 API

## 允许依赖

- game-core 内部

## 禁止依赖

- cocos 层直接写 SaveFile

## 关键文件

- `src/game-core/save/SaveManager.ts`
- `src/game-core/save/SaveStoragePort.ts`
- `src/game-core/save/NewGameBuilder.ts`

## 关键测试

- `tests/stage1a-fixture-runner.test.ts`
- `tests/cocos-save-load-ui-binding.test.ts`（UI 绑定边界）
- `tests/cocos-runtime-session.test.ts`（读写拒绝、空槽区别、完整状态保留与重试）
- `tests/cocos-ui-command-queue.test.ts`（受控延迟拒绝、串行顺序和后续恢复）
- `tests/support/controlledSaveStoragePort.ts`（组合既有内存端口，测试辅助）
- active 追踪 `trace.save.storage-failure-recovery`，沿用上述三个既有 full/blocker 任务。

## 修改前必须读取

- `docs/adr/ADR-0003-load-failure-must-not-mutate-current-session.md`
- `docs/module_contracts/SaveStoragePort.contract.md`

## 修改后必须运行

- `npm run test:fixture`
- `npm run test:cocos-save-load`
- `npm run test:cocos-session`
- `npm run test:cocos-ui-command-queue`

## 常见失败模式

- load 失败污染 session
- 表现层绕过 SaveStoragePort
- 读取拒绝被误当空槽、失败 snapshot 残留旧成功结果、队列被拒绝命令阻断
- 把内存委托前故障测试误解为真实存储原子写回滚保证

## 代码—地图同步

public-api 中 Save/Load 入口说明、runtime/cocos maps 与 `trace.save.storage-failure-recovery`追踪既有存储保证，不新增稳定错误码或底层存储事务。

## 持久ID恢复与预览一致性

IdService观察完整GameState的字符串值及记录键，恢复生成格式ID的每前缀高水位；这只决定技术ID分配，不用于判断材料身份。十进制字符串递增避免Number大后缀精度停滞。同一runtime高水位只升不降，GameRuntime包装全部已注册handler，使直接pipeline、Session和预览新runtime均在业务分配前恢复。ActionPipeline、存档结构与正式业务规则保持。

保证覆盖存档中仍存在的对象和任意历史引用，以及同一runtime已知分配；整个SaveFile已无任何记录的历史ID不能无新增持久化字段地恢复。预览不修改领域状态或正式ID服务；失败保持既有事务语义，不承诺请求序号或已分配ID回滚。

trace.runtime.id-recovery连接IdService.ts、GameRuntime.ts、CocosActionPreviewer.ts与Session；test.stage1a-contract、test.action-preview、test.cocos-session核对各对象/事件、历史引用、跨实例加载、极大后缀及合法恢复。该ID恢复能力不新增数量规则；网页拆分由outer单独提供，既有加工页独立消费正式加工，既有烹饪页消费既有cook_dish，不扩Stage1B或wx。真实Creator及既有built/editor浏览器回归独立执行，核心/Session回归与网页真实输入分别验收。

## 跨步骤恢复验证

trace.cocos.cross-step-recovery沿既有手动单槽机制补五自然保存点的新Host读取和真实续玩证据，生产SaveManager/Session与ID恢复边界保持。tests/stage1a-bootstrap.test.ts经公共装配进入既有test.stage1a-bootstrap，保留上列Session/save-load/Queue失败保护；坏档失败不替换健康状态。浏览器刷新/新页续玩另由真实built/editor验证，不新增自动存档、多槽、迁移或跨标签仲裁。
