---
doc_type: module_card
status: active
applies_to: cocos-wechat-probe
source_of_truth: false
---

# cocos-wechat-probe

## 模块职责与读取入口

本轮唯一目标是v0.0.3.0内的M1候选：从固定源码可重复派生最小微信小游戏工程，运行包只读显示candidate_id与短commit，真实Cocos Button通过既有公共Host/Binding/Queue和ActionPipeline推进一小时。独立微信构建与来源记录供官方开发者工具核场景、日志、真实输入、正式结果及重载身份。当前仅M1候选，M2微信存储/生命周期、M3完整经营链和M4手机验收尚未实现或验收；版本名称不代表大版本已完成。

独立apps/cocos-wechat-probe模块只消费派生公共runtime与正式资源，可使用cc，禁止wx/fs、业务内部、工具和测试依赖；旧三层不得反向依赖它。临时InMemorySaveStoragePort只用于新局，不提供存读档UI、微信持久化、自动保存或前后台恢复。不进入 Stage 1B，不改变 ActionPipeline，不改变 SaveFile，不改变正式 fixture；planned wx-storage-port仍不是当前实现。

- `apps/cocos-wechat-probe/template/assets/scripts/CocosWechatProbe.ts`：真实cc场景、资源加载、Label/Button与只读观察。
- `apps/cocos-wechat-probe/template/assets/scripts/WechatProbeController.ts`：无cc的资源/身份校验、公共Host/Binding、busy和销毁迟到保护；只提交既有advance_time。
- `tools/cocos-probe/lib/prepareProject.mjs`：固定共享生产者，不开放任意template/runtime入口/BuildId角色。
- `tools/cocos-wechat-probe/prepare.mjs`：prepareWechatProbe({rootDir?, outputDir, appId})，固定wechat profile。
- `tools/cocos-wechat-probe/build.mjs`：buildWechatProbe({creator, project, logDir})，独立微信记录；rootDir仅受控fixture入口，CLI不能选择。
- `tools/cocos-wechat-probe/lib/source.mjs`和`tools/cocos-wechat-probe/lib/sourceProvenance.mjs`：准备/构建关联、实际Git输入与依赖、工具字节及微信产物树摘要。

## 来源、身份与外部配置

prepare固定web/wechat内部profile，共享tools/cocos-probe/lib/prepareProject.mjs，保留旧Web prepareCocosProbe/readProbeResources签名、默认格式、角色与CLI。两条链均继承绝对空目录/路径隔离/symlink、正式58Schema、实际源与依赖摘要、公共bootstrap preflight、来源重读和排他写入。微信candidate_id由唯一生产者在冻结outputs前生成，来自当前生成资源assets/resources/candidate-identity.json；不取自SaveFile。每个新构建要求新候选和新空目录，已有构建或失败不静默复用身份；相同version/commit的候选仍可区分。最终产物摘要只在包外保存，明确目录树/ZIP/二维码范围，不嵌回自身；本轮不上传或发码。

AppID由明确本地参数提供，派生工程和开发者工具配置位于仓库外；不把账号凭据或AppID硬编码到源模板。微信BuildId沿project-target的snakeVersion经deriveBuildId('cocos_wechat_probe', ...)派生；candidate_id另行生成，不改变原版本/BuildId与存档语义。固定候选要求完整commit及dirty=false；开发dirty来源须明确记录，不能称固定候选。

## 修改后验证

test:cocos-wechat-preparation / test.cocos-wechat-preparation实际执行tests/cocos-wechat-preparation.test.mjs；test:cocos-wechat-runtime / test.cocos-wechat-runtime实际执行tests/cocos-wechat-runtime.test.ts，均为full/blocker。trace.cocos.wechat-m1连接新outer、共享生产者、微信构建、候选身份、架构负例和质量登记。Node只能证明受控准备/行为契约；真实Creator3.8.8/SDK、官方微信工具场景/输入/日志/重载、受影响Web回归和最终提交CI各自验收。旧全部追踪、权威架构禁令和Web功能/来源检查保留，不以修改阈值、预期、CI或affected算法通过门禁。

版本完成仍按q:full和无缓存q:release，真实平台结果写包外报告。运行工具只读observer不得提供执行命令替代真实Button输入。相同候选重载后仍须核运行身份；M1内存新局重载不承诺恢复进度，不用它冒充M2平台读档。

## 地图同步

维护module-graph、authoritative import/token边界、test-registry、traceability-map、cocos/runtime/quality地图和files/public-api。旧Web与旧三层禁令保留，不扩大白名单。决定见[ADR-0005](../adr/ADR-0005-independent-wechat-m1-outer.md)。

## 微信Schema预编译

正式Schema构建期预编译仅用于微信M1的动态编译兼容：微信prepare使用当前锁定Ajv standalone，沿既有strict=false、allErrors=true、allowUnionTypes=true校验选项编译全部58项正式Schema，并生成安全ESM导出及明确ID映射。不改正式Schema或业务校验语义，不新增依赖，不猴补Function/eval或使用恒true替代校验器；其他AOT仍不在当前范围。

微信compileWechatSchemas位于tools/cocos-wechat-probe/lib/precompiledSchemas.mjs，在唯一prepare生产链冻结outputs前生成wechat-precompiled-validators.mjs、wechat-schema-precompile.json及wechat-runtime-entry.mjs。前两者记录安全schema_NNN导出/ID映射、完整Schema内容、编译器版本与选项、实际CommonJS编译器依赖闭包及生成摘要；Node编译器依赖通过Ajv入口的require.cache闭包记录，不能冒称由esbuild运行bundle的metafile捕获。facade显式注入precompiledValidators后再打包到assets/generated/probe-runtime.js，Cocos不直接导入额外standalone文件。核心的绑定检查不以自声明元数据证明函数可信；真实Ajv生成代码及工具/源/依赖字节由prepare和构建来源记录约束。

tests/runtime-precompiled-schema.test.ts进入现有test:stage1a-bootstrap / registry test.stage1a-bootstrap实际args/files/covers，沿用full/blocker，不新增任务或降低门禁。该测试覆盖禁用动态Function后的正式启动/合法动作及坏请求、集合/内容拒绝；微信preparation契约覆盖实际facade、全部Schema、来源与生成物篡改，资源预检标记为node-aot-public-bootstrap-passed。Web旧resourcePreflight和默认动态路径保持。Node不替代新提交的Creator/SDK、微信真实输入/日志/重载、Web回归或审查/CI。
