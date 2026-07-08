# 接入 PiSdkDriver 创建真实会话并发送首条消息

## What to build

接入 PiSdkDriver，让用户可以在已验证配置下创建真实 Pi SDK session，并发送第一条用户消息。

这一张 issue 交付最窄真实闭环：Renderer 输入消息，Preload 转发，Main 调 DesktopAppStore，DesktopAppStore 调 PiSdkDriver，PiSdkDriver 调 Pi SDK。

## Acceptance criteria

- [ ] 已验证配置后，用户可以创建一个新会话。
- [ ] 新会话使用默认 `agentId = "tangyuan"`，Pi SDK `cwd = ~/.tangyuan/agents/tangyuan`。
- [ ] 创建会话时读取并注入已存在的 `soul.md` / `user.md`；未初始化时进入 bootstrap 会话。
- [ ] 用户发送消息后，消息立即显示在 transcript。
- [ ] PiSdkDriver 调用真实 Pi SDK session 发送消息。
- [ ] Renderer 不直接 import Pi SDK，Pi SDK 只出现在 `packages/agent-runtime` 内部。
- [ ] 无有效配置时发送消息会被阻止，并显示可理解错误。
- [ ] 测试使用 mock Pi SDK 覆盖 Main/AppStore/Driver 行为；真实 SDK 集成检查可作为手动步骤。

## Blocked by

- 建立 Driver、RuntimeSnapshot 与 IPC 契约
- 实现 Provider/API Key/Model 配置与真实 SDK 验证
