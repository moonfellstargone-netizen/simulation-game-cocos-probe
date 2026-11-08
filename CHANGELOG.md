# 更新记录

## v0.0.3.0 — WeChat Stage1A Pilot（M1候选）

新增独立最小微信小游戏outer、共享固定来源准备链、独立微信构建/防篡改记录及运行包只读candidate_id。真实Button沿既有公共Host/Binding/Queue执行advance_time；临时内存新局，不提供存读档UI。

保留旧Web功能与来源保护、核心/SaveFile/正式资源和全部追踪，登记两项full/blocker测试及authoritative新模块边界。M1时点交付候选；真实Creator/官方工具/输入/重载、Web回归与CI以包外实际证据为准，M1时点M2—M4尚未实现或验收。不自动合并、打稳定tag或发布。

### 正式Schema构建期预编译兼容

微信prepare使用已锁定Ajv standalone生成全部正式Schema校验器，明确注入公共bootstrap。核心可选显式集合完整校验路径/ID/Schema内容及同步函数，默认Node/Web保持原动态路径；缺失、错配或无效集合拒绝，不回退或跳过校验。现bootstrap full/blocker任务执行新增受控测试，正式资源和业务契约不变，当时其他AOT与M2—M4不开放。

### 微信DTO复制目标兼容

微信runtime仅通过esbuild inject局部绑定纯DTO structuredClone适配，保留undefined、别名/循环和数组空位，不支持输入及transfer明确拒绝。无全局修改、核心源反向import或默认Web变化；原runtime任务执行新增对比/失败保护测试，仍为M1候选。

## M2微信存储与生命周期

M2运行时改动集中于独立微信outer，并同步构建来源、测试和文档：手动单逻辑槽经Creator sys.localStorage接入平台存储，保存与读取沿既有Session/SaveManager及校验；前后台事件只限制输入与维护会话，不自动存档或补算时间。旧三层及outer直接wx/fs禁令保持，正式SaveFile和玩法不变。

备份与中断保护须同时考虑失败前后可能发生写入：备份、主档与恢复信息分开；读取、恢复和失败路径以源码及针对性测试为准，不能将异常等同于未落盘。故障保护依赖存储键相互独立和可读回一致的有限模型，真实微信断电、设备故障及底层原子性未证明。备份恢复不等于跨平台导入或自动存档。

tests/cocos-wechat-storage.test.ts登记进既有test:cocos-wechat-runtime的args/files，相关源及meta也进入preparation/runtime登记和trace.cocos.wechat-m1。受控Node契约不替代真实Creator、官方微信工具输入/存储/生命周期、最终提交CI或手机验收；具体结果以仓库外证据为准。
