# 汤圆 macOS MVP 发布说明

## 版本

`v0.1.0-macos-mvp`

## 平台支持

本版本**仅正式支持 macOS**（Apple Silicon / Intel）。

Windows 与 Linux 构建脚本已保留，但以下限制意味着它们**不作为可用产品发布**：

- 未在 Windows/Linux 真实设备上完成端到端验收
- Electron `safeStorage` 行为在 Windows/Linux 上不同，加密兼容性未经测试
- Playwright Electron 测试仅在 macOS 上运行
- 打包 smoke test 仅在 macOS `.app` 包上执行

Windows/Linux 构建命令：

```bash
pnpm build:win   # 产出 NSIS 安装包
pnpm build:linux # 产出 AppImage/snap/deb
```

## 安全配置

| 安全措施 | 状态 |
|----------|------|
| Renderer sandbox | `sandbox: true` |
| Context isolation | `contextIsolation: true` |
| Node integration | `nodeIntegration: false` |
| Content Security Policy | `default-src 'self'`，禁止 `unsafe-eval`、远程脚本 |
| API Key 加密 | Electron `safeStorage` 加密保存 |
| 加密降级防护 | `isEncryptionAvailable()` 检查，不可用时拒绝保存 |
| Preload API | 仅通过 `contextBridge.exposeInMainWorld` 暴露类型化 API |
| IPC 输入验证 | Main 进程 Zod schema 二次校验所有 Renderer 请求 |
| 外部链接 | URL 协议白名单（仅 http/https），系统浏览器打开 |
| 原始 HTML | Renderer 不执行，Markdown 转义处理 |

## 质量门禁（全部通过）

| 门禁 | 命令 | 状态 |
|------|------|------|
| Lint | `pnpm lint` | ✅ 0 errors |
| TypeCheck | `pnpm typecheck` | ✅ 全部通过 |
| Unit/Component 测试 | `pnpm test` | ✅ 7 files, 192 tests |
| Playwright Chromium | `pnpm test:e2e:renderer` | ✅ 51/51 |
| Playwright Electron | `pnpm test:e2e:electron` | ✅ 8/8 |
| macOS 构建 | `pnpm build:mac:dir` | ✅ `.app` 产出 |
| macOS Smoke Test | `pnpm smoke:packaged:mac` | ✅ 配置页到达、Agent Home 创建 |

## 发布历史

本版本包含以下 issue 的全部实现（#12–#29）：

- #12: contracts 与 TangyuanRuntime 深模块
- #13: Playwright 真实页面与 Electron 测试基线
- #14: 前端基础栈升级与黑芝麻汤圆主题
- #15: 聊天/控制台路由与 Renderer 沙箱
- #16: 版本化加密配置与配置恢复
- #17: 多 Provider 凭据配置与真实 Pi 验证
- #18: 汤圆 bootstrap 文件门控
- #19: 通过汤圆对话创建自定义 Agent
- #20: Agent 默认模型与当前 session 模型管理
- #21: 多 Agent Pi session 恢复与全局索引重建
- #22: Agent 归档、恢复与目录对账
- #23: 共享用户资料与隔离身份维护
- #24: 共享与 Agent 专属 Skill 加载
- #25: 多 Agent run 并发、排队与取消
- #26: Bash 审批与文件工具路径保护
- #27: Skill 安装、更新和删除审批
- #28: 安全流式 Markdown 与纯文本 Composer
- #29: 虚拟化 transcript 与 Pi compaction 状态

## 不包含的内容

以下功能明确不在 MVP 范围内，将在后续版本规划：

- 账号体系、登录、云同步、团队协作
- Windows/Linux 正式支持
- 可替换 Pi Agent 的多引擎架构
- Agent 重命名、永久删除、自动清空归档
- 多工作空间、共享工作空间、外部项目目录切换
- 长期记忆系统、向量数据库、自动记忆检索
- Pi session 分支导航、fork、clone、手动 compaction
- 富文本输入、附件、图片、语音、数学公式
- 暗色模式、多主题
- 永久 bash 授权、脚本自动执行
- 自动导入外部 Pi/Codex/Claude Skill
