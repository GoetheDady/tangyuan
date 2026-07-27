/**
 * 阶段 1：初始化配置 + Bootstrap
 *
 * QA 模式下主进程自动配置 Provider，启动后直接进入聊天页/Bootstrap 流程。
 * 在 Bootstrap 过程中处理审批卡片和澄清卡片交互。
 */
import { test, expect } from '@playwright/test'
import { launchApp } from './lib/app-harness'
import { checkAppHealth } from './lib/invariants'
import type { AppHarness } from './lib/app-harness'

let harness: AppHarness

test.beforeAll(async () => {
  harness = await launchApp()
  await harness.window.waitForTimeout(3000)
})

test.afterAll(async () => {
  await harness.close()
})

test('窗口打开，健康检查通过', async () => {
  expect(harness.app.windows().length).toBe(1)
  const violations = await checkAppHealth(harness)
  expect(violations).toEqual([])
})

test('QA 模式自动配置后进入聊天页', async () => {
  const hash = await harness.window.evaluate(() => window.location.hash)
  expect(hash).toBe('#/chat/tangyuan')
  const bodyText = await harness.window.evaluate(() => document.body.innerText)
  expect(bodyText.length).toBeGreaterThan(0)
  console.log('已在聊天页')
})

test('完成 Bootstrap 初始化：交互式回答 Agent 问题', async () => {
  test.setTimeout(600_000) // 10分钟

  let attempts = 0
  const maxAttempts = 40
  let messageIndex = 0

  const messages = [
    '你好，请做自我介绍',
    '叫我测试员',
    '我是做自动化测试的',
    '请直接分配任务，不需要先确认',
    '可以读文件和写文件',
    '需要审批的命令严格审批',
    '按默认设置来',
    '没问题了，开始正常对话吧',
    '继续',
    '你好'
  ]

  const answers = [
    '叫我测试员',
    '自动化测试',
    '可以自动记录',
    '我自己决定',
    '按默认来',
    '继续'
  ]

  async function isAgentRunning(): Promise<boolean> {
    const stopBtn = harness.window.locator('button[aria-label="停止"]')
    return (await stopBtn.count()) > 0 && (await stopBtn.first().isVisible())
  }

  async function evaluatePendingInteractions(): Promise<'handled' | 'nothing'> {
    // 1) 检查 Bash 审批卡片（data-testid 不确定，直接用文本定位）
    const approveBtns = harness.window.locator('button', { hasText: '允许本次' })
    if ((await approveBtns.count()) > 0 && (await approveBtns.first().isVisible())) {
      console.log('→ 允许 Bash 审批')
      await approveBtns.first().click()
      await harness.window.waitForTimeout(1000)
      return 'handled'
    }

    // 可能 "始终允许" 或 "拒绝"
    const alwaysBtn = harness.window.locator('button', { hasText: '始终允许' })
    if ((await alwaysBtn.count()) > 0 && (await alwaysBtn.first().isVisible())) {
      console.log('→ 始终允许 Bash')
      await alwaysBtn.first().click()
      await harness.window.waitForTimeout(1000)
      return 'handled'
    }

    const rejectBtns = harness.window.locator('button', { hasText: '拒绝' })
    if ((await rejectBtns.count()) > 0 && (await rejectBtns.first().isVisible())) {
      console.log('→ 拒绝 Bash')
      await rejectBtns.first().click()
      await harness.window.waitForTimeout(1000)
      return 'handled'
    }

    // 2) 检查澄清卡片
    const clarificationCards = harness.window.locator('[data-testid="clarification-card"]')
    if ((await clarificationCards.count()) > 0) {
      const card = clarificationCards.first()
      // 是否已回答
      if ((await card.locator('text=已回答').count()) > 0) {
        return 'nothing'
      }

      // 预设选项
      const options = card.locator('button[role="radio"]:not([disabled])')
      if ((await options.count()) > 0) {
        const text = (await options.first().textContent()) ?? ''
        console.log(`→ 澄清选预设：${text}`)
        await options.first().click()
        await harness.window.waitForTimeout(1500)
        return 'handled'
      }

      // 自定义输入
      const customInput = card.locator('input[aria-label="自定义答案输入"]')
      if (await customInput.isVisible()) {
        const msg = answers[messageIndex % answers.length]
        messageIndex++
        console.log(`→ 澄清自定义：${msg}`)
        await customInput.fill(msg)
        await card.locator('button[aria-label="提交自定义答案"]').click()
        await harness.window.waitForTimeout(1500)
        return 'handled'
      }
    }

    return 'nothing'
  }

  async function waitForQuiet(timeoutSec: number): Promise<'quiet' | 'timeout'> {
    const start = Date.now()
    while (Date.now() - start < timeoutSec * 1000) {
      // 先处理任何待交互的卡片
      const result = await evaluatePendingInteractions()
      if (result === 'handled') continue

      // 再等 Agent 消化
      await harness.window.waitForTimeout(2000)
      if (!(await isAgentRunning())) {
        return 'quiet'
      }
    }
    return 'timeout'
  }

  while (attempts < maxAttempts) {
    attempts++
    console.log(`\n=== 轮次 ${attempts} ===`)

    // 健康检查
    const violations = await checkAppHealth(harness)
    if (violations.length > 0) {
      console.log('⚠️ 健康异常：', JSON.stringify(violations))
      break
    }

    // 处理待交互卡片
    const handled = await evaluatePendingInteractions()
    if (handled === 'handled') continue

    // 检查 textarea 是否可用
    const textarea = harness.window.locator('textarea#composer')
    if ((await textarea.count()) === 0) {
      console.log('等待 textarea 出现...')
      await harness.window.waitForTimeout(2000)
      continue
    }

    // 等 Agent 完成
    if (await isAgentRunning()) {
      console.log('Agent 运行中，处理交互...')
      const quiet = await waitForQuiet(30)
      if (quiet === 'timeout') {
        console.log('等待超时，继续尝试发消息')
      }
      continue
    }

    // 发消息
    const msg = messages[messageIndex % messages.length]
    messageIndex++
    await textarea.fill(msg)
    await harness.window.waitForTimeout(300)
    const sendBtn = harness.window.locator('button[aria-label="发送"]')
    const isDisabled = await sendBtn.isDisabled()
    if (isDisabled) {
      console.log('发送按钮禁用，等待...')
      await harness.window.waitForTimeout(2000)
      continue
    }
    console.log(`发送：${msg}`)
    await sendBtn.click()
    await waitForQuiet(120)
  }

  console.log(`Bootstrap 流程结束，共 ${attempts} 轮`)

  // 最终健康检查
  const violations = await checkAppHealth(harness)
  expect(violations).toEqual([])
})
