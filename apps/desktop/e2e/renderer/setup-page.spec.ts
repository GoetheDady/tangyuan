import { expect, test } from '@playwright/test'
import {
  createReadyRuntimeSnapshot,
  createMissingConfigSnapshot,
  createPreloadApiInitScript,
} from '../fixtures/preload-mock'

test.describe('配置阻断', () => {
  test('runtime 未就绪时 /#/chat 重定向到 /#/console/providers', async ({ page }) => {
    const runtime = createMissingConfigSnapshot()
    const initScript = createPreloadApiInitScript(runtime)

    await page.addInitScript({ content: initScript })
    await page.goto('/#/chat')

    // 应该被重定向到 setup 页
    await page.waitForSelector('#provider')
    await expect(page).toHaveURL(/\/console\/providers/)
    await expect(page.getByRole('heading', { name: '配置模型服务' })).toBeVisible()
  })

  test('配置页显示 Provider select 和选项', async ({ page }) => {
    const runtime = createMissingConfigSnapshot()
    const initScript = createPreloadApiInitScript(runtime)

    await page.addInitScript({ content: initScript })
    await page.goto('/#/console/providers')
    await page.waitForSelector('#provider')

    const providerSelect = page.locator('#provider')
    await expect(providerSelect).toBeVisible()

    // 应有 "选择模型服务" 占位项和 Anthropic 选项
    const options = providerSelect.locator('option')
    await expect(options).toHaveCount(2)
    await expect(options.nth(1)).toHaveText('Anthropic')
  })

  test('配置页显示 Model select', async ({ page }) => {
    const runtime = createMissingConfigSnapshot()
    const initScript = createPreloadApiInitScript(runtime)

    await page.addInitScript({ content: initScript })
    await page.goto('/#/console/providers')
    await page.waitForSelector('#model')

    const modelSelect = page.locator('#model')
    await expect(modelSelect).toBeVisible()
  })

  test('选择 Provider 后 Model select 过滤对应模型', async ({ page }) => {
    const runtime = createMissingConfigSnapshot()
    const initScript = createPreloadApiInitScript(runtime)

    await page.addInitScript({ content: initScript })
    await page.goto('/#/console/providers')
    await page.waitForSelector('#provider')

    // 初始 Model select 只有占位项
    const modelSelect = page.locator('#model')
    let options = modelSelect.locator('option')
    await expect(options).toHaveCount(1) // 只有"选择模型"

    // 选择 Anthropic Provider
    await page.selectOption('#provider', 'anthropic')
    options = modelSelect.locator('option')
    await expect(options).toHaveCount(2) // 占位 + Claude Sonnet 4.5
    await expect(options.nth(1)).toHaveText('Claude Sonnet 4.5')
  })

  test('配置页显示 API Key 输入框', async ({ page }) => {
    const runtime = createMissingConfigSnapshot()
    const initScript = createPreloadApiInitScript(runtime)

    await page.addInitScript({ content: initScript })
    await page.goto('/#/console/providers')
    await page.waitForSelector('#api-key')

    const apiKeyInput = page.locator('#api-key')
    await expect(apiKeyInput).toBeVisible()
    await expect(apiKeyInput).toHaveAttribute('type', 'password')
  })

  test('所有字段为空时提交按钮 disabled', async ({ page }) => {
    const runtime = createMissingConfigSnapshot()
    const initScript = createPreloadApiInitScript(runtime)

    await page.addInitScript({ content: initScript })
    await page.goto('/#/console/providers')
    await page.waitForSelector('#provider')

    const submitButton = page.getByRole('button', { name: '验证并保存' })
    await expect(submitButton).toBeDisabled()
  })

  test('填写所有字段后提交按钮可用', async ({ page }) => {
    const runtime = createMissingConfigSnapshot()
    const initScript = createPreloadApiInitScript(runtime)

    await page.addInitScript({ content: initScript })
    await page.goto('/#/console/providers')
    await page.waitForSelector('#provider')

    await page.selectOption('#provider', 'anthropic')
    await page.selectOption('#model', 'claude-sonnet-4-5')
    await page.fill('#api-key', 'sk-ant-test-key-not-real')

    const submitButton = page.getByRole('button', { name: '验证并保存' })
    await expect(submitButton).toBeEnabled()
  })

  test('runtime 就绪时 /#/console/providers 自动跳转到 /#/chat', async ({ page }) => {
    const runtime = createReadyRuntimeSnapshot()
    const sessions = [
      {
        agentId: 'tangyuan',
        sessionId: 'session-1',
        title: '已存在的会话',
        state: 'idle' as const,
        updatedAt: new Date().toISOString(),
      },
    ]
    const initScript = createPreloadApiInitScript(runtime, sessions)

    await page.addInitScript({ content: initScript })
    await page.goto('/#/console/providers')

    // 应该自动跳转到聊天页
    await page.waitForSelector('#composer')
    await expect(page).toHaveURL(/\/chat/)
  })

  test('显示"刷新资源"按钮', async ({ page }) => {
    const runtime = createMissingConfigSnapshot()
    const initScript = createPreloadApiInitScript(runtime)

    await page.addInitScript({ content: initScript })
    await page.goto('/#/console/providers')
    await page.waitForSelector('#provider')

    await expect(page.getByRole('button', { name: '刷新资源' })).toBeVisible()
  })

  test('显示配置说明文本', async ({ page }) => {
    const runtime = createMissingConfigSnapshot()
    const initScript = createPreloadApiInitScript(runtime)

    await page.addInitScript({ content: initScript })
    await page.goto('/#/console/providers')
    await page.waitForSelector('#provider')

    await expect(page.getByText('首次使用前')).toBeVisible()
    await expect(
      page.getByText('选择 Provider、模型并验证 API Key。完成后会直接进入聊天主界面。'),
    ).toBeVisible()
  })
})
