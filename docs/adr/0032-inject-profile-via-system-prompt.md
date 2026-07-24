# 通过系统提示词注入身份上下文，而非拼进每条消息

## Status

accepted

## 背景

原实现（`buildPromptWithProfileContext`）在每次 `sendMessage` 时，把默认 Agent 的身份上下文（就绪态的 `soul.md` + `user.md`，或初始化阻断态的 `bootstrap.md` 全文与初始化指令）拼在用户消息正文前面，再交给 Pi SDK 的 `handle.prompt()`。

由于 Pi SDK 会话把收到的整段 prompt 作为用户消息持久化进原生 transcript，这带来三个问题：每条用户消息都重复携带完整身份块（浪费 token）；重启后从 SDK transcript 重载，历史里每条用户消息都残留 bootstrap/profile；`bootstrap.md` 删除、或 profile 更新后，旧消息里的过期身份块仍留在历史中无法清除。

## 决定

身份上下文改由 **系统提示词** 承载，不再拼进对话消息：

- 走 Pi SDK `DefaultResourceLoader` 的 `appendSystemPromptOverride`（追加式，不覆盖 Pi 内置系统提示词）。
- 未完成初始化时注入 `bootstrap.md` 与初始化指令；完成后注入 `soul.md` + `user.md`。bootstrap 由 runtime 读取注入，不依赖模型自觉去 read。
- `sendMessage` 只把用户原文交给 `handle.prompt()`，transcript 全程保持干净。
- **是否完成初始化**以文件为唯一真相：`soul.md` 与 `user.md` 均存在且**内容非空**才算完成；空文件不算。不引入完成标记/时间戳。
- 仅在身份可能变化时重算并 `reload()`：建会话时、bootstrap 完成门控（`performBootstrapCompletionGating`）之后、用户在设置中修改 profile 之后。复用已有的 ResourceLoader reload 管线。

## Considered Options

- **拼进每条消息**（原实现）：导致 transcript 污染、token 浪费、过期残留，被否决。
- **只拼进首条消息**：仍进 transcript、仍会过期，被否决。
- **config 中加「完成」标记/时间戳**（参考 OpenClaw）：制造第二真相源，会与文件状态打架，需额外对账机制。由于判定态无论如何都要读文件注入内容，标记省不掉任何读取，属无收益的复杂度，被否决。

## Consequences

- `appendSystemPromptOverride` 签名是同步的 `(base: string[]) => string[]`，函数体内不能读文件。因此身份片段须在 `reload()` 之前异步算好，通过闭包/可变引用喂给 loader，reload 时同步取值。
- 身份变化点必须都记得触发 reload；漏触发会导致系统提示词滞后于文件。
