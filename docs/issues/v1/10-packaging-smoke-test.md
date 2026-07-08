# 打包 smoke test 与真实 SDK 集成验收

## What to build

为汤圆 v1 增加打包冒烟测试和真实 SDK 集成验收步骤，尽早发现 Electron 打包后 Pi SDK 依赖、动态资源或原生模块找不到的问题。

这一张 issue 不要求完整发布流水线，只要求能证明打包后的应用可以启动并到达配置页面，且真实 SDK 会话路径有明确验收方式。

## Acceptance criteria

- [ ] 提供 macOS 打包命令，能产出可启动的应用包。
- [ ] 打包后的应用可以启动，并显示配置页或工作台。
- [ ] 打包后的应用可以读取/创建 `~/.tangyuan/agents/tangyuan`。
- [ ] 打包后的应用能进入 Provider/API Key/Model 配置流程。
- [ ] 文档记录真实 SDK 集成验收步骤，包括配置验证、创建会话、发送消息、取消响应、重启恢复历史。
- [ ] 文档记录真实 API Key 不得写入仓库、日志、截图或测试 fixture。
- [ ] CI 或本地脚本至少运行 `pnpm lint`、`pnpm typecheck`、`pnpm test`。
- [ ] 如果真实模型调用不适合自动化，必须提供清晰的手动验收清单。

## Blocked by

- 初始化工程骨架与基础质量门禁
- 建立 Driver、RuntimeSnapshot 与 IPC 契约
- 实现默认 Agent Home 与 profile 文件初始化
- 实现 Provider/API Key/Model 配置与真实 SDK 验证
- 接入 PiSdkDriver 创建真实会话并发送首条消息
- 实现流式事件、运行状态与取消响应
- 实现 Pi SDK session 持久化与会话列表恢复
- 实现 bootstrap 对话生成 soul.md 与 user.md
- 实现后台 profile 维护回合自动更新 soul.md/user.md
