# E2E 测试说明

汤圆桌面端使用真实 Chromium 和 Electron 验证 CSS、路由、Preload/IPC、窗口行为与基础组件验收夹具。

## 安装

```bash
pnpm install
```

`pnpm install` 会安装 Playwright 所需的 Chromium 浏览器。

## 测试边界

| 边界                    | 命令                                                 | 是否像素比较 | 构建模式   |
| ----------------------- | ---------------------------------------------------- | ------------ | ---------- |
| 常规 Renderer 结构/交互 | `pnpm --filter apps-desktop test:e2e:renderer`       | 否           | production |
| Electron Preload/IPC    | `pnpm --filter apps-desktop test:e2e:electron`       | 否           | production |
| 基础组件夹具结构/交互   | `pnpm --filter apps-desktop test:e2e:fixtures`       | 否           | test       |
| 基础组件夹具视觉回归    | `pnpm --filter apps-desktop test:visual:fixtures`    | 是           | test       |
| 页面人工截图 artifact   | `pnpm --filter apps-desktop test:artifacts:renderer` | 否，只写 PNG | production |

像素比较不属于常规 Renderer 回归，避免不同平台的字体和栅格化差异阻断结构/交互测试。视觉 project 使用 `pnpm-lock.yaml` 锁定的 Playwright/Chromium，固定 `1440×1000` viewport、`deviceScaleFactor=1`、浅色模式、`zh-CN`、`Asia/Shanghai`、reduced motion 和固定脱敏数据；当前精确版本与基准更新理由记录在 `BASELINE.md`。

## 常规 E2E

完整 E2E 会先生产构建，再依次运行 Renderer、Electron 和组件夹具结构测试；视觉比较仍需独立执行：

```bash
pnpm --filter apps-desktop test:e2e
```

只运行某个边界：

```bash
pnpm --filter apps-desktop test:e2e:renderer
pnpm --filter apps-desktop test:e2e:electron
pnpm --filter apps-desktop test:e2e:fixtures
```

普通 production 构建会额外扫描 `out/renderer`，确认组件夹具模块没有进入正式产物。

## 基础组件验收夹具

开发模式和专用 Playwright test 构建可访问：

```text
/#/__fixtures__/base-components
```

夹具只渲染 Renderer 基础组件和固定脱敏数据，不注入 Preload mock、不读取 `window.api`、不加载 Runtime，也不读写真实配置。后续组件 Ticket 应在现有 `data-fixture-section` 分区内增量加入 variant、size、状态和边界场景。

运行结构、ARIA、键盘、焦点、几何、三档桌面宽度溢出与 Portal smoke：

```bash
pnpm --filter apps-desktop test:e2e:fixtures
```

运行视觉回归：

```bash
pnpm --filter apps-desktop test:visual:fixtures
```

明确接受视觉变化并更新当前平台基准：

```bash
pnpm --filter apps-desktop test:visual:fixtures:update
```

## 人工截图 artifact

`e2e/renderer/artifacts.spec.ts` 只把完整产品页面写成 PNG，供人工验收；它没有 `toHaveScreenshot()` 比较，因此不属于自动视觉回归，也不在常规 Renderer project 中运行。对应的 ARIA 自动断言位于 `accessibility.spec.ts`，仍属于常规 Renderer 回归。

```bash
pnpm --filter apps-desktop test:artifacts:renderer
```

## 调试

```bash
pnpm --filter apps-desktop test:e2e:renderer --debug
pnpm --filter apps-desktop exec playwright test e2e/renderer/chat-page.spec.ts --project=chromium-renderer
```

## 目录结构

```text
e2e/
├── BASELINE.md
├── component-fixtures/
│   ├── base-components.spec.ts
│   ├── base-components.visual.spec.ts
│   └── base-components.visual.spec.ts-snapshots/
├── fixtures/
│   └── preload-mock.ts
├── renderer/
│   ├── accessibility.spec.ts
│   ├── artifacts.spec.ts
│   ├── fixture-production.spec.ts
│   └── ...
└── electron/
    └── app.spec.ts
```

## 注意事项

1. 测试数据必须脱敏，不记录或输出真实 API Key。
2. Renderer/Electron 常规测试使用 production 构建；组件夹具使用 `mode=test` 构建。
3. Chromium Renderer 测试启用 `bypassCSP`，因为构建产物有严格 Content-Security-Policy。
4. Renderer 与组件夹具配置在顶层管理各自的静态服务器；Electron 使用独立配置，不依赖 Renderer web server。
5. #33 开始前的 14 个既有配置页失败记录见 `BASELINE.md`，不得误报为组件夹具回归。
