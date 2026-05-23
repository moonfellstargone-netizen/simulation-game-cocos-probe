# Module Contract：SaveStoragePort

## 模块路径

`src/game-core/save/SaveStoragePort.ts`

## 职责

- 定义平台无关存储端口。
- 提供 `InMemorySaveStoragePort` 用于测试和边界探针。
- 隔离后续真实微信 storage、文件系统或其他平台存储。

## 允许依赖

- TypeScript 标准能力。
- 内存 Map / object 等平台无关结构。

## 禁止依赖

- `wx`。
- `cc`。
- `fs / node:fs`。
- 任何具体平台 SDK。

## 不变量

- 端口只负责读写原始字符串或约定数据，不解释玩法成功。
- 真实平台适配必须通过新 adapter 接入，不得污染 game-core。

## 关联测试

```text
tests/cocos-runtime-session.test.ts
tests/cocos-save-load-ui-binding.test.ts
```
