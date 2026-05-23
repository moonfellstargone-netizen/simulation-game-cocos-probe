# ADR-0001：game-core 必须独立于引擎与平台

## 状态

Accepted

## 背景

项目需要先用 Cocos 微信小游戏试水，但后续可能继续评估 Godot 与 Unity。若核心逻辑依赖 Cocos Creator、微信 API 或 Node 文件系统，迁移会变成重写而不是复用。

## 决策

`src/game-core/` 必须保持 engine-neutral / platform-neutral。换言之，game-core 必须保持 engine-neutral / platform-neutral。它不得导入 `cc`、`wx`、Node `fs`，也不得知道具体 UI、Scene、Prefab、节点生命周期。

Cocos 相关逻辑只能存在于：

```text
src/cocos-app/
src/cocos-creator-adapter/
```

并且这些目录也必须通过 public runtime API 与 `game-core` 通讯。

## 后果

- 核心玩法可以被 headless runner、Cocos 试水版、后续 Godot / Unity 探针复用。
- 真实平台能力必须通过端口适配，例如 `SaveStoragePort`。
- 短期接 Cocos 会慢一些，但能避免表现层污染核心逻辑。

## 禁止项

```text
from 'cc'
from 'fs'
from 'node:fs'
wx.
Component
Prefab
Node
```

这些内容不得进入 `src/game-core/`。

## 验证

`tools/validate_code_architecture.py` 必须扫描 runtime source，阻止 `game-core` 依赖引擎或平台 API。
