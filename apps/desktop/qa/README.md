# 自动化 QA：真实模型对话冒烟

用 Playwright 驱动**真实 Electron 应用** + **真实大模型对话**做全链路冒烟，检测到技术层面异常时自动创建 GitHub issue。供本地手动运行或 Hermes 定时任务调度。

## 设计：硬骨架 + 探索空间

- **硬骨架（写死）**：启动应用 → 健康检查 → 运行时就绪 → 发消息等真实回复 → 技术不变量断言 → issue 去重与创建。判据**仅在技术层面**（崩溃 / 未捕获异常 / 控制台 error / 无回复 / 超时 / 非法运行状态），**不判断模型回复内容质量**（那由模型决定）。
- **探索空间（Hermes 决定）**：测什么内容的消息，通过 `QA_MESSAGE` 环境变量传入。判据始终是同一套硬骨架，场景是活的、判据是死的，保证可回归对比。

## 覆盖的场景

当前 spec 覆盖以下真实使用场景，均用同一套技术不变量判定：

| 场景 | 验证点 |
| --- | --- |
| 应用健康 | 不崩溃、无未捕获异常、无 console error、不白屏 |
| 运行时就绪 | Provider/Model/Key 可用，status=ready |
| 单轮对话 | 新建会话→发消息→收到真实回复；会话出现在列表 |
| 多轮上下文 | 同一会话连发两条，状态机合法、无错误 |
| 重试 | 对已发消息 retryMessage，产生新回复且无错误 |
| 运行中取消 | 收到首个 running 后立即取消（尽力而为：不把无回复当违反，但状态机与 Runtime 错误仍硬断言） |
| Agent 列表 | listAgents 含默认 Agent、状态合法（只读，不改 Agent 状态） |

要新增场景：在 `qa/lib/` 里加能力积木（如新的不变量检查），在 `qa/real-conversation.qa.ts` 里加一个 `test(...)`。判据始终复用同一套技术不变量，不引入“判回复质量”的新判据。

## 为什么用独立数据目录 + 环境变量注入 key

日常 app 的 API Key 用 macOS `safeStorage`（钥匙串）加密存在 `~/.tangyuan/config.json`。Playwright `electron.launch()` 启动的进程**无法解密**它（钥匙串主体不同）。因此 QA 模式：

- main 进程检测到 `TANGYUAN_QA_API_KEY` 时，改用**明文加密适配器**（不碰 safeStorage）；
- 使用**独立数据目录** `~/.tangyuan-qa-root/`，与用户日常 `~/.tangyuan` 完全隔离；
- 测试 key 由环境变量注入，不落进 repo。

## 运行

```bash
# 前置：需已构建（qa 脚本会自动 build；qa:nobuild 复用现有产物）
cd apps/desktop

# 用真实 key 跑（happy path）
TANGYUAN_QA_API_KEY='<deepseek 明文 key>' \
TANGYUAN_QA_PROVIDER='deepseek' \
TANGYUAN_QA_MODEL='deepseek-v4-flash' \
pnpm qa

# 检测到技术异常时自动提 issue（默认只报告不提）
TANGYUAN_QA_API_KEY='...' QA_FILE_ISSUES=1 pnpm qa

# Hermes 指定测试场景
TANGYUAN_QA_API_KEY='...' QA_MESSAGE='帮我读一下 README 并总结' pnpm qa
```

## 环境变量

| 变量                   | 必填 | 说明                                          |
| ---------------------- | ---- | --------------------------------------------- |
| `TANGYUAN_QA_API_KEY`  | 是   | 测试用大模型明文 API Key（触发 QA 模式）      |
| `TANGYUAN_QA_PROVIDER` | 否   | Provider id，默认 `deepseek`                  |
| `TANGYUAN_QA_MODEL`    | 否   | Model id，默认 `deepseek-v4-flash`            |
| `QA_MESSAGE`           | 否   | 发送的消息内容，默认一句自我介绍              |
| `QA_FILE_ISSUES`       | 否   | 设为 `1` 时检测到违反才真正 `gh issue create` |

## issue 去重

每类技术不变量有固定 `code`（如 `empty-reply`、`reply-timeout`、`console-error`）。提 issue 前按标题里的 `[QA:<code>]` 标记搜索已有 open issue，同类问题只提一次，避免定时任务刷屏。issue 打 `待评估` + `bug` 标签。

## Hermes 定时任务配置要点

1. 在 Hermes 运行环境里配 `TANGYUAN_QA_API_KEY`（用独立测试 key，勿用日常 key）。
2. 定时执行 `cd apps/desktop && QA_FILE_ISSUES=1 pnpm qa`。
3. 退出码：`0` 全过；非 `0` 表示检测到技术异常（已按去重规则提 issue）。
4. 频率建议保守：每次都真实消耗 token，且真实模型回复非确定，不宜高频。

## 不做的事

- 不判断模型回复内容对不对（模型决定）。
- 不进 CI（依赖真实 key、真实模型、本机环境）。
- 不碰用户日常 `~/.tangyuan` 配置。
