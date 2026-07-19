import { defineConfig } from '@playwright/test'

import { commonPlaywrightConfig } from './playwright.shared'

/** Electron Preload/IPC 和窗口行为的独立 Playwright 配置。 */
export default defineConfig({
  testDir: './e2e',
  ...commonPlaywrightConfig,
  projects: [
    {
      name: 'electron',
      testMatch: 'electron/**/*.spec.ts'
    }
  ]
})
