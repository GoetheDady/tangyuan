import { defineConfig } from '@playwright/test'

import { commonPlaywrightConfig, createRendererWebServer } from './playwright.shared'

const fixtureBaseUrl = 'http://127.0.0.1:4174'

/**
 * 基础组件验收夹具的 Playwright 配置。
 *
 * 结构/交互与像素比较使用独立 project，避免跨平台截图差异进入常规 Renderer 回归。
 */
export default defineConfig({
  testDir: './e2e/component-fixtures',
  ...commonPlaywrightConfig,
  use: {
    baseURL: fixtureBaseUrl,
    bypassCSP: true,
    colorScheme: 'light',
    deviceScaleFactor: 1,
    locale: 'zh-CN',
    reducedMotion: 'reduce',
    timezoneId: 'Asia/Shanghai',
    viewport: { width: 1440, height: 1000 }
  },
  webServer: createRendererWebServer(4174),
  projects: [
    {
      name: 'chromium-fixtures',
      testMatch: ['**/base-components.spec.ts', '**/conversation-components.spec.ts']
    },
    {
      name: 'chromium-fixtures-visual',
      testMatch: ['**/base-components.visual.spec.ts', '**/conversation-components.visual.spec.ts']
    }
  ]
})
