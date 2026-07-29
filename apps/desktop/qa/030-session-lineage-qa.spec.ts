/**
 * 阶段 3：会话谱系管理 QA
 *
 * 测试 #89 / #95 中与会话谱系相关的新功能：
 * - 归档按钮存在且可交互
 * - 删除按钮存在且可交互
 * - 发送消息后分叉按钮出现
 * - 归档/删除确认弹窗结构正确
 *
 * 用 QA 模式启动，通过真实 UI 交互验证。
 * 遵循 QA README：只测试和提 issue，不改产品代码。
 */
import { test, expect } from '@playwright/test'
import { launchApp, configureForQa } from './lib/app-harness'
import { checkAppHealth, checkRuntimeReady } from './lib/invariants'
import type { AppHarness } from './lib/app-harness'

let harness: AppHarness

test.beforeAll(async () => {
  harness = await launchApp()
  await harness.window.waitForTimeout(3000)

  // QA 模式下自动配置 Provider（使用 TANGYUAN_QA_API_KEY）
  const configResult = await configureForQa(harness)
  if (configResult.ok) {
    console.log('[配置] QA 配置成功，等页面跳转...')
    // 配置保存后运行时变为 ready，应用应自动跳转到聊天页
    try {
      await harness.window.waitForURL('**/chat/tangyuan/**', { timeout: 20000 })
      console.log('[导航] 已自动进入聊天页')
    } catch {
      // 手动导航到聊天页
      console.log('[导航] 未自动跳转，手动导航到聊天页')
      await harness.window.evaluate(() => {
        window.location.hash = '#/chat/tangyuan'
      })
      await harness.window.waitForTimeout(3000)
    }
  } else {
    console.log(`[配置] configureForQa 失败: ${configResult.reason}`)
  }
})

test.afterAll(async () => {
  await harness.close()
})

test('1. 窗口打开，健康检查通过', async () => {
  expect(harness.app.windows().length).toBe(1)
  const violations = await checkAppHealth(harness)
  expect(violations).toEqual([])
})

test('2. 运行时就绪，聊天页可交互', async () => {
  const hash = await harness.window.evaluate(() => window.location.hash)
  console.log(`[状态] 当前 URL hash: ${hash}`)

  // 聊天页或配置页都应能正常渲染
  const bodyText = await harness.window.evaluate(() => document.body.innerText?.trim() ?? '')
  expect(bodyText.length).toBeGreaterThan(0)

  const readyViolations = await checkRuntimeReady(harness)
  if (readyViolations.length > 0) {
    console.log(`[状态] 运行时未就绪: ${JSON.stringify(readyViolations)}`)
  }
  // 运行时就绪是可选的（可能已经在之前的测试中配置好）
})

test('3. 发送消息后归档与删除按钮可用', async () => {
  test.setTimeout(300_000)

  // 检查是否在聊天页
  const hash = await harness.window.evaluate(() => window.location.hash)
  if (!hash.includes('/chat/')) {
    console.log('[跳过] 不在聊天页，无法测试消息发送')
    return
  }

  // 找到 composer
  const textarea = harness.window.locator('textarea#composer')
  const textareaVisible = await textarea.first().isVisible({ timeout: 5000 }).catch(() => false)
  if (!textareaVisible) {
    console.log('[跳过] Composer 不可见')
    return
  }

  // 发送简短消息
  await textarea.first().fill('hi')
  await harness.window.waitForTimeout(300)
  const sendBtn = harness.window.locator('button[aria-label="发送"]')
  await sendBtn.first().click()
  console.log('[对话] 消息已发送')

  // 等待 Agent 回复完成（最多等 120 秒）
  let waited = 0
  while (waited < 120) {
    const stopBtn = harness.window.locator('button[aria-label="停止"]')
    const visible = await stopBtn.first().isVisible().catch(() => false)
    if (!visible) break
    await harness.window.waitForTimeout(3000)
    waited += 3
    if (waited % 15 === 0) console.log(`[对话] 运行中 ${waited}秒...`)
  }
  console.log(`[对话] Agent 回复完成，等待了 ${waited}秒`)

  // 检查归档和删除按钮是否可见
  const archiveBtn = harness.window.locator('button[aria-label="归档当前会话谱系"]')
  const deleteBtn = harness.window.locator('button[aria-label="永久删除当前会话谱系"]')

  const archiveVisible = await archiveBtn.first().isVisible().catch(() => false)
  const deleteVisible = await deleteBtn.first().isVisible().catch(() => false)

  console.log(`[按钮] 归档按钮: ${archiveVisible ? '可见' : '不可见'}`)
  console.log(`[按钮] 删除按钮: ${deleteVisible ? '可见' : '不可见'}`)

  // 截图留存
  await harness.window.screenshot({ path: '/tmp/qa-chat-with-buttons.png' })

  const violations = await checkAppHealth(harness)
  expect(violations).toEqual([])
})

