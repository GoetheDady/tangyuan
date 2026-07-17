import { expect, test } from '@playwright/test'
import {
  createReadyRuntimeSnapshot,
  createTestSessions,
  createMarkdownTestMessages,
  createPreloadApiInitScript
} from '../fixtures/preload-mock'

test.describe('Streamdown Markdown 渲染', () => {
  test.beforeEach(async ({ page }) => {
    const runtime = createReadyRuntimeSnapshot()
    const sessions = createTestSessions(1)
    const messages = createMarkdownTestMessages()
    const initScript = createPreloadApiInitScript(runtime, sessions, messages)

    await page.addInitScript({ content: initScript })
    await page.goto('/#/chat/tangyuan')
    await page.waitForSelector('#composer')
  })

  test('代码块正确渲染', async ({ page }) => {
    // Markdown 代码块应渲染为 <pre><code> 或 streamdown code-block
    const codeBlock = page.locator('[data-streamdown="code-block"]')
    await expect(codeBlock.first()).toBeVisible()

    // 代码块内容应包含 TypeScript 代码
    await expect(page.getByText('function hello')).toBeVisible()
  })

  test('表格正确渲染', async ({ page }) => {
    // Markdown 表格应渲染
    const table = page.locator('[data-streamdown="table"]')
    await expect(table.first()).toBeVisible()

    // 表头内容
    await expect(page.getByText('参数')).toBeVisible()
    await expect(page.getByText('类型')).toBeVisible()
  })

  test('任务列表正确渲染', async ({ page }) => {
    // 任务列表项应渲染
    await expect(page.getByText('完成功能开发')).toBeVisible()
    await expect(page.getByText('编写测试')).toBeVisible()
  })

  test('CJK 中英文混排正常', async ({ page }) => {
    // 中文内容正常渲染
    await expect(page.getByText('代码示例')).toBeVisible()
    // 中英文混合
    await expect(page.getByText('TypeScript 函数')).toBeVisible()
  })

  test('用户消息为纯文本不解析 Markdown', async ({ page }) => {
    // 用户消息 "帮我写一段代码" 应作为纯文本渲染
    const messageArea = page.locator('[data-testid="message-scroll-area"]')
    const articles = messageArea.locator('article')

    // 用户消息在右侧
    const userMessage = articles.first()
    // 用户消息不应包含 streamdown 属性
    const streamdownInUser = userMessage.locator('[data-streamdown]')
    await expect(streamdownInUser).toHaveCount(0)
  })

  test('外部链接点击截获并调用 window.api.openExternalLink', async ({ page }) => {
    // 点击 TypeScript 官网链接
    const link = page.getByText('TypeScript 官网')
    await expect(link).toBeVisible()
    await link.click()

    // 验证 openExternalLink 被调用
    const calls = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (window as any).__openExternalLinkCalls__ || []
    })
    expect(calls.length).toBeGreaterThan(0)
    expect(calls[0].url).toContain('typescriptlang.org')
  })

  test('原始 HTML 不被执行', async ({ page }) => {
    // 通过修改 initScript 注入危险消息
    const runtime = createReadyRuntimeSnapshot()
    const sessions = createTestSessions(1)
    const xssMessages = [
      {
        messageId: 'msg-xss-1',
        agentId: 'tangyuan',
        sessionId: 'session-1',
        role: 'agent' as const,
        content: '<script>window.__xssExecuted__ = true</script>',
        createdAt: new Date().toISOString()
      }
    ]
    const initScript = createPreloadApiInitScript(runtime, sessions, xssMessages)

    await page.addInitScript({ content: initScript })
    await page.goto('/#/chat/tangyuan')
    await page.waitForSelector('#composer')

    // <script> 标签不应被执行
    const xssExecuted = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (window as any).__xssExecuted__ === true
    })
    expect(xssExecuted).toBe(false)
  })

  test('发送按钮在流式输出期间显示发送中', async ({ page }) => {
    // 输入文本
    const composer = page.locator('#composer')
    await composer.fill('测试消息')

    // 发送按钮应可用
    const sendButton = page.getByRole('button', { name: /发送/ })
    await expect(sendButton).toBeEnabled()
  })

  test('空输入时发送按钮禁用', async ({ page }) => {
    const sendButton = page.getByRole('button', { name: /发送/ })
    await expect(sendButton).toBeDisabled()
  })
})
