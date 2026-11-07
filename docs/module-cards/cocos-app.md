---
doc_type: module_card
status: active
applies_to: cocos-probe
source_of_truth: false
---

# cocos-app

## 模块职责

Cocos 试水应用层：Session、ViewModel、Action 适配（Dispatcher、Previewer、DraftBuilder），通过 Port 访问 game-core。

## 不负责什么

- 游戏业务规则定义（在 game-core）
- 真实 Cocos 引擎 API

## 允许依赖

- `game-core`（见 module-graph）

## 禁止依赖

- `cc`、`wx`、`node:fs`、`tests/**`

## 关键文件

- `src/cocos-app/runtime/CocosAppRuntimeSession.ts`
- `src/cocos-app/adapters/CocosActionDispatcher.ts`
- `src/cocos-app/adapters/CocosRuntimeFacade.ts`

## 关键测试

- `tests/cocos-runtime-session.test.ts`
- `tests/cocos-adapter-boundary.test.ts`
- `tests/action-preview-boundary.test.ts`

## 修改前必须读取

- `docs/module_contracts/CocosAppRuntimeSession.contract.md`（遗留契约，保留）

## 修改后必须运行

- `npm run test:cocos-session`
- `npm run test:cocos-adapter`

## 常见失败模式

- dispatch 不经过 ActionPipeline
- preview 产生正式状态变化
- 将存储读取拒绝与空槽混同，或写入拒绝后返回成功摘要
- 只比较单一显示标签，漏掉故障前后完整存档状态的变化

## 代码—地图同步

runtime-map、cocos-map、public-api；存储故障保证见 save-load 模块卡、ADR-0003 与 `trace.save.storage-failure-recovery`。

## 加工最小只读投影

CocosSelectableViewModel.ts公开processing_method_options与processing_task_options：配置要求、只读tool_requirements、候选lot_ids、兼容设施及任务现有status/时间/设施。requirement_index仅为UI槽，不是formal role；工具只作说明，不新增选择或消耗。方法无料仍可查看，旧collectable_task_options保持原shape且仅ready。全部嵌套数组、Quantity与facility_ref复制，expected_output明确为预计，不表示已领取。

tests/cocos-ui-readiness.test.ts核配置来源、新鲜度/形态候选刷新、完整source save/config隔离和active→ready→completed跨新Session读取。沿既有test:cocos-ui-readiness full/blocker，trace.cocos.web-processing-loop连接外层消费；Session、预览器、正式加工参数与加工规则保持。

## 烹饪最小只读投影

CocosSelectableViewModel的cookable_recipe_options按既有CookingSystem规则合并recipe与dish_structure角色要求，候选同时核单位与最低量；公开操作硬边界与偏好、工具设施和配置时间成本说明、燃料当前量/成本。结构min/理想时段不升级成新硬拒绝，配置时间成本不当active_minutes或自动扣时。所有嵌套副本与源save/config隔离；实际DishLot沿既有submittable_dish_lot_options读取，不增通用搬运。

tests/cocos-ui-readiness.test.ts沿原full/blocker验证配置来源、结构形态/单位候选、偏好区分和隔离；trace.cocos.web-cooking-loop连接outer消费。烹饪规则、Session/Queue/SaveFile及正式资源保持。

## 订单选项合法性

CocosSelectableViewModel.order_options只读对齐available/accepted与deadline，严格超过截止及submitted/终态给不可用原因，既有字段含义保持，新增展示字段见下节。enabled只代表订单状态、时限和显示配置允许尝试，不提前复制菜品匹配或奖励算法。trace.orders.legal-state-deadline与tests/cocos-ui-readiness.test.ts、公开preview/Session验证对齐；该只读投影不直接创建页面或新增正式Action，页面消费见trace.cocos.web-orders-loop。

## 订单需求与实际结算只读投影

SelectableVM仅扩展现有order_options，复制issuer/deadline/signed余量、配置需求和实际submitted refs/result_summary。hard、weighted、forbidden/acceptable defects与threshold分开，显示名来自正式Profile文本，缺配置返回null与不可用原因；不将base_reward当预计奖励，不填虚假的成功数字。全部数组、需求项与摘要为深度独立副本，不泄漏SaveFile或配置；StateVM和Session保持。tests/cocos-ui-readiness.test.ts验证来源、缺配置及隔离，tests/cocos-minimal-menu-binding.test.ts验证既有显式选择链；trace.cocos.web-orders-loop连接第五页。

## 跨步骤恢复公共会话

trace.cocos.cross-step-recovery通过tests/stage1a-bootstrap.test.ts验证五保存点的新Host读取、后续真实菜单动作、完整状态及持久ID安全。Session/SelectableVM/StateVM生产接口与算法保持；原有Session失败加载/预览无副作用/ID回归继续执行，恢复列表不能当本次成功。真实网页由verify-web独立输入，Node结果不替代引擎或浏览器。

## 拆分独立只读校验

CocosAppRuntimeSession.validateSplit(sourceLotId, quantity)委托正式InventorySystem.assertCanSplit，只读验证当前会话状态，不执行预览、分配ID或改变SaveFile；失败抛现有正式错误。直接确认后仍由session.dispatch及ActionPipeline处理正式动作，不能据分发后异常推断回滚。

## 微信加工Session边界

CocosAppRuntimeSession的validateStartProcessing与validateCollectProcessing调用正式只读校验，不改变会话或分配领域对象ID；正式Action仍经dispatch。
