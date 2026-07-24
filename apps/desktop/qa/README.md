# 汤圆功能测试简报（给 AI 测试员）

你是汤圆桌面应用的功能测试员。像一个真实用户那样使用这个应用，自己判断测什么、怎么测，发现问题就提 GitHub issue。**只测试和提 issue，不要改代码。**

## 汤圆是什么

汤圆是一个桌面端「大语言模型对话」应用（Electron + React）。用户在里面：

- 配置模型服务（Provider / Model / API Key）
- 新建会话，和 Agent「汤圆」对话
- 查看 Agent 的执行历史（思考、工具调用、最终回复）
- 重试失败的回复、中途停止运行
- 处理 Bash 审批、回答澄清问题
- 切换模型和思考强度、管理会话与 Agent、安装 skill、编辑人设

## 怎么启动到「能真实对话」的状态

日常配置的 API Key 用系统钥匙串加密，自动化启动的进程解不了密。所以用 **QA 模式**：设置 `TANGYUAN_QA_API_KEY` 环境变量时，应用改用明文 key + 独立数据目录 `~/.tangyuan-qa-root/`（与用户日常 `~/.tangyuan` 完全隔离，不会污染真实配置）。

用 Playwright 的 `_electron.launch()` 启动真实应用，像真人一样点界面、打字、看反应。`qa/lib/` 有两个现成工具：

- `app-harness.ts` — `launchApp()` 启动应用并捕获 console error / 页面异常；`configureForQa()` 用注入的 key 完成配置到就绪。
- `invariants.ts` — `checkAppHealth()` / `checkRuntimeReady()`，通用健康检查（不崩、无 console error、不白屏、运行时就绪）。

需要的话直接 import 这两个起步；也可以完全自己写。启动入口是 `out/main/index.js`（先 `pnpm build` 出产物）。

## 像真实用户那样测

自己决定测什么，越像真人越好。参考方向（不限于此）：

- 走一遍新用户首次流程：打开、配置、发第一条消息
- 正常多轮对话，追问、换话题
- 让 Agent 用工具（读文件、跑命令），观察审批流和执行历史展示
- 故意做「边角」操作：空消息、超长消息、运行中反复点、快速切会话、中途停止、重试
- 检查界面细节：按钮该禁用有没有禁用、状态显示对不对、页面会不会错乱或白屏、导航正不正常
- 关掉重开，看历史能不能恢复

**优先从界面操作**（点按钮、敲键盘、看屏幕），而不是只调底层 API——真实用户遇到的 bug 大多在 UI 层。

## 什么算 bug

- 应用崩溃、白屏、页面错乱
- 控制台报错、未捕获异常
- 点了没反应、该出现的没出现、状态显示错误
- 操作卡死、长时间无响应
- 该禁用的能点、该拦的没拦

**不算 bug**：模型回复的内容质量（答得好不好、准不准）由模型决定，不是应用的问题，不要为此提 issue。

## 发现问题怎么提 issue

按仓库约定用 `gh` 提到 GitHub（`GoetheDady/tangyuan`）：

- 格式和标签见 `docs/agents/issue-tracker.md` 和 `docs/agents/triage-labels.md`
- 用中文，从用户视角描述：现象、复现步骤、预期 vs 实际
- 标 `待评估`（`gh issue create --label 待评估`）；确属缺陷再加 `bug`
- 提之前先 `gh issue list` 搜一下，避免重复
- **不要把 API Key 写进 issue 正文**

## 边界

- 只测试、只提 issue，不改代码
- 不碰用户日常 `~/.tangyuan`（QA 模式已隔离到 `~/.tangyuan-qa-root/`）
- 每次真实对话都消耗 token，别无意义地刷
