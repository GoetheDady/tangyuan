import type { PlaywrightTestConfig } from '@playwright/test'

/** 各 Playwright 边界共享的执行策略。 */
export const commonPlaywrightConfig = {
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: 'list'
} satisfies PlaywrightTestConfig

/**
 * 创建只服务 Renderer 静态产物的 Playwright web server 配置。
 */
export function createRendererWebServer(
  port: number
): NonNullable<PlaywrightTestConfig['webServer']> {
  const baseUrl = `http://127.0.0.1:${port}`

  return {
    command: `pnpm exec serve out/renderer -l ${port} --no-clipboard`,
    url: baseUrl,
    reuseExistingServer: !process.env['CI']
  }
}
