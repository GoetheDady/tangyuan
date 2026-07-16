# E2E 测试说明

汤圆桌面端 Playwright 端到端测试。在真实 Chromium 和 Electron 窗口中验证 CSS、路由、Preload/IPC 和窗口行为。

## 安装

```bash
# 在仓库根目录安装依赖（包含 Playwright 浏览器）
pnpm install
```

`pnpm install` 会自动安装 Playwright 所需的 Chromium 浏览器。

## 本地运行

### 前提条件

E2E 测试需要先构建项目。构建产物在 `out/` 目录下：

```bash
# 构建完整的桌面应用
pnpm --filter apps-desktop build
```

### 运行所有 E2E 测试

```bash
pnpm --filter apps-desktop test:e2e
```

这会依次运行 Renderer 测试和 Electron 测试。

### 仅运行 Renderer 测试（真实 Chromium）

```bash
pnpm --filter apps-desktop test:e2e:renderer
```

Renderer 测试在真实 Chromium 浏览器中运行，注入受控的 mock `window.api` 数据来模拟 Preload API。测试覆盖：

- 聊天页完整流程（会话列表、消息展示、Composer 输入、发送按钮状态）
- 配置阻断流程（runtime 未就绪时自动跳转到配置页、表单联动、校验逻辑）
- 长消息布局（验证大量消息不会把 Composer 推出视口）

### 仅运行 Electron 测试（真实 Electron 窗口）

```bash
pnpm --filter apps-desktop test:e2e:electron
```

Electron 测试启动真实 Electron 应用，使用临时 HOME 目录避免污染本机配置。测试覆盖：

- 应用启动和窗口创建
- Preload API 可用性检查
- 页面正确渲染（配置页或聊天页）
- HashRouter 导航行为

### 调试模式

```bash
# Renderer 测试调试模式（显示浏览器窗口、放慢执行）
pnpm --filter apps-desktop test:e2e:renderer --debug

# 指定单个测试文件
pnpm --filter apps-desktop test:e2e:renderer -- e2e/renderer/chat-page.spec.ts
```

### 运行旧版布局检查

```bash
# 现在指向 Playwright 渲染器测试（原 CDP 脚本已迁移）
pnpm --filter apps-desktop test:layout
```

## 测试结构

```
e2e/
├── README.md                        # 本文件
├── fixtures/
│   └── preload-mock.ts              # window.api mock 数据工厂
├── renderer/
│   ├── chat-page.spec.ts            # 聊天页流程测试
│   ├── setup-page.spec.ts           # 配置阻断流程测试
│   ├── layout.spec.ts               # 长消息布局测试
│   └── screenshots.spec.ts          # 视觉截图与基础无障碍断言
└── electron/
    └── app.spec.ts                  # Electron 窗口测试
```

## 注意事项

1. **不读写真实 API Key**：所有 mock 数据使用脱敏值（如 `sk-a...7xq`），Electron 测试使用临时 HOME 目录。
2. **构建前置**：Renderer 测试需要 `out/renderer/` 构建产物，Electron 测试需要完整应用构建。运行 `test:e2e` 脚本会自动先执行构建。
3. **CSP 绕过**：Chromium Renderer 测试启用 `bypassCSP` 配置，因为构建产物的 `index.html` 有严格 Content-Security-Policy。
4. **并行执行**：所有测试默认并行运行（除非在 CI 环境中）。
5. **打包 smoke test 不受影响**：`pnpm smoke:packaged:mac` 仍可独立运行。
