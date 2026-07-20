import { expect, test } from '@playwright/test'
import {
  createReadyRuntimeSnapshot,
  createMissingConfigSnapshot,
  createPreloadApiInitScript
} from '../fixtures/preload-mock'

const providerModelSelector = '#model-anthropic'
const providerApiKeySelector = '#api-key-anthropic'

test.describe('配置阻断', () => {
  test('runtime 未就绪时 /#/chat 重定向到 /#/console/providers', async ({ page }) => {
    const runtime = createMissingConfigSnapshot()
    const initScript = createPreloadApiInitScript(runtime)

    await page.addInitScript({ content: initScript })
    await page.goto('/#/chat')

    await expect(page.getByRole('heading', { name: '配置模型服务' })).toBeVisible()
    await expect(page).toHaveURL(/\/console\/providers/)
    await expect(page).toHaveURL(/redirect=/)
  })

  test('配置页显示 Provider 凭据卡片和对应模型选项', async ({ page }) => {
    const runtime = createMissingConfigSnapshot()
    const initScript = createPreloadApiInitScript(runtime)

    await page.addInitScript({ content: initScript })
    await page.goto('/#/console/providers')

    await expect(page.getByRole('heading', { name: 'Provider 凭据' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Anthropic', level: 3 })).toBeVisible()
    const modelSelect = page.locator(providerModelSelector)
    await expect(modelSelect).toBeVisible()
    await expect(modelSelect.locator('option')).toHaveCount(2)
    await expect(modelSelect.locator('option').nth(1)).toHaveText('Claude Sonnet 4.5')
  })

  test('配置页显示 Provider 专属 Model select', async ({ page }) => {
    const runtime = createMissingConfigSnapshot()
    const initScript = createPreloadApiInitScript(runtime)

    await page.addInitScript({ content: initScript })
    await page.goto('/#/console/providers')

    await expect(page.locator(providerModelSelector)).toBeVisible()
  })

  test('Provider 卡片只展示对应的模型', async ({ page }) => {
    const runtime = createMissingConfigSnapshot()
    const initScript = createPreloadApiInitScript(runtime)

    await page.addInitScript({ content: initScript })
    await page.goto('/#/console/providers')

    const options = page.locator(providerModelSelector).locator('option')
    await expect(options).toHaveCount(2)
    await expect(options.nth(0)).toHaveText('选择模型')
    await expect(options.nth(1)).toHaveText('Claude Sonnet 4.5')
  })

  test('配置页显示 API Key 输入框', async ({ page }) => {
    const runtime = createMissingConfigSnapshot()
    const initScript = createPreloadApiInitScript(runtime)

    await page.addInitScript({ content: initScript })
    await page.goto('/#/console/providers')

    const apiKeyInput = page.locator(providerApiKeySelector)
    await expect(apiKeyInput).toBeVisible()
    await expect(apiKeyInput).toHaveAttribute('type', 'password')
  })

  test('Provider 字段为空时提交按钮 disabled', async ({ page }) => {
    const runtime = createMissingConfigSnapshot()
    const initScript = createPreloadApiInitScript(runtime)

    await page.addInitScript({ content: initScript })
    await page.goto('/#/console/providers')

    await expect(page.getByRole('button', { name: '验证并保存' })).toBeDisabled()
  })

  test('填写 Provider 模型和 API Key 后提交按钮可用', async ({ page }) => {
    const runtime = createMissingConfigSnapshot()
    const initScript = createPreloadApiInitScript(runtime)

    await page.addInitScript({ content: initScript })
    await page.goto('/#/console/providers')

    await page.selectOption(providerModelSelector, 'claude-sonnet-4-5')
    await page.fill(providerApiKeySelector, 'sk-ant-test-key-not-real')

    await expect(page.getByRole('button', { name: '验证并保存' })).toBeEnabled()
  })

  test('runtime 就绪时 /#/console/providers 自动跳转到 /#/chat', async ({ page }) => {
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

  test('显示配置说明文本', async ({ page }) => {
    const runtime = createMissingConfigSnapshot()
    const initScript = createPreloadApiInitScript(runtime)

    await page.addInitScript({ content: initScript })
    await page.goto('/#/console/providers')

    await expect(page.getByText('控制台')).toBeVisible()
    await expect(
      page.getByText('为 Provider 配置 API Key 并选择汤圆默认模型。完成后会直接进入聊天主界面。')
    ).toBeVisible()
  })

  test('初始化配置页面刷新资源继续通过全局 Sonner 队列反馈', async ({ page }) => {
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
