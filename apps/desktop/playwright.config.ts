import { defineConfig } from '@playwright/test'

/**
 * 汤圆桌面端 Playwright 测试配置。
 *
 * 包含两个测试 project：
 * - chromium-renderer：在真实 Chromium 中测试渲染页面（注入 mock preload API）
 * - electron：在真实 Electron 窗口中测试 Preload/IPC 和窗口行为
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: 'list',

  projects: [
    {
      name: 'chromium-renderer',
      testMatch: 'renderer/**/*.spec.ts',
      use: {
        bypassCSP: true,
        baseURL: 'http://127.0.0.1:4173',
      },
      webServer: {
        command: 'pnpm exec serve out/renderer -l 4173 --no-clipboard',
        port: 4173,
        reuseExistingServer: !process.env['CI'],
      },
    },
    {
      name: 'electron',
      testMatch: 'electron/**/*.spec.ts',
      // Electron 项目不使用 baseURL/webServer，在测试 fixture 中直接调用 electron.launch()
    },
  ],
})
