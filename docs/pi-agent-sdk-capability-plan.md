# Pi Agent SDK 能力清单与支持计划

> 本文记录汤圆对 Pi Agent SDK 能力的理解、取舍和支持顺序。
>
> 目标不是一次性吃完 SDK，而是把能力拆开，按产品闭环逐个接入、验收和测试。

## 资料来源

- Pi SDK 官方文档：https://pi.dev/docs/latest/sdk
- Pi 安全说明：https://github.com/earendil-works/pi
- Pi CLI 使用文档：https://pi.dev/docs/latest/usage
- Pi 容器化文档：https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/containerization.md

本文只记录架构决策，不记录任何 API Key、token 或真实密钥。

## 支持原则

- 第一版直接使用 Pi Agent SDK，不做产品级 FakeDriver。
- 测试中允许 mock Pi SDK，避免快速测试依赖真实模型调用。
- Renderer 不直接导入 Pi Agent SDK。
- Pi Agent SDK 只允许出现在 `PiSdkDriver` 所在运行时模块内部。
- 所有 SDK 事件进入 UI 前必须转成汤圆自己的统一事件。
- 每项 SDK 能力必须有独立 issue、验收标准和测试方式。
- 涉及文件、命令、写入、工具执行的能力默认保守开启。
- v1 只实现默认 Agent：`tangyuan`。
- 架构命名和数据结构必须为后续多 Agent 预留 `agentId`。

## Agent Home 与 Bootstrap

v1 首次启动时创建默认 Agent 工作空间：

```txt
~/.tangyuan/
  agents/
    tangyuan/
      bootstrap.md
      soul.md
      user.md
      soul.history/
      user.history/
      memory/
      skills/
```

规则：

- 默认 `agentId` 是 `tangyuan`。
- Pi SDK 的 `cwd` 使用 `~/.tangyuan/agents/tangyuan`。
- v1 不创建额外 `workspace/` 目录。
- `bootstrap.md`、`soul.md`、`user.md`、`memory/`、`skills/` 都属于该 Agent。
- 工具默认以当前 Agent 的 `cwd` 为工作目录；这不是强制路径隔离。
- 后续多 Agent 使用 `~/.tangyuan/agents/<agentId>`，每个 Agent 有独立 `cwd`、`soul.md`、`user.md`、`memory/` 和 `skills/`。

首次使用流程：

1. 应用创建 `~/.tangyuan/agents/tangyuan/bootstrap.md`。
2. 用户先完成 Provider、API Key 和 Model 配置。
3. 配置通过真实 SDK 验证后进入第一次对话。
4. 第一次对话根据固定 `bootstrap.md` 模板向用户提问。
5. bootstrap 问答完成后，Agent 生成 `soul.md` 和 `user.md`。
6. Agent 通过 Pi SDK 内置 `write` / `edit` 工具写入 `soul.md` 和 `user.md`。
7. Agent 通过 Pi SDK 工具删除 `bootstrap.md`。
8. 后续 session 创建时读取并注入 `soul.md` 和 `user.md`。

约束：

- bootstrap 对话算普通 session，进入历史列表。
- 删除 `bootstrap.md` 后，可以从首次会话追溯 `soul.md` 和 `user.md` 的来源。
- Renderer 不直接读写 `soul.md`、`user.md` 或 `bootstrap.md`。
- v1 不做 Memory/Skill 自动写入，只创建目录和保留架构位置。
- 如果 `soul.md` 缺失且 `bootstrap.md` 存在，继续 bootstrap。
- 如果 `soul.md`、`user.md` 和 `bootstrap.md` 都缺失，重建固定 `bootstrap.md`。
- v1 支持 Agent 根据会话内容自行判断是否更新 `soul.md` 和 `user.md`。
- `soul.md` 和 `user.md` 更新不需要用户审批。
- v1 先使用 Pi SDK 内置 `read`、`write`、`edit`、`grep`、`find`、`ls` 工具完成 profile 文件读写。
- Agent 更新 `soul.md` 和 `user.md` 时直接通过 Pi SDK 工具修改文件，不先经过汤圆自定义写入逻辑。
- Pi SDK 支持按工具名 allowlist / exclude，但没有内置路径级权限系统。
- `cwd` 用于给内置工具设定工作目录，但不是强 sandbox。
- v1 不宣称能强制阻止 Agent 访问 `cwd` 外文件；这属于后续安全增强。
- 写入新版 `soul.md` 前必须把旧版本备份到 `soul.history/`。
- 写入新版 `user.md` 前必须把旧版本备份到 `user.history/`。
- `soul.md` 或 `user.md` 更新后当前 session 立刻使用新版上下文，并记录一次上下文刷新事件。
- `soul.md` 或 `user.md` 更新后 UI 显示一条系统消息，例如“已更新 Agent 规则”或“已更新用户画像”。
- `soul.md` 和 `user.md` 禁止写入 API Key、token、密码或密钥。

