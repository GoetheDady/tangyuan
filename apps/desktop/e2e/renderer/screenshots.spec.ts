import { expect, test } from '@playwright/test'
import {
  createReadyRuntimeSnapshot,
  createMissingConfigSnapshot,
  createTestSessions,
  createTestMessages,
  createPreloadApiInitScript,
} from '../fixtures/preload-mock'

/**
 * 视觉截图与基础无障碍断言。
 *
 * 在真实 Chromium 中验证“黑芝麻汤圆”主题的关键页面渲染，
 * 并通过 ARIA 角色/名称断言基本的可访问性。
 */
test.describe('视觉与无障碍', () => {
  test('配置页截图与无障碍', async ({ page }) => {
    const runtime = createMissingConfigSnapshot()
    const initScript = createPreloadApiInitScript(runtime)

    await page.addInitScript({ content: initScript })
    await page.goto('/#/console/providers')
    await page.waitForSelector('#provider')

    // 主标题与 Provider 标签应可被无障碍树检索
    await expect(page.getByRole('heading', { name: '配置模型服务' })).toBeVisible()
    await expect(page.getByLabel('Provider')).toBeVisible()
    await expect(page.getByLabel('Model')).toBeVisible()
    await expect(page.getByLabel('API Key')).toBeVisible()

    // 提交按钮有可访问名称且初始禁用
    const submitButton = page.getByRole('button', { name: '验证并保存' })
    await expect(submitButton).toBeVisible()
    await expect(submitButton).toBeDisabled()

    // 刷新资源按钮存在
    await expect(page.getByRole('button', { name: '刷新资源' })).toBeVisible()

    // 整页截图，供人工校对“黑芝麻汤圆”视觉基线
    await page.screenshot({ path: 'e2e/renderer/setup-page.png', fullPage: true })
  })

  test('聊天页截图与无障碍', async ({ page }) => {
    const runtime = createReadyRuntimeSnapshot()
    const sessions = createTestSessions(2)
    const messages = createTestMessages()
    const initScript = createPreloadApiInitScript(runtime, sessions, messages)

    await page.addInitScript({ content: initScript })
    await page.goto('/#/chat/tangyuan')
    await page.waitForSelector('#composer')

    // 主标题和品牌heading
    await expect(page.getByRole('heading', { name: '汤圆' })).toBeVisible()
    await expect(page.getByRole('heading', { name: /测试会话/ })).toBeVisible()

    // 新会话按钮、发送按钮可访问
    await expect(page.getByRole('button', { name: '新会话' })).toBeVisible()
    await expect(page.getByRole('button', { name: '发送' })).toBeDisabled()

    // 消息区域渲染用户与 Agent 消息
    const messageArea = page.locator('[data-testid="message-scroll-area"]')
    await expect(messageArea).toBeVisible()
    await expect(messageArea.locator('article')).toHaveCount(2)

    // Composer 输入框有 sr-only Label 关联
    await expect(page.getByRole('textbox', { name: '消息' })).toBeVisible()

    // 整页截图，供人工校对聊天页视觉基线
    await page.screenshot({ path: 'e2e/renderer/chat-page.png', fullPage: true })
  })
})
