import { defineConfig } from '@playwright/test'

import { commonPlaywrightConfig } from './playwright.shared'

/**
 * QA 测试专用 Playwright 配置。
 *
 * 与 e2e/ 下的单元/集成测试不同，QA 测试启动真实 Electron 应用，
 * 通过 app-harness 进行真实模型对话测试。
 *
 * - testDir: ./qa
 * - 超时延长至 120s（真实对话 + 模型推理很慢）
 * - workers: 1（避免多个真实 Electron 实例冲突）
 */
export default defineConfig({
  testDir: './qa',
  ...commonPlaywrightConfig,
  timeout: 120_000,
  workers: 1,
  fullyParallel: false,
  projects: [
    {
      name: 'qa-electron',
      testMatch: '**/*.spec.ts',
    },
  ],
})