固定 `bootstrap.md` 模板必须覆盖这些问题：

1. 用户希望汤圆怎么称呼自己。
2. 用户希望汤圆默认使用什么语言、语气和沟通密度。
3. 用户主要希望汤圆帮助完成哪些工作。
4. 哪些操作必须先征求用户确认。
5. 哪些目录、文件、信息永远不能触碰或泄露。
6. 用户希望汤圆如何记录长期偏好和项目经验。
7. 汤圆在失败、不确定或缺少上下文时应该如何处理。
8. 哪些规则必须写入 `soul.md` 并长期遵守。

`soul.md` 必须记录 Agent 人格和行为规则，并包含这些部分：

```md
# 汤圆 Soul

## 身份

## 用户偏好

## 工作范围

## 沟通方式

## 权限边界

## 敏感信息规则

## 记忆与技能原则

## 不确定时的处理方式
```

`user.md` 必须记录 Agent 对用户的用户画像，并包含这些部分：

```md
# 用户画像

## 称呼

## 语言与语气偏好

## 常见工作类型

## 决策偏好

## 需要先确认的事项

## 禁止触碰的信息和边界

## 长期偏好
```

## SDK 能力总览

Pi Agent SDK 至少包含这些能力：

| 能力 | SDK 入口或概念 | 汤圆处理方式 |
| --- | --- | --- |
| 创建会话 | `createAgentSession()` | v1 必须支持 |
| 发送消息 | `AgentSession.prompt()` | v1 必须支持 |
| 流式事件 | `AgentSession.subscribe()` | v1 必须支持 |
| 取消运行 | `AgentSession.abort()` | v1 必须支持 |
| 模型控制 | `setModel()`、`ModelRegistry` | v1 必须支持基础选择 |
| API Key / 认证 | `AuthStorage` | v1 使用本地 config JSON 明文存储 |
| 会话状态 | `messages`、`isStreaming`、`agent.state` | v1 映射为汤圆会话状态 |
| 内置工具 | `read`、`bash`、`edit`、`write`、`grep`、`find`、`ls` | v1 使用只读工具，并为 Agent profile 文件开放 `edit` / `write` |
| 自定义工具 | `defineTool()` | v1 不支持 |
| Skills | `DefaultResourceLoader`、`skillsOverride` | v1 不支持 |
| Extensions | `ResourceLoader`、extension runtime | v1 不支持 |
| Prompt Templates / Slash Commands | prompts、templates | v1 不支持 |
| Context Files | AGENTS/context files | v1 只保留架构兼容，不做 UI |
| Session Management | persistent/open/list/fork/import | v1 使用 Pi SDK 原生 session 持久化 |
| Compaction | `compact()`、compaction events | v1 不支持 |
| Thinking Level | `setThinkingLevel()` | v1 可后置 |
| Images | prompt images | v1 不支持 |
| RPC / JSON Event Stream | SDK 运行模式 | v1 不支持 |

## v1 必须支持

### 1. 创建真实 SDK 会话

汤圆必须能通过 `PiSdkDriver` 创建真实 Pi Agent SDK 会话。会话创建发生在 Electron Main 侧，不发生在 Renderer。

验收标准：

- 配置有效时可以创建会话。
- 配置缺失时 UI 显示可理解错误。
- Renderer 无法直接访问 SDK 对象。

### 2. 发送用户消息

用户在 UI 输入消息后，Main 通过 `PiSdkDriver` 调用 SDK 发送消息。

验收标准：

- 用户消息立即进入 transcript。
- SDK 接受消息后进入运行中状态。
- 运行中同一会话不能重复发起第二个并发回复。

### 3. 流式接收事件

