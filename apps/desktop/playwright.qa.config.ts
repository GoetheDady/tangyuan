import { defineConfig } from '@playwright/test'

/**
 * 自动化 QA 专用 Playwright 配置：真实 Electron + 真实模型对话。
 *
 * 与 e2e 配置的关键区别：
 * - 使用真实 HOME 与本机钥匙串（解密真实 Provider Key），故绝不进 CI。
 * - 串行执行、单 worker：真实对话有状态且消耗 token，不并发。
 * - 更长超时：等待真实模型返回。
 * - 不重试：QA 关注真实首跑结果，重试会掩盖偶发问题。
 */
export default defineConfig({
  testDir: './qa',
  testMatch: '**/*.qa.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  reporter: 'list',
  projects: [
    {
      name: 'qa',
      testMatch: '**/*.qa.ts'
    }
  ]
})