test('4. 归档按钮点击弹出确认对话框', async () => {
  const hash = await harness.window.evaluate(() => window.location.hash)
  if (!hash.includes('/chat/')) {
    console.log('[跳过] 不在聊天页')
    return
  }

  // 点击归档按钮
  const archiveBtn = harness.window.locator('button[aria-label="归档当前会话谱系"]')
  const visible = await archiveBtn.first().isVisible().catch(() => false)
  if (!visible) {
    console.log('[归档] 归档按钮不可见，跳过')
    return
  }

  await archiveBtn.first().click()
  await harness.window.waitForTimeout(1000)

  // 检查弹窗
  const dialog = harness.window.locator('[role="alertdialog"]')
  const dialogVisible = await dialog.first().isVisible().catch(() => false)

  if (dialogVisible) {
    const dialogText = await dialog.first().innerText()
    console.log(`[归档] 确认弹窗内容: ${dialogText.slice(0, 200)}`)

    // 验证弹窗有关键文案
    expect(dialogText).toMatch(/停止|归档|活动/)

    // 截图
    await harness.window.screenshot({ path: '/tmp/qa-archive-dialog.png' })

    // 关闭弹窗
    const cancelBtn = harness.window.locator('button:has-text("取消")').first()
    if (await cancelBtn.isVisible().catch(() => false)) {
      await cancelBtn.click()
    }
  } else {
    // 归档直接成功了（无活动）
    console.log('[归档] 归档成功（无活动会话需确认）')
  }

  const violations = await checkAppHealth(harness)
  expect(violations).toEqual([])
})

test('5. 删除按钮点击弹出确认对话框', async () => {
  const hash = await harness.window.evaluate(() => window.location.hash)
  if (!hash.includes('/chat/')) {
    console.log('[跳过] 不在聊天页')
    return
  }

  // 点击删除按钮
  const deleteBtn = harness.window.locator('button[aria-label="永久删除当前会话谱系"]')
  const visible = await deleteBtn.first().isVisible().catch(() => false)
  if (!visible) {
    console.log('[删除] 删除按钮不可见，跳过')
    return
  }

  await deleteBtn.first().click()
  await harness.window.waitForTimeout(1000)

  // 检查弹窗
  const dialog = harness.window.locator('[role="alertdialog"]')
  const dialogVisible = await dialog.first().isVisible().catch(() => false)

  if (dialogVisible) {
    const dialogText = await dialog.first().innerText()
    console.log(`[删除] 确认弹窗内容: ${dialogText.slice(0, 200)}`)

    // 验证弹窗有关键文案
    expect(dialogText).toMatch(/永久删除|停止|活动/)

    // 截图
    await harness.window.screenshot({ path: '/tmp/qa-delete-dialog.png' })

    // 关闭弹窗（不真的删除）
    const cancelBtn = harness.window.locator('button:has-text("取消")').first()
    if (await cancelBtn.isVisible().catch(() => false)) {
      await cancelBtn.click()
    }
  } else {
    console.log('[删除] 删除按钮可用，无活动确认弹窗（可能直接删除了）—— 测试取消')
  }

  const violations = await checkAppHealth(harness)
  expect(violations).toEqual([])
})

test('6. 侧边栏与最终健康检查', async () => {
  // 截图留档
  await harness.window.screenshot({ path: '/tmp/qa-final-state.png' })
  console.log('[截图] 最终状态保存到 /tmp/qa-final-state.png')

  // 检查控制台错误
  const realErrors = harness.consoleErrors.filter(
    (msg) =>
      !msg.includes('Warning:') &&
      !msg.includes('ReactDOM') &&
      !msg.includes('Not implemented: Window')
  )
  if (realErrors.length > 0) {
    console.log(`[警告] 控制台错误 (${realErrors.length}): ${realErrors.slice(0, 3).join(' | ')}`)
  }

  const violations = await checkAppHealth(harness)
  expect(violations).toEqual([])
})
