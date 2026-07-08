# 初始化工程骨架与基础质量门禁

## What to build

初始化汤圆 v1 的工程骨架，让桌面应用可以用 pnpm 启动，并具备后续实现所需的基础质量门禁。

本 issue 需要使用脚手架优先完成工程生成：pnpm workspace、electron-vite、React、TypeScript、Tailwind、Motion、GSAP、Lucide、ESLint、Prettier、Vitest。能由脚手架生成的配置不要手写。所有手写导出的函数、类型、接口、类都需要中文 JSDoc，并包含参数、返回值和可能失败的说明。

## Acceptance criteria

- [ ] 仓库使用 pnpm workspace，至少包含 `apps/desktop`、`packages/agent-runtime`、`packages/shared` 的结构。
- [ ] Electron 应用可以通过 pnpm 脚本在开发模式启动，并显示最小可用窗口。
- [ ] Renderer 使用 React + TypeScript，并接入 Tailwind、Motion、GSAP、Lucide。
- [ ] Tailwind 使用官方初始化方式，主题色来源预留给 `docs/theme-colors.md`，业务组件不散写随机 hex/rgb/hsl。
- [ ] 配置 ESLint、Prettier、prettier-plugin-tailwindcss、TypeScript strict、Vitest。
- [ ] 提供 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm format`、`pnpm dev` 脚本。
- [ ] 新增一个最小 smoke 测试，确认基础测试链路可运行。
- [ ] 手写导出 API 都有中文 JSDoc，且包含 `@param`、`@returns`、必要时包含 `@throws`。

## Blocked by

None - can start immediately
