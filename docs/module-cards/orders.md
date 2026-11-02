---
doc_type: module_card
status: active
applies_to: cocos-probe
source_of_truth: false
---

# orders

## 模块职责

订单与需求解析：当前实现入口为 `DemandResolver`（`src/game-core/demand/`），处理 submit_order 等领域逻辑。

## 不负责什么

- 网页订单节点和本地选择（由outer第五页负责，见cocos-engine-probe模块卡）
- 外部支付 / wx 接口

## 允许依赖

- game-core 内部

## 禁止依赖

- cocos、wx

## 关键文件

- `src/game-core/demand/DemandResolver.ts`
- `src/game-core/action/FormalStage1AActionCatalog.ts`
- `src/game-core/runtime/GameRuntime.ts`
- `src/cocos-app/view-models/CocosSelectableViewModel.ts`（只读消费）

## 关键测试

- `tests/stage1a-fixture-runner.test.ts`
- `tests/stage1a-contract.test.ts`
- `tests/action-preview-boundary.test.ts`
- `tests/cocos-runtime-session.test.ts`
- `tests/cocos-ui-readiness.test.ts`

## 修改前必须读取

- `docs/module-cards/game-core.md`
- 正式三包订单相关契约

## 修改后必须运行

- `npm run test:fixture`
- `npm run test:contract`
- `npm run test:action-preview-boundary`
- `npm run test:cocos-session`
- `npm run test:cocos-ui-readiness`

## 常见失败模式

- 把未实现的订单 UI 写为已交付

## 代码—地图同步

本卡对应 demand 目录；若将来拆分 `orders/` 目录须更新本卡与 code-index。

## 合法状态、截止与失败保护

available与accepted在当前分钟不超过deadline时可按现有需求规则提交。DemandResolver先验证状态和时限，再做既有菜品匹配；通过后仅在同步事务内部进入submitted，既有消费、储存审计、金钱/声望结算后completed。重复提交与submitted/completed/failed/expired/cancelled均拒绝，失败不得消耗菜品、增加奖励或改订单/事件；旧failed不迁移或重开。

GameRuntime既有advance_time截止settlement将available/accepted在now>deadline时转为expired，恰到截止仍保持开放。直接提交过期开放单复用ERR_ORDER_NOT_AVAILABLE，可带:deadline诊断，但保持提交前完整状态，不在拒绝路径偷偷结算。CocosSelectableViewModel只读order_options按同一合法状态和时限给enabled/reason，既有字段语义保持，新增展示字段见网页订单投影；enabled不是需求匹配保证。

trace.orders.legal-state-deadline连接DemandResolver、GameRuntime与CocosSelectableViewModel，以及test.stage1a-contract、test.action-preview、test.cocos-session和test.cocos-ui-readiness的现有full/blocker。核心、预览、Session受控合法加载与只读选项按层验收D-1/D/D+1、终态拒绝、需求失败完整保护、合法恢复、成功事件/奖励恰一次和新会话防重交。accepted及过期开放单可用合法受控存档验证；订单领域受控Node用例不冒充网页或真机实测；玩家页面另由trace.cocos.web-orders-loop及真实浏览器验证。不新增接单、刷新、聚合/部分交付、评分奖励或数量/时间/重复输入规则。

## 网页玩家入口与既有领域保护

现有订单域和v43状态/截止保护不变。第五网页沿公开只读需求与既有菜单提交真实DishLot，节点/选择/反馈由outer负责；需求匹配仍只在DemandResolver，基础奖励不是最终奖励预测。trace.orders.legal-state-deadline保留领域保护追踪，trace.cocos.web-orders-loop另追踪玩家页面、公开数据及真实浏览器链；不新增接单/刷新、评分或多菜品规则。
