import { defineConfig } from '@playwright/test'

import { commonPlaywrightConfig, createRendererWebServer } from './playwright.shared'

const rendererBaseUrl = 'http://127.0.0.1:4173'

/**
 * 汤圆桌面端 Renderer Playwright 测试配置。
 *
 * 包含两个测试 project：
 * - chromium-renderer：结构、交互与无障碍自动回归
 * - chromium-renderer-artifacts：按需生成供人工验收的 PNG
 */
export default defineConfig({
  testDir: './e2e',
  ...commonPlaywrightConfig,
  webServer: createRendererWebServer(4173),
  projects: [
    {
      name: 'chromium-renderer',
      testMatch: 'renderer/**/*.spec.ts',
      testIgnore: 'renderer/artifacts.spec.ts',
      use: {
        bypassCSP: true,
        baseURL: rendererBaseUrl
      }
    },
    {
      name: 'chromium-renderer-artifacts',
      testMatch: 'renderer/artifacts.spec.ts',
      use: {
        bypassCSP: true,
        baseURL: rendererBaseUrl
      }
    }
  ]
})
