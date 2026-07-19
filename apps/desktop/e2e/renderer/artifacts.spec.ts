import { expect, test } from '@playwright/test'
import {
  createMissingConfigSnapshot,
  createPreloadApiInitScript,
  createReadyRuntimeSnapshot,
  createTestMessages,
  createTestSessions
} from '../fixtures/preload-mock'

/**
 * 页面人工截图 artifact。
 *
 * 本文件只写 PNG，不做像素或结构断言，也不属于常规 Renderer 自动回归。
 */
test.describe('页面人工截图 artifact', () => {
  test('生成配置页 artifact', async ({ page }) => {
    const initScript = createPreloadApiInitScript(createMissingConfigSnapshot())

    await page.addInitScript({ content: initScript })
    await page.goto('/#/console/providers')
    await expect(page.getByRole('heading', { name: '配置模型服务' })).toBeVisible()

    await page.screenshot({ path: 'e2e/renderer/setup-page.png', fullPage: true })
  })

  test('生成聊天页 artifact', async ({ page }) => {
    const initScript = createPreloadApiInitScript(
      createReadyRuntimeSnapshot(),
      createTestSessions(2),
      createTestMessages()
    )

    await page.addInitScript({ content: initScript })
    await page.goto('/#/chat/tangyuan')
    await expect(page.getByRole('textbox', { name: '消息' })).toBeVisible()

    await page.screenshot({ path: 'e2e/renderer/chat-page.png', fullPage: true })
  })
})
