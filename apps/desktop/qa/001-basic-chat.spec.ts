/**
 * 阶段 1：初始化配置 + Bootstrap
 *
 * QA 模式下主进程自动配置 Provider，启动后直接进入聊天页/Bootstrap 流程。
 * 主要验证：发送消息后 Agent 能正常回复，运行状态能正确切换。
 * 如果 Agent 长时间运行不停止，则记录为 bug。
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
  expect(hash).toBe('#/chat/tangyuan')
  const readyViolations = await checkRuntimeReady(harness)
  expect(readyViolations).toEqual([])
})

test('发送一条消息并确认 Agent 回复', async () => {
  test.setTimeout(300_000) // 5分

  const textarea = harness.window.locator('textarea#composer')
  await expect(textarea).toBeVisible({ timeout: 5000 })

  // 发一条简单的消息
  await textarea.fill('你好，请做个自我介绍')
  await harness.window.waitForTimeout(300)

  const sendBtn = harness.window.locator('button[aria-label="发送"]')
  await sendBtn.click()
  console.log('消息已发送，等待 Agent 回应...')

  // 检测运行状态变化
  let runningSeconds = 0
  let maxRunningSeconds = 150 // 最多等 150 秒
  let agentResponded = false

  while (runningSeconds < maxRunningSeconds) {
    await harness.window.waitForTimeout(3000)
    runningSeconds += 3

    const stopBtn = harness.window.locator('button[aria-label="停止"]')
    const isRunning = (await stopBtn.count()) > 0 && (await stopBtn.first().isVisible())

    if (!isRunning) {
      console.log(`Agent 停止运行，耗时约 ${runningSeconds}秒`)
      agentResponded = true
      break
    }

    // 每 15 秒输出一次状态
    if (runningSeconds % 15 === 0) {
      const bodyText = await harness.window.evaluate(() => document.body.innerText)
      console.log(`运行中 ${runningSeconds}秒，页面片段：${bodyText.slice(bodyText.length - 100)}`)
    }
  }

  if (!agentResponded) {
    console.log(`⚠️ Agent 运行 ${maxRunningSeconds}秒 未停止，可能存在问题`)
    // 截图留存
    // 尝试点击停止按钮
    const stopBtn = harness.window.locator('button[aria-label="停止"]')
    if ((await stopBtn.count()) > 0) {
      await stopBtn.click()
      await harness.window.waitForTimeout(2000)
      console.log('已点击停止按钮')
    }
  }

  const violations = await checkAppHealth(harness)
  expect(violations).toEqual([])
  expect(agentResponded).toBe(true)
})