Pi SDK 的 `subscribe()` 事件必须转成汤圆事件，UI 不理解 SDK 原始事件结构。

v1 最小事件：

- `turn-started`
- `message-delta`
- `message-completed`
- `turn-failed`
- `turn-cancelled`

后续可扩展事件：

- `thinking-delta`
- `tool-started`
- `tool-updated`
- `tool-completed`
- `queue-updated`
- `compaction-started`
- `compaction-completed`

### 4. 取消运行

用户可以取消当前会话中的当前运行。

验收标准：

- 取消按钮只在运行中可用。
- 取消后 SDK 收到 abort。
- UI 状态进入 cancelled。
- 已产生的部分内容仍保留在会话历史中。

### 5. Provider / API Key / Model 配置

v1 使用本地 config JSON 保存配置，包括 API Key。

规则：

- config JSON 放在 Electron `app.getPath("userData")` 下。
- API Key MVP 阶段明文保存。
- UI 默认遮罩 API Key。
- 日志、错误、测试 fixture 禁止打印真实 API Key。
- 后续安全方案另开 issue，不阻塞 v1。
- 保存配置前必须做一次真实 SDK 验证。
- 验证失败时不保存 config JSON。

配置验证流程：

1. 用户输入 Provider、API Key 和 Model。
2. Main 将 API Key 临时注入 SDK runtime，不立即持久化。
3. Driver 检查模型是否存在或可用。
4. Driver 创建临时 SDK session。
5. Driver 禁用工具，发送最小验证 prompt。
6. 验证成功后保存 config JSON 并进入工作台。
7. 验证失败时留在配置页，显示脱敏错误。

验证约束：

- 验证会消耗一次最小模型调用。
- 验证过程不写会话历史。
- 验证 session 不进入会话列表。
- 验证错误必须脱敏，不输出完整 API Key。
- 用户可以取消验证。

### 6. 会话历史保存和恢复

v1 使用 Pi SDK 原生 session 持久化作为会话历史的真实来源。汤圆自己的 JSON 只保存 UI 索引、摘要和补充元数据。

SDK 能力：

- `SessionManager.create(cwd)` 创建新的持久 session。
- `SessionManager.open(path)` 打开指定 session 文件。
- `SessionManager.continueRecent(cwd)` 继续最近 session。
- `SessionManager.list(cwd)` 列出当前项目 session。
- `SessionManager.listAll(cwd)` 列出所有 session。
- `AgentSession.sessionFile` 暴露当前 session 文件路径。
- `AgentSession.messages` 暴露当前 session 消息。
- `AgentSessionRuntime` 支持 `newSession()`、`switchSession()`、`fork()` 和 import flows。

v1 规则：

- Pi SDK session 是 transcript 的 source of truth。
- 汤圆不复制完整 transcript，除非 SDK 无法稳定读取消息。
- 汤圆 JSON 只保存会话列表展示和产品补充字段。
- 打开历史会话时通过 SDK reopen/switch 到对应 session。
- SDK session tree、fork、import UI 不进入 v1。

推荐结构：

```txt
userData/
  config.json
  sessions/
    index.json
```

`index.json` 推荐字段：

```ts
type SessionIndexItem = {
  sessionId: string;
  sdkSessionFile: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  provider: string;
  model: string;
  agentId: string;
  lastMessagePreview: string;
  status: "idle" | "running" | "completed" | "cancelled" | "failed";
};
```

索引写入规则：

- `index.json` 使用临时文件加 rename 的原子写策略。
- 索引丢失时可以通过 SDK session list 尝试重建。
- SQLite、Markdown、双写方案放到第二阶段评估。

### 7. Agent 自更新 `soul.md` 和 `user.md`

v1 允许 Agent 在对话中根据用户明确表达的偏好、约束或纠正，自行判断是否更新 `soul.md` 和 `user.md`。

更新流程：

1. Agent 从会话中判断需要更新 `soul.md` 或 `user.md`。
2. Agent 通过 Pi SDK `read` 工具读取当前文件。
3. Agent 通过 Pi SDK `write` 工具把旧版本写入对应 history 目录。
4. Agent 通过 Pi SDK `edit` 或 `write` 工具写入新版文件。
5. 当前 session 刷新 Agent 上下文。
6. UI 显示自动更新系统消息。
7. 后续 session 注入新版 `soul.md` 和 `user.md`。

