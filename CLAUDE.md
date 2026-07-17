# Tangyuan 开发规范

## 文件长度

- 单个源文件不超过 **500 行**为宜，超过 1000 行必须拆分。
- 拆分策略：按职责将类型定义、schemas、核心逻辑、工具函数等分到独立文件中，通过 barrel export (`index.ts`) 统一对外暴露。
- 测试文件同理，与源文件保持相近的粒度。

## 技术栈

- 语言：TypeScript（strict 模式）
- 运行时：Node.js（Main 进程）/ Electron + React（Renderer）
- 验证库：Zod（contracts 包）
- 测试框架：Vitest
- Monorepo 工具：pnpm workspaces
