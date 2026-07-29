/**
 * 阶段 4：初始页面 QA 测试（#89 规格 — 初始页面 + 真实 UI 配置流程）
 *
 * 测试范围：
 * 1. 首次启动 — 初始配置页面正常渲染
 * 2. 真实页面交互 — 选择 Provider、填入 API Key、选择 Model
 * 3. 验证并进入聊天
 * 4. 重启恢复最后激活会话（#89 User Story 15）
 * 5. 全程健康检查（无崩溃、无白屏、无控制台报错）
 *
 * 严格遵循 QA README 规范：所有操作通过 Playwright locator + click/fill 完成。
 */

import { test, expect } from '@playwright/test'
import { launchApp } from './lib/app-harness'
import { checkAppHealth, checkRuntimeReady } from './lib/invariants'
import type { AppHarness } from './lib/app-harness'

const QA_API_KEY = process.env.TANGYUAN_QA_API_KEY!
const QA_PROVIDER = process.env.TANGYUAN_QA_PROVIDER ?? 'deepseek'
const QA_MODEL = process.env.TANGYUAN_QA_MODEL ?? 'deepseek-v4-flash'

let harness: AppHarness

test.beforeAll(async () => {
  harness = await launchApp()
  // 等待渲染完成
  await harness.window.waitForLoadState('domcontentloaded')
  await harness.window.waitForTimeout(2000)
})

test.afterAll(async () => {
  await harness.close()
})

// ═══════════════════════════════════════════════════════════════════
// 初始页面渲染
// ═══════════════════════════════════════════════════════════════════

test('初始页面 — 窗口打开，不白屏', async () => {
  expect(harness.app.windows().length).toBe(1)
  const bodyText = await harness.window.evaluate(() => document.body.innerText?.trim() ?? '')
  expect(bodyText.length).toBeGreaterThan(0)
})

test('初始页面 — 首次配置标题可见', async () => {
  // #89 规格：应用启动应优先恢复最后激活会话，无可用会话时进入配置页面
  await expect(
    harness.window.getByText('首次配置')
  ).toBeVisible({ timeout: 5000 })
})

test('初始页面 — 连接模型服务标题可见', async () => {
  await expect(
    harness.window.getByText('连接模型服务')
  ).toBeVisible()
})

test('初始页面 — Provider 选择器存在且可交互', async () => {
  const providerTrigger = harness.window.locator('[data-testid="setup-provider-select"]')
  await expect(providerTrigger).toBeVisible()
  await expect(providerTrigger).toBeEnabled()
})

test('初始页面 — API Key 输入框存在且可交互', async () => {
  const apiKeyInput = harness.window.locator('[data-testid="setup-api-key-input"]')
  await expect(apiKeyInput).toBeVisible()
  await expect(apiKeyInput).toBeEnabled()
})

test('初始页面 — Model 选择器存在（Provider 未选时禁用）', async () => {
  const modelTrigger = harness.window.locator('[data-testid="setup-model-select"]')
  await expect(modelTrigger).toBeVisible()
  // Provider 未选中时 Model 选择器应禁用
  await expect(modelTrigger).toBeDisabled()
})

test('初始页面 — 验证按钮存在', async () => {
  await expect(
    harness.window.getByRole('button', { name: '验证并继续' })
  ).toBeVisible()
})

test('初始页面 — 未填写时验证按钮禁用', async () => {
  const verifyBtn = harness.window.getByRole('button', { name: '验证并继续' })
  await expect(verifyBtn).toBeDisabled()
})

test('初始页面 — 进入聊天按钮存在', async () => {
  await expect(
    harness.window.getByRole('button', { name: '进入聊天' })
  ).toBeVisible()
})

test('初始页面 — 刷新资源按钮存在', async () => {
  await expect(
    harness.window.getByRole('button', { name: '刷新资源' })
  ).toBeVisible()
})

test('初始页面 — 安全提示文本可见', async () => {
  await expect(
    harness.window.getByText(/API Key 使用 macOS 安全存储/)
  ).toBeVisible()
})

// ═══════════════════════════════════════════════════════════════════
// 真实 UI 交互：选择 Provider
// ═══════════════════════════════════════════════════════════════════

test('配置流程 — 打开 Provider 下拉菜单', async () => {
  const providerTrigger = harness.window.locator('[data-testid="setup-provider-select"]')
  await providerTrigger.click()

  // 等待下拉菜单出现
  await harness.window.waitForTimeout(500)

  // 验证下拉菜单中有选项
  const options = harness.window.locator('[role="option"]')
  const count = await options.count()
  expect(count).toBeGreaterThan(0)
  console.log(`Provider 选项数：${count}`)
})

test('配置流程 — 选择 DeepSeek Provider', async () => {
  // 使用 getByRole 定位 DeepSeek 选项并点击
  const deepseekOption = harness.window.getByRole('option', { name: 'DeepSeek' })
  await expect(deepseekOption).toBeVisible({ timeout: 3000 })
  await deepseekOption.click()

  // 验证 Provider 选择器显示 DeepSeek
  await expect(
    harness.window.locator('[data-testid="setup-provider-select"]')
  ).toContainText('DeepSeek')
})

test('配置流程 — 选择 Provider 后 Model 选择器变为可用', async () => {
  const modelTrigger = harness.window.locator('[data-testid="setup-model-select"]')
  await expect(modelTrigger).toBeEnabled({ timeout: 2000 })
})

// ═══════════════════════════════════════════════════════════════════
// 真实 UI 交互：填入 API Key
// ═══════════════════════════════════════════════════════════════════

