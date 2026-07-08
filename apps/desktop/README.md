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

### macOS Packaged Smoke Test

```bash
$ pnpm smoke:packaged:mac
```

该命令会打包 `.app`，启动打包后的应用，并确认它能显示配置页或工作台。详细验收步骤见 `../../docs/desktop-packaging-and-sdk-acceptance.md`。
