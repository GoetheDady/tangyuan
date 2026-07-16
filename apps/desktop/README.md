# apps-desktop

An Electron application with React and TypeScript

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

```bash
$ pnpm install
```

### Development

```bash
$ pnpm dev
```

### Build

```bash
# For windows
$ pnpm build:win

# For macOS
$ pnpm build:mac

# For Linux
$ pnpm build:linux
```

### E2E 测试（Playwright）

在真实 Chromium 和 Electron 窗口中验证 CSS、路由、Preload/IPC 和窗口行为。

```bash
# 先构建
$ pnpm build

# 运行 Chromium Renderer 测试（真实浏览器，mock Preload API）
$ pnpm test:e2e:renderer

# 运行 Electron 窗口测试（真实 Electron 应用）
$ pnpm test:e2e:electron

# 运行所有 E2E 测试
$ pnpm test:e2e
```

详细说明见 `e2e/README.md`。

### macOS Packaged Smoke Test

```bash
$ pnpm smoke:packaged:mac
```

该命令会打包 `.app`，启动打包后的应用，并确认它能显示配置页或工作台。详细验收步骤见 `../../docs/desktop-packaging-and-sdk-acceptance.md`。
