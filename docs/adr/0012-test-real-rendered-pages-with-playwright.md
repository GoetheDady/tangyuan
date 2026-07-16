# 使用 Playwright 测试真实前端页面

前端测试分三层：Vitest 覆盖纯逻辑和 Zustand store，React Testing Library 覆盖组件行为，Playwright 在真实 Chromium Renderer 和真实 Electron 窗口中覆盖路由、CSS 布局、滚动、键盘操作、Preload/IPC 交互和关键截图。真实页面测试不能只依赖 jsdom。

现有手写 Chrome DevTools Protocol 布局脚本迁移为 Playwright 测试，减少浏览器控制基础设施；打包后的 `.app` smoke test 继续保留，用于发现开发模式无法暴露的打包、资源和启动问题。自动测试使用受控 Driver 或 Preload 数据，不写入真实 API Key；真实 Pi Agent 调用保留独立手动验收。
