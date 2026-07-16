# 沙箱化 Electron Renderer

Electron Renderer 启用 `contextIsolation: true`、`nodeIntegration: false` 和 `sandbox: true`，并设置严格内容安全策略。Renderer 只能通过类型化 Preload API 调用 Main，不能直接访问 Node.js、文件系统、Pi SDK 或完整 API Key。

Main 对所有 IPC 请求使用 contracts 中的 Zod schema 运行时校验，外部链接由 Main 校验协议后使用系统浏览器打开，应用禁止加载远程脚本和任意页面导航。凭据保存后只向 Renderer 返回已配置状态和脱敏值。
