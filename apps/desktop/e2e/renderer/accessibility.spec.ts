import { expect, test } from '@playwright/test'
import {
  createMissingConfigSnapshot,
  createPreloadApiInitScript,
  createReadyRuntimeSnapshot,
  createTestMessages,
  createTestSessions
} from '../fixtures/preload-mock'

test.describe('Renderer 基础无障碍', () => {
  test('配置页控件可通过名称访问', async ({ page }) => {
    const initScript = createPreloadApiInitScript(createMissingConfigSnapshot())

    await page.addInitScript({ content: initScript })
    await page.goto('/#/console/providers')

    await expect(page.getByRole('heading', { name: '配置模型服务' })).toBeVisible()
    await expect(page.getByLabel('Provider')).toBeVisible()
    await expect(page.getByLabel('Model').first()).toBeVisible()
    await expect(page.getByLabel('API Key')).toBeVisible()

    const disabledModelLabel = page.locator('label[for="default-model"]')
    await expect(disabledModelLabel).toHaveCSS('opacity', '0.5')
    await expect(disabledModelLabel).toHaveCSS('pointer-events', 'none')

    const submitButton = page.getByRole('button', { name: '验证并保存' })
    await expect(submitButton).toBeVisible()
    await expect(submitButton).toBeDisabled()
    await expect(page.getByRole('button', { name: '刷新资源' })).toBeVisible()
  })

  test('聊天页核心区域可通过名称访问', async ({ page }) => {
    const initScript = createPreloadApiInitScript(
      createReadyRuntimeSnapshot(),
      createTestSessions(2),
      createTestMessages()
    )

    await page.addInitScript({ content: initScript })
    await page.goto('/#/chat/tangyuan')

    await expect(page.getByRole('heading', { name: '汤圆' })).toBeVisible()
    await expect(page.getByRole('heading', { name: /测试会话/ })).toBeVisible()
    await expect(page.getByRole('button', { name: '新会话' })).toBeVisible()
    await expect(page.getByRole('button', { name: '发送' })).toBeDisabled()

    const messageArea = page.locator('[data-testid="message-scroll-area"]')
    await expect(messageArea).toBeVisible()
    await expect(messageArea.locator('article')).toHaveCount(2)
    await expect(page.getByRole('textbox', { name: '消息' })).toBeVisible()
  })
})
