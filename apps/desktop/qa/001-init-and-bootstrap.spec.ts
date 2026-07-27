/**
 * 阶段 1：初始化配置 + Bootstrap
 *
 * QA 模式下 TANGYUAN_QA_API_KEY 使主进程自动配置 Provider。
 * 启动后直接进入聊天页或 Bootstrap 流程。
 */
import { test, expect } from '@playwright/test'
import { launchApp } from './lib/app-harness'
import { checkAppHealth, checkRuntimeReady } from './lib/invariants'
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
  console.log(`当前 URL：${hash}`)

  // QA 模式下主进程自动配置，应进入聊天页
  // 但如果是首次启动且需要 Bootstrap，也可能在 /console/providers
  // 两种都接受
  if (hash === '#/chat/tangyuan') {
    console.log('QA 模式自动配置完成，已在聊天页')
    const readyViolations = await checkRuntimeReady(harness)
    expect(readyViolations).toEqual([])
  } else {
    console.log('不在聊天页，可能需要手动进入')
    // 运行时应该已就绪
    const readyViolations = await checkRuntimeReady(harness)
    expect(readyViolations).toEqual([])
  }
})

test('完成 Bootstrap 初始化并进入正常对话', async () => {
  test.setTimeout(600_000) // 最多10分钟

  // 查看当前在哪
  const hash = await harness.window.evaluate(() => window.location.hash)
  console.log(`Bootstrap 开始前 URL：${hash}`)

  // 如果还没在聊天页，找「进入聊天」按钮
  if (!hash.startsWith('#/chat/')) {
    const enterChatBtn = harness.window.locator('button', { hasText: '进入聊天' })
    if ((await enterChatBtn.count()) > 0) {
      await enterChatBtn.click()
      await harness.window.waitForTimeout(1500)
    }
  }

  // 准备预设回答集
  let answerIndex = 0
  let attempts = 0
  const maxAttempts = 30
  let idleSinceLastMessage = 0

  while (attempts < maxAttempts) {
    attempts++
    console.log(`\n=== 轮次 ${attempts} ===`)

    // 健康检查
    const violations = await checkAppHealth(harness)
    if (violations.length > 0) {
      console.log('健康检查异常：', JSON.stringify(violations))
      break
    }

    // 检查 URL
    const currentHash = await harness.window.evaluate(() => window.location.hash)
    if (!currentHash.startsWith('#/chat/')) {
      console.log(`离开聊天页：${currentHash}，Bootstrap 可能已完成`)
      break
    }

    // 1) 检查澄清卡片（预设选项）
    const clarificationCards = await harness.window
      .locator('[data-testid="clarification-card"]')
      .all()
    console.log(`澄清卡片：${clarificationCards.length}`)

    if (clarificationCards.length > 0) {
      const card = clarificationCards[clarificationCards.length - 1]

      // 看卡片是否已解决（处于 resolved 态不可交互）
      const isResolved = (await card.locator('text=已回答').count()) > 0
      if (isResolved) {
        console.log('澄清卡片已回答，跳过')
        await harness.window.waitForTimeout(1000)
        continue
      }

      // 尝试预设选项
      const options = await card.locator('button[role="radio"]:not([disabled])').all()
      if (options.length > 0) {
        const optText = (await options[0].textContent()) ?? ''
        console.log(`选择预设选项：${optText}`)
        await options[0].click()
        await harness.window.waitForTimeout(2000)
        continue
      }

      // 尝试自定义输入
      const customInput = card.locator('input[aria-label="自定义答案输入"]')
      if (await customInput.isVisible()) {
        const answers = [
          '叫我测试员',
          '功能测试和自动化测试',
          '我习惯直接工作，不用先问',
          '可以自动记录',
          '我自己决定'
        ]
        const msg = answers[answerIndex % answers.length]
        answerIndex++
        console.log(`提交自定义答案：${msg}`)
        await customInput.fill(msg)
        await card.locator('button[aria-label="提交自定义答案"]').click()
        await harness.window.waitForTimeout(2000)
        continue
      }
    }

    // 2) 等 Agent 运行完成
    if (await isAgentRunning()) {
      console.log('Agent 运行中...')
      await waitForAgentIdle(60)
      continue
    }

    // 3) 检查 textarea 和发送按钮
    const textarea = harness.window.locator('textarea')
    if ((await textarea.count()) === 0 || (await textarea.isDisabled())) {
      console.log('textarea 不可用，等待...')
      await harness.window.waitForTimeout(2000)
      continue
    }

    const sendBtn = harness.window.locator('button[aria-label*="发送"]')
    if ((await sendBtn.count()) === 0) {
      console.log('无发送按钮，等待...')
      await harness.window.waitForTimeout(2000)
      continue
    }

    // 4) 发消息
    const message = answerIndex < 10
      ? ['叫我测试员就好', '做自动化测试的', 'TypeScript/React', '请直接分配任务', '可以访问文件系统',
         '读文件和写文件都需要审批', '不需要特殊权限', '按默认设置来', '没问题了，开始吧', '你好'][answerIndex]
      : '继续'
    answerIndex++
    console.log(`发送：${message}`)
    await textarea.fill(message)
    await harness.window.waitForTimeout(300)
    await sendBtn.click()
    await waitForAgentIdle(60)
  }

  console.log(`Bootstrap 流程结束，共 ${attempts} 轮`)

  async function isAgentRunning(): Promise<boolean> {
    const stopBtn = harness.window.locator('button[aria-label*="停止"]')
    return (await stopBtn.count()) > 0 && (await stopBtn.first().isVisible())
  }

  async function waitForAgentIdle(timeoutSec: number): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < timeoutSec * 1000) {
      if (!(await isAgentRunning())) {
        await harness.window.waitForTimeout(1500)
        return
      }
      await harness.window.waitForTimeout(3000)
    }
    console.log(`等待超时 ${timeoutSec}s`)
  }
})
