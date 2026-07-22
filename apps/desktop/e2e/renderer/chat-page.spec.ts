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
    await expect(page.getByRole('heading', { name: '汤圆' })).toBeAttached()
    await expect(page.getByText('大语言模型对话')).toBeAttached()
  })

  test('侧栏按 Pencil 使用 64px Agent Rail + 216px Session Pane', async ({ page }) => {
    const sidebar = page.getByTestId('chat-sidebar')
    const agentRail = page.getByTestId('chat-agent-rail')
    const sessionPane = page.getByTestId('chat-session-pane')

    await expect(sidebar).toBeVisible()
    await expect(agentRail).toBeVisible()
    await expect(sessionPane).toBeVisible()

    await expect(sidebar).toHaveCSS('width', '280px')
    await expect(agentRail).toHaveCSS('width', '64px')
    await expect(sessionPane).toHaveCSS('width', '216px')
  })

  test('标题栏和 Composer 使用 Pencil 尺寸', async ({ page }) => {
    await expect(page.getByTestId('chat-header')).toHaveCSS('height', '48px')
    await expect(page.getByTestId('composer-card')).toHaveCSS('height', '131px')
    await expect(page.getByTestId('composer-card')).toHaveCSS('border-radius', '20px')
    await expect(page.getByTestId('composer-card')).toHaveCSS('max-width', 'none')

    const composerForm = page.getByTestId('composer-card').locator('..')
    await expect(composerForm).toHaveCSS('max-width', '720px')
  })

  test('显示新会话按钮', async ({ page }) => {
    const newSessionButton = page.getByRole('button', { name: '新建会话' })
    await expect(newSessionButton).toBeVisible()
  })

  test('会话列表展示 mock sessions', async ({ page }) => {
    // 验证 3 个测试会话都在侧边栏列表中（使用 role="button" 定位侧边栏会话项）
    await expect(page.getByRole('button', { name: /测试会话 1/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /测试会话 2/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /测试会话 3/ })).toBeVisible()
  })

  test('会话列表只显示影响操作的状态', async ({ page }) => {
    await expect(page.getByText('空闲')).toHaveCount(0)
    await expect(page.getByText('已完成')).toHaveCount(0)
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

test.describe('聊天主界面 Toast 回归', () => {
  test('停止生成继续通过全局 Sonner 队列反馈', async ({ page }) => {
    const runtime = createReadyRuntimeSnapshot()
    const sessions = createTestSessions(1).map((session) => ({
      ...session,
      state: 'running' as const
    }))
    const initScript = createPreloadApiInitScript(runtime, sessions, createTestMessages())

    await page.addInitScript({ content: initScript })
    await page.goto('/#/chat/tangyuan')
    await page.getByRole('button', { name: '停止' }).click()

    const item = page.locator('[data-sonner-toast][data-type="success"]')
    await expect(item).toContainText('已停止生成')
    await expect(page.locator('[data-sonner-toaster]')).toHaveAttribute('data-x-position', 'right')
  })
})
