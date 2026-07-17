import { expect, test } from '@playwright/test'
import {
  createReadyRuntimeSnapshot,
  createTestSessions,
  createLongTestMessage,
  createPreloadApiInitScript
} from '../fixtures/preload-mock'

test.describe('长消息布局', () => {
  test('长消息不会把 Composer 推出视口', async ({ page }) => {
    const runtime = createReadyRuntimeSnapshot()
    const sessions = createTestSessions(1)
    const longMessage = createLongTestMessage()
    const initScript = createPreloadApiInitScript(runtime, sessions, [longMessage])

    await page.addInitScript({ content: initScript })
    await page.goto('/#/chat/tangyuan')

    // 等待消息和 Composer 渲染
    await page.waitForSelector('#composer')
    await page.waitForSelector('[data-testid="message-scroll-area"]')

    // 验证关键元素存在
    const composer = page.locator('#composer')
    await expect(composer).toBeVisible()

    const footer = page.locator('footer')
    await expect(footer).toBeVisible()

    const messageArea = page.locator('[data-testid="message-scroll-area"]')
    await expect(messageArea).toBeVisible()

    // 检查 Composer 在 viewport 内
    const composerBox = await composer.boundingBox()
    expect(composerBox).not.toBeNull()

    if (composerBox) {
      const viewport = page.viewportSize()
      expect(viewport).not.toBeNull()

      if (viewport) {
        // Composer 的 top 不应小于 0（在视口顶部之上）
        expect(composerBox.y).toBeGreaterThanOrEqual(0)
        // Composer 的 bottom 不应超过 viewport height
        expect(composerBox.y + composerBox.height).toBeLessThanOrEqual(viewport.height)
      }
    }
  })

  test('footer 在 viewport 内', async ({ page }) => {
    const runtime = createReadyRuntimeSnapshot()
    const sessions = createTestSessions(1)
    const longMessage = createLongTestMessage()
    const initScript = createPreloadApiInitScript(runtime, sessions, [longMessage])

    await page.addInitScript({ content: initScript })
    await page.goto('/#/chat/tangyuan')
    await page.waitForSelector('footer')

    const footerBox = await page.locator('footer').boundingBox()
    expect(footerBox).not.toBeNull()

    if (footerBox) {
      const viewport = page.viewportSize()
      expect(viewport).not.toBeNull()

      if (viewport) {
        // Footer 完全在视口内
        expect(footerBox.y).toBeGreaterThanOrEqual(0)
        expect(footerBox.y + footerBox.height).toBeLessThanOrEqual(viewport.height)
      }
    }
  })

  test('消息区域可滚动', async ({ page }) => {
    const runtime = createReadyRuntimeSnapshot()
    const sessions = createTestSessions(1)
    const longMessage = createLongTestMessage()
    const initScript = createPreloadApiInitScript(runtime, sessions, [longMessage])

    await page.addInitScript({ content: initScript })
    await page.goto('/#/chat/tangyuan')
    await page.waitForSelector('[data-testid="message-scroll-area"]')

    const messageArea = page.locator('[data-testid="message-scroll-area"]')
    const overflowY = await messageArea.evaluate((el) => getComputedStyle(el).overflowY)

    // 消息区域应有垂直滚动行为
    expect(['auto', 'scroll']).toContain(overflowY)
  })

  test('长消息内容正确渲染', async ({ page }) => {
    const runtime = createReadyRuntimeSnapshot()
    const sessions = createTestSessions(1)
    const longMessage = createLongTestMessage()
    const initScript = createPreloadApiInitScript(runtime, sessions, [longMessage])

    await page.addInitScript({ content: initScript })
    await page.goto('/#/chat/tangyuan')
    await page.waitForSelector('[data-testid="message-scroll-area"]')

    // 验证长消息中包含的关键文本可被找到
    await expect(page.getByText('第1行：这是一段很长的回复内容')).toBeVisible()
    await expect(page.getByText('第180行：这是一段很长的回复内容')).toBeVisible()
  })
})
