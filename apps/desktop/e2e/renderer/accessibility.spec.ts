import { expect, test } from '@playwright/test'
import {
  createMissingConfigSnapshot,
  createLastActiveSession,
  createPreloadApiInitScript,
  createReadyRuntimeSnapshot,
  createTestMessages,
  createTestSessions,
} from '../fixtures/preload-mock'

test.describe('Renderer 基础无障碍', () => {
  test('配置页控件可通过名称访问', async ({ page }) => {
    const initScript = createPreloadApiInitScript(createMissingConfigSnapshot())

    await page.addInitScript({ content: initScript })
    await page.goto('/#/setup')

    await expect(
      page.getByRole('heading', { name: '连接模型服务' }),
    ).toBeVisible()
    await expect(page.getByLabel('Provider')).toBeVisible()
    await expect(page.getByLabel('Model').first()).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'API Key' })).toBeVisible()

    const submitButton = page.getByRole('button', { name: '验证并继续' })
    await expect(submitButton).toBeVisible()
    await expect(submitButton).toBeDisabled()
    await expect(page.getByRole('button', { name: '刷新资源' })).toBeVisible()
  })

  test('聊天页核心区域可通过名称访问', async ({ page }) => {
    const initScript = createPreloadApiInitScript(
      createReadyRuntimeSnapshot(),
      createTestSessions(2),
      createTestMessages(),
      createLastActiveSession(),
    )

    await page.addInitScript({ content: initScript })
    await page.goto('/#/chat/tangyuan/session-1')

    await expect(page.getByRole('heading', { name: '汤圆' })).toBeVisible()
    await expect(page.getByRole('heading', { name: /测试会话/ })).toBeVisible()
    await expect(page.getByRole('button', { name: '新建会话' })).toBeVisible()
    await expect(page.getByRole('button', { name: '发送' })).toBeDisabled()

    const messageArea = page.locator('[data-testid="message-scroll-area"]')
    await expect(messageArea).toBeVisible()
    await expect(messageArea.locator('article')).toHaveCount(2)
    await expect(page.getByRole('textbox', { name: '消息' })).toBeVisible()
  })
})