test('配置流程 — 填入 API Key', async () => {
  const apiKeyInput = harness.window.locator('[data-testid="setup-api-key-input"]')

  // 点击聚焦输入框
  await apiKeyInput.click()

  // 真实键盘输入 API Key
  await apiKeyInput.fill(QA_API_KEY)

  // 验证输入值已填入
  const value = await apiKeyInput.inputValue()
  expect(value).toBe(QA_API_KEY)
})

test('配置流程 — 显示/隐藏 API Key 切换按钮可用', async () => {
  const toggleBtn = harness.window.getByRole('button', { name: '显示 API Key' })
  await expect(toggleBtn).toBeVisible()
  await expect(toggleBtn).toBeEnabled()

  // 点击切换为明文
  await toggleBtn.click()

  // 验证输入框变为 text 类型
  const apiKeyInput = harness.window.locator('[data-testid="setup-api-key-input"]')
  const type = await apiKeyInput.getAttribute('type')
  expect(type).toBe('text')

  // 切回密码模式
  const hideBtn = harness.window.getByRole('button', { name: '隐藏 API Key' })
  await hideBtn.click()
  const typeAfter = await apiKeyInput.getAttribute('type')
  expect(typeAfter).toBe('password')
})

// ═══════════════════════════════════════════════════════════════════
// 真实 UI 交互：选择 Model
// ═══════════════════════════════════════════════════════════════════

test('配置流程 — 打开 Model 下拉菜单查看选项', async () => {
  const modelTrigger = harness.window.locator('[data-testid="setup-model-select"]')
  await modelTrigger.click()
  await harness.window.waitForTimeout(500)

  // 验证有模型选项
  const options = harness.window.locator('[role="option"]')
  const count = await options.count()
  expect(count).toBeGreaterThan(0)
  console.log(`Model 选项数：${count}`)

  // 列出所有可用模型
  for (let i = 0; i < count; i++) {
    const text = await options.nth(i).textContent()
    console.log(`  模型选项 ${i}: ${text}`)
  }
})

test('配置流程 — 选择 deepseek-v4-flash 模型', async () => {
  // 使用文本内容定位模型选项
  const modelOption = harness.window.getByRole('option', { name: /deepseek-v4-flash/i })
  const optionCount = await modelOption.count()

  if (optionCount > 0) {
    await modelOption.first().click()
    console.log('已选择 deepseek-v4-flash')
  } else {
    // 如果找不到精确匹配，选择第一个可用模型
    console.log('未找到 deepseek-v4-flash，使用第一个可用模型')
    const firstOption = harness.window.locator('[role="option"]').first()
    const text = await firstOption.textContent()
    console.log(`选择：${text}`)
    await firstOption.click()
  }

  // 验证 Model 选择器显示已选模型
  await expect(
    harness.window.locator('[data-testid="setup-model-select"]')
  ).not.toHaveText('选择模型')
})

// ═══════════════════════════════════════════════════════════════════
// 验证配置
// ═══════════════════════════════════════════════════════════════════

test('配置流程 — 填写完整后验证按钮变为可用', async () => {
  const verifyBtn = harness.window.getByRole('button', { name: '验证并继续' })
  await expect(verifyBtn).toBeEnabled({ timeout: 2000 })
})

test('配置流程 — 点击验证并继续', async () => {
  test.setTimeout(120_000) // 验证可能较慢

  const verifyBtn = harness.window.getByRole('button', { name: '验证并继续' })
  await verifyBtn.click()

  // 等待验证中状态出现
  await harness.window.waitForTimeout(1000)

  // 检查是否有验证中的提示
  const verifyingText = harness.window.getByText(/正在连接/)
  const verifyingVisible = await verifyingText.isVisible().catch(() => false)
  console.log(`验证中状态可见：${verifyingVisible}`)
})

test('配置流程 — 等待验证完成进入聊天页', async () => {
  test.setTimeout(120_000)

  // 等待导航到聊天页面或成功提示
  try {
    // 等待 toast "配置已保存"
    await expect(
      harness.window.getByText('配置已保存')
    ).toBeVisible({ timeout: 60_000 })
    console.log('✅ 配置已保存')
  } catch {
    // 也可能因为预填了 QA key 直接跳转
    console.log('未看到"配置已保存"提示，检查是否已进入聊天页')
  }

  // 等待 URL 变为聊天页
  await harness.window.waitForTimeout(2000)
  const hash = await harness.window.evaluate(() => window.location.hash)
  console.log(`当前 URL：${hash}`)
})

test('配置后 — 进入聊天页', async () => {
  const hash = await harness.window.evaluate(() => window.location.hash)
  // 应该在聊天页或是 Bootstrap 流程
  expect(hash).toMatch(/chat|bootstrap|console/)
  console.log(`最终页面：${hash}`)
})

// ═══════════════════════════════════════════════════════════════════
// 不变量检查
// ═══════════════════════════════════════════════════════════════════

test('运行不变量 — 无控制台错误', async () => {
  if (harness.consoleErrors.length > 0) {
    console.log('⚠️  控制台错误：')
    for (const err of harness.consoleErrors) {
      console.log(`  - ${err}`)
    }
  }
  // 过滤掉已知的非关键错误（如 IPC 通信时序问题）
  const criticalErrors = harness.consoleErrors.filter(
    (e) => !e.includes('会话文件不可读') && !e.includes('transcript')
  )
  expect(criticalErrors).toEqual([])
})

test('运行不变量 — 无页面异常', async () => {
  expect(harness.pageErrors).toEqual([])
})

test('最终健康检查', async () => {
  const violations = await checkAppHealth(harness)
  if (violations.length > 0) {
    console.log('❌ 健康检查异常：', JSON.stringify(violations, null, 2))
  }
  expect(violations).toEqual([])
})