更新频率：

- 每轮主回复结束后最多启动一次 profile 维护回合。
- profile 维护回合使用同一 Agent context，但作为后台维护任务运行，不混入用户主回复。
- 只有明确偏好、边界或长期规则变化才更新。
- 单轮最多更新一次 `soul.md`，一次 `user.md`。
- 内容无实质变化时不写文件。
- 连续小变化可以合并后写入。

禁止行为：

- 使用 `bash` 修改 `soul.md` 或 `user.md`。
- Renderer 直接写入 `soul.md` 或 `user.md`。
- 未备份旧版本就覆盖 `soul.md` 或 `user.md`。
- 把 API Key、token、密码或密钥写入 `soul.md` 或 `user.md`。

bootstrap 完成判定：

- bootstrap 使用固定问题清单。
- Agent 可以根据用户回答自行判断是否需要追问。
- Agent 自行判断 bootstrap 是否完成。
- bootstrap 完成后必须生成 `soul.md` 和 `user.md`，并删除 `bootstrap.md`。
- v1 不要求用户点击“完成初始化”按钮。

## v1 工具权限

### 内置工具权限

Pi SDK 内置工具包括：

- `read`
- `bash`
- `edit`
- `write`
- `grep`
- `find`
- `ls`

这些工具会触碰本地文件或命令执行能力，v1 按最小范围开放。

v1 策略：

- 默认开放 `read`、`grep`、`find`、`ls`。
- 为 `bootstrap.md`、`soul.md`、`user.md`、`soul.history/` 和 `user.history/` 开放 Pi SDK `edit` / `write`。
- `bash` 默认禁用。
- 使用 `cwd = ~/.tangyuan/agents/tangyuan`。
- 使用 prompt / context 约束 Agent 只修改 Agent profile 文件。
- 不把上述策略描述为安全 sandbox；Pi 默认跟随启动进程权限运行。
- 后续如果需要强边界，评估 Pi 容器化、Gondolin、OpenShell 或自定义包装工具。
- UI 显示工具开始、结束、失败，不展示复杂工具详情。

## v1 不支持

这些能力不进入第一版：

- 自定义工具。
- Skills 管理。
- Extensions 管理。
- Prompt Templates / Slash Commands 管理。
- 自动 Context Files 管理 UI。
- Compaction 操作 UI。
- Thinking Level 设置 UI。
- 图片输入。
- RPC 模式。
- JSON Event Stream 模式。
- Pi SDK 原生 session fork/import UI。
- 自动 Memory 写入。
- Skill 自进化。

## 支持顺序

建议 issue 顺序：

1. 初始化 pnpm workspace、Electron Vite、React、TypeScript。
2. 定义 `AgentSessionDriver`、统一事件类型和 `RuntimeSnapshot`。
3. 实现默认 Agent Home 初始化和固定 `bootstrap.md`。
4. 实现 config JSON 存储，保存 Provider、Model、API Key。
5. 实现配置保存前的真实 SDK 验证。
6. 实现 `PiSdkDriver` 创建真实 SDK 会话。
7. 实现 Renderer -> Preload -> IPC -> Main -> `PiSdkDriver` 消息链路。
8. 使用 Pi SDK 工具实现 bootstrap 问答、`soul.md` / `user.md` 写入和 `bootstrap.md` 删除。
9. 使用后台 profile 维护回合实现 Agent 自动更新 `soul.md` / `user.md`、历史备份和系统消息。
10. 映射 SDK 流式事件到汤圆事件。
11. 实现取消运行。
12. 实现 Pi SDK session 持久化与汤圆 session index。
13. 接入 v1 工具权限：只读工具 + Agent profile 文件 `edit` / `write`。
14. 做打包 smoke test。

## 后续阶段候选能力

第二阶段及以后可逐项支持：

- 只读工具详情展示。
- `bash` 白名单。
- 用户项目文件的 `edit` / `write` 用户确认机制。
- Thinking Level 设置。
- Prompt Templates / Slash Commands。
- Context Files 管理。
- Skills 管理。
- Extensions 管理。
- SQLite 或 Markdown 存储。
- Memory 写入建议。
- 后台复盘 Worker。
- 自有 Agent Runtime。
