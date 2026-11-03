# ADR-0005：独立微信M1外层与候选身份

## 状态

Accepted

## 决策

新增cocos-wechat-probe，源位于apps/cocos-wechat-probe；它与既有Web outer并列，允许真实cc，禁止直接wx/fs以及核心内部、测试、工具和旧Web模块依赖。game-core、cocos-app、creator-adapter的隔离与逆向依赖禁令保持，正式动作仍沿公共Host/Binding/Queue及ActionPipeline。

最小M1仅提供只读candidate_id/短commit、状态/时间和推进一小时Button。正式资源通过固定共享prepareProject生产者派生，身份在outputs冻结前写入candidate-identity生成资源；每个新构建使用新候选和新空目录。新微信prepare/build/source/provenance记录与Web格式分离，保留所有既有防篡改检查，不把Web产物当微信工程。

M1注入临时InMemorySaveStoragePort只建新局，没有存读档UI，也不接微信存储或前后台API。候选身份只取当前运行工程生成资源，不依赖SaveFile。版本/BuildId仍从project-target派生；完整commit、工具/配置、最终产物摘要及摘要范围留包外，不回填整包自身。

## 后果与验收边界

不改变核心业务规则、SaveFile、正式Action/config/Schema/fixture。M2微信存储/生命周期、M3完整经营、M4真机尚未实现或验收；Stage1B planned wx-storage-port不转active。Node准备/受控运行与架构负例进入full/blocker，Creator/SDK、官方工具真实输入/日志/重载、Web回归及最终提交CI分别留证，不互相替代。大版本名称不表示M1或真机已通过。

## 正式Schema构建期预编译

正式Schema构建期预编译仅用于微信M1的动态编译兼容：微信prepare使用当前锁定Ajv standalone，沿既有strict=false、allErrors=true、allowUnionTypes=true校验选项编译全部58项正式Schema，并生成安全ESM导出及明确ID映射。不改正式Schema或业务校验语义，不新增依赖，不猴补Function/eval或使用恒true替代校验器；其他AOT仍不在当前范围。

RuntimeSchemaValidator支持显式PrecompiledSchemaValidatorSet：format为runtime-precompiled-schemas/v1，schemaSources按完整资源路径记录JSON.stringify(schema)，validators按正式$id记录ValidateFunction。Stage1ABootstrapResources的可选precompiledValidators字段透明转交该集合。显式提供集合时不创建Ajv、不回退动态编译；完整路径/ID/内容不匹配、重复或无$id、无效/异步函数及非布尔结果均拒绝。未提供时Node/Web维持原Ajv路径。核心仍不接cc/wx/fs、工具或资源读取。

微信compileWechatSchemas位于tools/cocos-wechat-probe/lib/precompiledSchemas.mjs，在唯一prepare生产链冻结outputs前生成wechat-precompiled-validators.mjs、wechat-schema-precompile.json及wechat-runtime-entry.mjs。前两者记录安全schema_NNN导出/ID映射、完整Schema内容、编译器版本与选项、实际CommonJS编译器依赖闭包及生成摘要；Node编译器依赖通过Ajv入口的require.cache闭包记录，不能冒称由esbuild运行bundle的metafile捕获。facade显式注入precompiledValidators后再打包到assets/generated/probe-runtime.js，Cocos不直接导入额外standalone文件。核心的绑定检查不以自声明元数据证明函数可信；真实Ajv生成代码及工具/源/依赖字节由prepare和构建来源记录约束。

tests/runtime-precompiled-schema.test.ts进入现有test:stage1a-bootstrap / registry test.stage1a-bootstrap实际args/files/covers，沿用full/blocker，不新增任务或降低门禁。该测试覆盖禁用动态Function后的正式启动/合法动作及坏请求、集合/内容拒绝；微信preparation契约覆盖实际facade、全部Schema、来源与生成物篡改，资源预检标记为node-aot-public-bootstrap-passed。Web旧resourcePreflight和默认动态路径保持。Node不替代新提交的Creator/SDK、微信真实输入/日志/重载、Web回归或审查/CI。

这一能力仅扩展平台无关校验器的显式输入及公共bootstrap转交，不改变ActionPipeline、GameRuntime、Session、Dispatcher/Preview、SaveFile或正式资源；不是一般运行时编译框架。
