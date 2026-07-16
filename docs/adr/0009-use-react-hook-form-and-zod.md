# 表单使用 React Hook Form 与 Zod

Renderer 的 Provider 凭据、Agent 设置和配置恢复表单使用 React Hook Form 管理草稿、错误与提交状态，表单草稿不进入 Zustand。字段结构和校验规则使用 Zod schema 定义在 `packages/contracts`，让 Renderer 在提交前提供即时反馈，并让 Electron Main 对每个 IPC 请求再次执行运行时校验。Agent 创建仍由默认 Agent 通过对话和受控工具完成，不提供创建表单。

共享 TypeScript 类型不能替代 Main 侧校验，因为类型在编译后不存在，旧版本 Renderer、开发工具或异常调用仍可能传入无效数据。Main 只处理通过 Zod schema 解析后的值。
