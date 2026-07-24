import { test, expect } from '@playwright/test'
import { launchApp, configureForQa } from './lib/app-harness'
import type { AppHarness } from './lib/app-harness'
import { checkAppHealth, checkRuntimeReady } from './lib/invariants'
import type { InvariantViolation } from './lib/invariants'
import {
  createSession,
  sendMessageAndAwait,
  retryAndAwait,
  sendThenCancel,
  firstUserMessageId
} from './lib/conversation'
import { checkSessionListed, checkAgentsListed } from './lib/management'
import { fileIssueForViolation } from './lib/issue-filing'

/**
 * 自动化 QA：真实 Electron + 真实模型对话的多场景冒烟。
 *
 * 「硬骨架 + 探索空间」：场景由 Hermes 通过 QA_MESSAGE 影响（探索空间），
 * 判据始终是同一套技术不变量（硬骨架），仅在技术层面判定，不判回复内容质量。
 *
 * 覆盖场景：单轮对话、多轮上下文对话、重试、运行中取消、会话管理、Agent 生命周期。
 */
test.describe('真实模型对话 QA', () => {
  let harness: AppHarness
  const violations: InvariantViolation[] = []

  const sentContent = process.env.QA_MESSAGE ?? '你好，请用一句话介绍你自己。'

  test.beforeAll(async () => {
    harness = await launchApp()
    const configured = await configureForQa(harness)
    if (!configured.ok) {
      console.warn(`[QA] 配置未完成：${configured.reason ?? '未知'}`)
    }
  })

  test.afterAll(async () => {
    if (harness) await harness.close()

    const seen = new Set<string>()
    const unique = violations.filter((v) => {
      if (seen.has(v.code)) return false
      seen.add(v.code)
      return true
    })
    if (unique.length > 0 && process.env.QA_FILE_ISSUES === '1') {
      for (const v of unique) {
        const outcome = fileIssueForViolation(v, {
          scenario: '真实模型对话多场景冒烟',
          sentContent
        })
        console.log(`[QA:${v.code}] → ${outcome}`)
      }
    }
  })

  test('应用启动后健康、无运行时错误', async () => {
    const found = await checkAppHealth(harness)
    violations.push(...found)
    expect(found, JSON.stringify(found, null, 2)).toHaveLength(0)
  })

  test('运行时就绪（真实 Provider Key 可用）', async () => {
    const found = await checkRuntimeReady(harness)
    violations.push(...found)
    expect(found, JSON.stringify(found, null, 2)).toHaveLength(0)
  })

  test('场景：单轮对话收到真实回复', async () => {
    const sessionId = await createSession(harness)
    const listViolations = await checkSessionListed(harness, sessionId)
    const run = await sendMessageAndAwait(harness, sessionId, sentContent)
    const health = await checkAppHealth(harness)
    const found = [...listViolations, ...run.violations, ...health]
    violations.push(...found)
    expect(found, JSON.stringify(found, null, 2)).toHaveLength(0)
  })

  test('场景：多轮上下文对话', async () => {
    const sessionId = await createSession(harness)
    const first = await sendMessageAndAwait(harness, sessionId, '我叫小明，请记住。')
    const second = await sendMessageAndAwait(harness, sessionId, '我叫什么？')
    const found = [...first.violations, ...second.violations]
    violations.push(...found)
    expect(found, JSON.stringify(found, null, 2)).toHaveLength(0)
  })

  test('场景：重试上一条消息', async () => {
    const sessionId = await createSession(harness)
    await sendMessageAndAwait(harness, sessionId, sentContent)
    const userMessageId = await firstUserMessageId(harness, sessionId)
    if (!userMessageId) {
      const v: InvariantViolation = {
        code: 'missing-user-message',
        message: '发送消息后 transcript 中找不到用户消息，无法测试重试。'
      }
      violations.push(v)
      expect([v], JSON.stringify([v], null, 2)).toHaveLength(0)
      return
    }
    const retry = await retryAndAwait(harness, sessionId, userMessageId)
    const health = await checkAppHealth(harness)
    const found = [...retry.violations, ...health]
    violations.push(...found)
    expect(found, JSON.stringify(found, null, 2)).toHaveLength(0)
  })

  test('场景：运行中取消（尽力而为）', async () => {
    const sessionId = await createSession(harness)
    const run = await sendThenCancel(harness, sessionId, '请写一段较长的文字。')
    const health = await checkAppHealth(harness)
    // 取消场景不把「无回复」视为违反；只断言状态机合法与无 Runtime 错误
    const found = [...run.violations, ...health]
    violations.push(...found)
    expect(found, JSON.stringify(found, null, 2)).toHaveLength(0)
  })

  test('场景：Agent 列表返回默认 Agent 且状态合法', async () => {
    const found = await checkAgentsListed(harness)
    violations.push(...found)
    expect(found, JSON.stringify(found, null, 2)).toHaveLength(0)
  })
})
