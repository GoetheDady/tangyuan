import { expect, test } from '@playwright/test'
import {
  createReadyRuntimeSnapshot,
  createMissingConfigSnapshot,
  createPreloadApiInitScript
} from '../fixtures/preload-mock'

const formTitle = '连接模型服务'
const providerSelectSelector = '[data-testid="setup-provider-select"]'
const apiKeyInputSelector = '[data-testid="setup-api-key-input"]'
const modelSelectSelector = '[data-testid="setup-model-select"]'

test.describe('初始化配置页面', () => {
  test('runtime 未就绪时 /#/chat 重定向到 /#/console/providers', async ({ page }) => {
    const runtime = createMissingConfigSnapshot()
    const initScript = createPreloadApiInitScript(runtime)

    await page.addInitScript({ content: initScript })
    await page.goto('/#/chat')

    await expect(page.getByRole('heading', { name: formTitle })).toBeVisible()
    await expect(page).toHaveURL(/\/console\/providers/)
    await expect(page).toHaveURL(/redirect=/)
  })

  test('页面展示居中表单，包含标题和描述', async ({ page }) => {
    const runtime = createMissingConfigSnapshot()
    const initScript = createPreloadApiInitScript(runtime)

    await page.addInitScript({ content: initScript })
    await page.goto('/#/console/providers')

    await expect(page.getByRole('heading', { name: formTitle })).toBeVisible()
    await expect(page.getByText('首次配置')).toBeVisible()
    await expect(
      page.getByText('配置一个可用的模型服务，并将所选模型作为默认 Agent 汤圆的初始模型。')
    ).toBeVisible()
  })

  test('表单字段按 Provider → API Key → Model 纵向排列', async ({ page }) => {
    const runtime = createMissingConfigSnapshot()
    const initScript = createPreloadApiInitScript(runtime)

    await page.addInitScript({ content: initScript })
    await page.goto('/#/console/providers')

    await expect(page.locator(providerSelectSelector)).toBeVisible()
    await expect(page.locator(apiKeyInputSelector)).toBeVisible()
    await expect(page.locator(apiKeyInputSelector)).toHaveAttribute('type', 'password')
    await expect(page.locator(modelSelectSelector)).toBeVisible()
  })

  test('表单字段为空时"验证并继续"按钮 disabled', async ({ page }) => {
    const runtime = createMissingConfigSnapshot()
    const initScript = createPreloadApiInitScript(runtime)

    await page.addInitScript({ content: initScript })
    await page.goto('/#/console/providers')

    await expect(page.getByRole('button', { name: '验证并继续' })).toBeDisabled()
  })

  test('填写 API Key 并选择 Model 后提交按钮可用', async ({ page }) => {
    const runtime = createMissingConfigSnapshot()
    const initScript = createPreloadApiInitScript(runtime)

    await page.addInitScript({ content: initScript })
    await page.goto('/#/console/providers')

    await page.fill(apiKeyInputSelector, 'sk-ant-test-key-not-real')
    // Radix Select：点击触发按钮，再选择选项
    await page.locator(modelSelectSelector).click()
    await page.getByRole('option', { name: 'Claude Sonnet 4.5' }).click()

    await expect(page.getByRole('button', { name: '验证并继续' })).toBeEnabled()
  })

  test('显示安全提示', async ({ page }) => {
    const runtime = createMissingConfigSnapshot()
    const initScript = createPreloadApiInitScript(runtime)

    await page.addInitScript({ content: initScript })
    await page.goto('/#/console/providers')

    await expect(
      page.getByText('API Key 使用 macOS 安全存储加密保存在本机')
    ).toBeVisible()
  })

  test('runtime 就绪时自动跳转到 /#/chat', async ({ page }) => {
    const runtime = createReadyRuntimeSnapshot()
    const sessions = [
      {
        agentId: 'tangyuan',
        sessionId: 'session-1',
        title: '已存在的会话',
        state: 'idle' as const,
        updatedAt: new Date().toISOString()
      }
    ]
    const initScript = createPreloadApiInitScript(runtime, sessions)

    await page.addInitScript({ content: initScript })
    await page.goto('/#/console/providers')

    await page.waitForSelector('#composer')
    await expect(page).toHaveURL(/\/chat/)
  })

  test('显示"刷新资源"按钮', async ({ page }) => {
    const runtime = createMissingConfigSnapshot()
    const initScript = createPreloadApiInitScript(runtime)

    await page.addInitScript({ content: initScript })
    await page.goto('/#/console/providers')

    await expect(page.getByRole('button', { name: '刷新资源' })).toBeVisible()
  })

  test('刷新资源通过全局 Sonner 队列反馈', async ({ page }) => {
    const runtime = createMissingConfigSnapshot()
    const initScript = createPreloadApiInitScript(runtime)

    await page.addInitScript({ content: initScript })
    await page.goto('/#/console/providers')
    await page.getByRole('button', { name: '刷新资源' }).click()

    const item = page.locator('[data-sonner-toast][data-type="success"]')
    await expect(item).toContainText('已刷新可用模型资源')
    await expect(page.locator('[data-sonner-toaster]')).toHaveAttribute('data-y-position', 'bottom')
  })
})
