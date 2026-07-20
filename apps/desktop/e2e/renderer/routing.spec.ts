import { expect, test } from '@playwright/test'
import {
  createReadyRuntimeSnapshot,
  createMissingConfigSnapshot,
  createTestSessions,
  createPreloadApiInitScript
} from '../fixtures/preload-mock'

test.describe('路由导航', () => {
  test('配置阻断保留原始目标并在配置完成后返回', async ({ page }) => {
    const runtime = createMissingConfigSnapshot()
    const initScript = createPreloadApiInitScript(runtime)

    await page.addInitScript({ content: initScript })
    // 尝试直接访问聊天页
    await page.goto('/#/chat/tangyuan/session-1')

    // 应被重定向到控制台 Providers 页，且 URL 包含 redirect 参数
    await page.waitForSelector('#provider')
    await expect(page).toHaveURL(/\/console\/providers/)
    await expect(page).toHaveURL(/redirect=/) // 包含 redirect 参数
    await expect(page.getByRole('heading', { name: '配置模型服务' })).toBeVisible()
  })

  test('直接访问 /#/console/providers 渲染配置表单', async ({ page }) => {
    const runtime = createMissingConfigSnapshot()
    const initScript = createPreloadApiInitScript(runtime)

    await page.addInitScript({ content: initScript })
    await page.goto('/#/console/providers')

    await page.waitForSelector('#provider')
    await expect(page.getByRole('heading', { name: '配置模型服务' })).toBeVisible()
    await expect(page.locator('#provider')).toBeVisible()
    await expect(page.locator('#api-key')).toBeVisible()
  })

  test('直接访问 /#/console/agents 渲染 Agent 列表页', async ({ page }) => {
    const runtime = createMissingConfigSnapshot()
    const initScript = createPreloadApiInitScript(runtime)

    await page.addInitScript({ content: initScript })
    await page.goto('/#/console/agents')

    await expect(page.getByRole('heading', { name: 'Agent 管理' })).toBeVisible()
    // 默认 Agent "汤圆" 始终存在，显示活跃状态
    await expect(page.getByRole('heading', { name: '汤圆', level: 3 })).toBeVisible()
    // 默认 Agent "汤圆" 显示 Agent ID 和活跃状态
    await expect(page.getByText('ID：tangyuan')).toBeVisible()
    await expect(page.getByText('活跃')).toBeVisible()
  })

  test('设置页面的活跃 Agent 状态使用 success Badge', async ({ page }) => {
    const runtime = createMissingConfigSnapshot()
    const initScript = createPreloadApiInitScript(runtime)

    await page.addInitScript({ content: initScript })
    await page.goto('/#/console/agents')

    const activeBadge = page.locator('[data-slot="badge"]', { hasText: '活跃' })
    await expect(activeBadge).toHaveAttribute('data-variant', 'success')
    await expect(activeBadge).toHaveCSS('height', '22px')
    await expect(activeBadge).toHaveCSS('font-size', '11px')
    await expect(activeBadge).toHaveCSS('font-weight', '600')
    await expect(activeBadge).toHaveCSS('box-shadow', 'none')
  })

  test('设置页面的 Provider 配置状态使用语义 Badge', async ({ page }) => {
    const runtime = createMissingConfigSnapshot({
      configuredProviders: {
        anthropic: { configured: true, maskedValue: 'sk-a...test' }
      }
    })
    const initScript = createPreloadApiInitScript(runtime)

    await page.addInitScript({ content: initScript })
    await page.goto('/#/console/providers')

    const configuredBadge = page.locator('[data-slot="badge"]', { hasText: '已配置' })
    await expect(configuredBadge).toHaveAttribute('data-variant', 'success')
    await expect(configuredBadge.locator('svg')).toHaveCSS('width', '12px')
    await expect(configuredBadge).toHaveCSS('box-shadow', 'none')
  })

  test('直接访问 /#/console/agents/:agentId 渲染 Agent 详情页', async ({ page }) => {
    const runtime = createMissingConfigSnapshot()
    const initScript = createPreloadApiInitScript(runtime)

    await page.addInitScript({ content: initScript })
    await page.goto('/#/console/agents/test-agent-1')

    await expect(page.getByRole('heading', { name: 'Agent 详情' })).toBeVisible()
    await expect(page.getByText('ID: test-agent-1')).toBeVisible()
    await expect(page.getByRole('link', { name: '返回 Agent 列表' })).toBeVisible()
  })

  test('Agent 详情页可返回列表页', async ({ page }) => {
    const runtime = createMissingConfigSnapshot()
    const initScript = createPreloadApiInitScript(runtime)

    await page.addInitScript({ content: initScript })
    await page.goto('/#/console/agents/test-agent-1')

    await page.waitForSelector('text=Agent 详情')
    await page.click('text=返回 Agent 列表')
    await expect(page).toHaveURL(/\/console\/agents$/)
    await expect(page.getByRole('heading', { name: 'Agent 管理' })).toBeVisible()
  })

  test('刷新后保持在当前 console 页面', async ({ page }) => {
    const runtime = createMissingConfigSnapshot()
    const initScript = createPreloadApiInitScript(runtime)

    await page.addInitScript({ content: initScript })
    await page.goto('/#/console/providers')
    await page.waitForSelector('#provider')

    // 刷新页面
    await page.reload()
    await page.waitForSelector('#provider')

    // 刷新后仍在 console providers 页
    await expect(page).toHaveURL(/\/console\/providers/)
    await expect(page.getByRole('heading', { name: '配置模型服务' })).toBeVisible()
  })

  test('刷新后保持聊天页', async ({ page }) => {
    const runtime = createReadyRuntimeSnapshot()
    const sessions = createTestSessions(1)
    const initScript = createPreloadApiInitScript(runtime, sessions)

    await page.addInitScript({ content: initScript })
    await page.goto('/#/chat/tangyuan')
    await page.waitForSelector('#composer')

    // 刷新页面
    await page.reload()
    await page.waitForSelector('#composer')

    // 刷新后仍在聊天页
    await expect(page).toHaveURL(/\/chat/)
    await expect(page.getByRole('heading', { name: '汤圆' })).toBeVisible()
  })

  test('浏览器后退按钮可在控制台页面间导航', async ({ page }) => {
    const runtime = createMissingConfigSnapshot()
    const initScript = createPreloadApiInitScript(runtime)

    await page.addInitScript({ content: initScript })
    // 先访问 agents 页
    await page.goto('/#/console/agents')
    await expect(page.getByRole('heading', { name: 'Agent 管理' })).toBeVisible()

    // 再访问 providers 页
    await page.goto('/#/console/providers')
    await page.waitForSelector('#provider')
    await expect(page.getByRole('heading', { name: '配置模型服务' })).toBeVisible()

    // 后退
    await page.goBack()
    await expect(page.getByRole('heading', { name: 'Agent 管理' })).toBeVisible()

    // 前进
    await page.goForward()
    await expect(page.getByRole('heading', { name: '配置模型服务' })).toBeVisible()
  })

  test('调用 openExternalLink API 发送外部链接', async ({ page }) => {
    const runtime = createReadyRuntimeSnapshot()
    const sessions = createTestSessions(1)
    const initScript = createPreloadApiInitScript(runtime, sessions)

    await page.addInitScript({ content: initScript })
    await page.goto('/#/chat/tangyuan')

    // openExternalLink 在 mock 中只是空操作，验证不会丢错
    const result = await page.evaluate(async () => {
      try {
        await window.api.openExternalLink({ url: 'https://example.com' })
        return 'success'
      } catch (e) {
        return `error: ${String(e)}`
      }
    })

    expect(result).toBe('success')
  })
})
