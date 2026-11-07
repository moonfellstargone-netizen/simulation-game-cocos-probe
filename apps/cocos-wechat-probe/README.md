# 微信Stage1A最小运行外层

本目录保存Creator3.8.8源模板。M1场景显示派生运行包的候选编号、短提交号及正式时间，真实Button只通过既有公共绑定和命令队列执行advance_time；正式规则仍由ActionPipeline处理。

使用`cocos:prepare:wechat -- --output <仓库外绝对空目录> --app-id <本项目AppID>`派生工程，再用`cocos:build:wechat -- --creator <Creator绝对路径> --project <派生目录> --log-dir <包外日志目录>`构建。AppID仅由外部参数提供，不写入仓库模板。新构建使用新的空目录和candidate_id，失败候选也不重复构建；原包原字节转发可保留身份。

运行身份由prepare生成的独立只读资源提供，不读取或修改SaveFile身份字段。M2外层接入手动单槽存读档及前后台会话保护；完整经营链属于M3，手机验收属于M4。真实微信平台操作、后台恢复和手机表现须分别验收。

此outer可导入真实cc和派生公共runtime，保持wx/fs及业务内部/测试依赖禁令。正式资源、候选身份、来源清单、工具版本和产物摘要分别核验；Node契约、Creator/SDK、官方开发者工具与手机结果各自留证，代码存在不代表平台验收通过。不要手改派生工程、引擎SDK或来源记录。
