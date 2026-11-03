# 更新记录

## v0.0.3.0 — WeChat Stage1A Pilot（M1候选）

新增独立最小微信小游戏outer、共享固定来源准备链、独立微信构建/防篡改记录及运行包只读candidate_id。真实Button沿既有公共Host/Binding/Queue执行advance_time；临时内存新局，不提供存读档UI。

保留旧Web功能与来源保护、核心/SaveFile/正式资源和全部追踪，登记两项full/blocker测试及authoritative新模块边界。当前只交M1候选；真实Creator/官方工具/输入/重载、Web回归与CI以包外实际证据为准，M2—M4尚未实现或验收。不自动合并、打稳定tag或发布。

### 正式Schema构建期预编译兼容

微信prepare使用已锁定Ajv standalone生成全部正式Schema校验器，明确注入公共bootstrap。核心可选显式集合完整校验路径/ID/Schema内容及同步函数，默认Node/Web保持原动态路径；缺失、错配或无效集合拒绝，不回退或跳过校验。现bootstrap full/blocker任务执行新增受控测试，正式资源和业务契约不变，其他AOT与M2—M4不开放。

### 微信DTO复制目标兼容

微信runtime仅通过esbuild inject局部绑定纯DTO structuredClone适配，保留undefined、别名/循环和数组空位，不支持输入及transfer明确拒绝。无全局修改、核心源反向import或默认Web变化；原runtime任务执行新增对比/失败保护测试，仍为M1候选。
