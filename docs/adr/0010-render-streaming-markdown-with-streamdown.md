# 使用 Streamdown 渲染流式 Agent 消息

Renderer 使用 Streamdown 渲染 Agent 的流式 Markdown，支持未闭合语法、代码块、表格和任务列表；用户消息保持纯文本，不解析成 Markdown。原始 HTML 不执行，内容经过清理，外部链接不在 Renderer 内直接导航，而是交给 Main 进程按安全规则打开。

Mermaid 等重功能默认不进入首屏包，仅在消息确实需要时按需加载。这样保留 AI 对话所需的流式排版能力，同时控制不可信内容和桌面应用启动体积。

MVP 安装 `@streamdown/code` 提供 Shiki 代码高亮，并安装 `@streamdown/cjk` 修正中文与 Markdown 标记相邻时的解析；英文使用 Streamdown 默认能力。Mermaid 插件仅在需要渲染图表时动态加载，数学公式插件暂不安装。

用户输入保持纯文本，使用 shadcn Textarea 实现多行输入、输入法安全的发送快捷键和受限自动增高。MVP 不引入 TipTap、Lexical、Monaco 等富文本或代码编辑器；附件以后作为独立消息结构扩展，不嵌入富文本协议。
