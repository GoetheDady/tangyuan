# 桌面端打包 smoke test 与真实 SDK 集成验收

本文记录 issue #10 的本地验收方式。

这里的 **smoke test（冒烟测试）** 指最小启动验证：不覆盖所有业务细节，只确认打包产物能启动到关键页面。这里的 **集成验收** 指把多个真实模块连起来验证，例如 Electron、Pi SDK、配置文件、会话持久化一起跑通。

## 自动打包 smoke test

在 macOS 上运行：

```bash
pnpm smoke:packaged:mac
```

该命令会执行以下步骤：

1. 运行 `apps/desktop` 的生产构建。
2. 使用 `electron-builder --mac --dir` 生成可启动的 `.app` 包。
3. 启动 `.app` 内部的 macOS 可执行文件。
4. 设置临时 `HOME`，让应用在隔离目录中读取或创建 `~/.tangyuan/agents/tangyuan`。
5. 等待 Renderer 显示配置页或工作台。
6. 将 Main 进程自检结果写入临时 JSON，并根据结果退出。

`--dir` 会生成未压缩的 `.app` 目录，适合本地快速 smoke test。需要产出正式 macOS 分发包时运行：

```bash
pnpm package:mac
```

## 本地质量门禁

提交前运行：

```bash
pnpm verify:local
```

该命令会依次运行：

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`

这里的 **lint** 指静态代码风格和常见问题检查；**typecheck** 指 TypeScript 类型检查，也就是确认代码里的类型约束能通过编译器验证；**test** 指自动化测试。

## 真实 SDK 手动验收

真实模型调用依赖有效 API Key，且可能产生费用或受网络影响，所以不放进默认自动化脚本。手动验收时执行：

1. 运行 `pnpm package:mac`，确认 `apps/desktop/dist/` 下产出 macOS 应用包。
2. 启动打包后的应用。
3. 确认应用显示配置页或工作台。
4. 确认默认 Agent Home 已存在：`~/.tangyuan/agents/tangyuan`。
5. 在配置页填写 Provider、API Key、Model。
6. 点击“验证并保存”，确认失败时不会保存 API Key，成功时进入工作台。
7. 创建新会话，发送一条测试消息。
8. 确认用户消息立即出现在 transcript 中。**Transcript** 指会话记录，也就是用户和 Agent 消息的时间顺序列表。
9. 确认 Agent 响应会更新到页面，并且运行状态从“运行中”变为“已完成”或失败状态。
10. 发送一条较长任务后点击“取消”，确认状态变为“已取消”。
11. 退出并重新启动应用，确认会话列表和历史 transcript 能恢复。

## API Key 安全要求

真实 API Key 不得写入以下位置：

- Git 仓库文件。
- 测试 fixture。**Fixture** 指测试用的固定输入数据或样例文件。
- 日志。
- 截图。
- PR、issue、提交信息或文档。

如果需要记录验收证据，只记录脱敏形式，例如 `sk-...abcd`，不要记录完整密钥。
