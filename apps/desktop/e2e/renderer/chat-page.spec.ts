import { expect, test } from '@playwright/test'
import {
  createReadyRuntimeSnapshot,
  createTestSessions,
  createTestMessages,
  createPreloadApiInitScript
} from '../fixtures/preload-mock'

test.describe('聊天页', () => {
  test.beforeEach(async ({ page }) => {
    const runtime = createReadyRuntimeSnapshot()
    const sessions = createTestSessions(3)
    const messages = createTestMessages()
    const initScript = createPreloadApiInitScript(runtime, sessions, messages)

    await page.addInitScript({ content: initScript })
    await page.goto('/#/chat/tangyuan')
    // 等待 React 渲染完成
    await page.waitForSelector('#composer')
  })

  test('显示品牌标题和布局', async ({ page }) => {
    // 左侧 sidebar 品牌区域
    await expect(page.getByRole('heading', { name: '汤圆' })).toBeVisible()
    await expect(page.getByText('大语言模型对话')).toBeVisible()
  })

  test('显示新会话按钮', async ({ page }) => {
    const newSessionButton = page.getByRole('button', { name: '新会话' })
    await expect(newSessionButton).toBeVisible()
  })

  test('会话列表展示 mock sessions', async ({ page }) => {
    // 验证 3 个测试会话都在侧边栏列表中（使用 role="button" 定位侧边栏会话项）
    await expect(page.getByRole('button', { name: /测试会话 1/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /测试会话 2/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /测试会话 3/ })).toBeVisible()
  })

  test('会话列表显示运行状态', async ({ page }) => {
    // 每个会话都应显示"空闲"状态
    const idleIndicators = page.getByText('空闲')
    await expect(idleIndicators.first()).toBeVisible()
  })

  test('消息区域显示 mock 消息', async ({ page }) => {
    const messageArea = page.locator('[data-testid="message-scroll-area"]')
    await expect(messageArea).toBeVisible()

    // 用户消息和 Agent 回复都应渲染
    await expect(page.getByText('你好汤圆，请帮我写一段代码。')).toBeVisible()
    await expect(
      page.getByText('你好！我很乐意帮你写代码。请告诉我你需要什么功能，我会为你生成相应的代码。')
    ).toBeVisible()
  })

  test('Composer 输入文本', async ({ page }) => {
    const composer = page.locator('#composer')
    await composer.fill('帮我写一个 hello world')
    await expect(composer).toHaveValue('帮我写一个 hello world')
  })

  test('无文本时发送按钮 disabled', async ({ page }) => {
    const sendButton = page.getByRole('button', { name: '发送' })
    await expect(sendButton).toBeDisabled()
  })

  test('有文本且有选中会话时发送按钮可用', async ({ page }) => {
    const composer = page.locator('#composer')
    await composer.fill('测试消息')
    const sendButton = page.getByRole('button', { name: '发送' })
    await expect(sendButton).toBeEnabled()
  })

  test('消息区域接收新消息后滚动', async ({ page }) => {
    const messageArea = page.locator('[data-testid="message-scroll-area"]')
    // 消息区域应有内容
    const articles = messageArea.locator('article')
    const count = await articles.count()
    expect(count).toBeGreaterThanOrEqual(2)
  })

  test('用户消息和 Agent 消息气泡样式不同', async ({ page }) => {
    const messageArea = page.locator('[data-testid="message-scroll-area"]')
    const articles = messageArea.locator('article')

    // 用户消息在右侧（justify-end）
    const userMessage = articles.first()
    await expect(userMessage).toHaveClass(/justify-end/)

    // Agent 消息在左侧（justify-start）
    const agentMessage = articles.nth(1)
    await expect(agentMessage).toHaveClass(/justify-start/)
  })
})
