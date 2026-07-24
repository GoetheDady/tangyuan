import { test, expect } from '@playwright/test'
import { launchApp, configureForQa } from './lib/app-harness'
import type { AppHarness } from './lib/app-harness'
import { checkAppHealth, checkRuntimeReady } from './lib/invariants'
import type { InvariantViolation } from './lib/invariants'
import { sendAndAwaitReply } from './lib/conversation'
import { fileIssueForViolation } from './lib/issue-filing'

/**
 * 自动化 QA：真实 Electron + 真实模型对话的全链路冒烟。
 *
 * 「硬骨架 + 探索空间」：
 * - 硬骨架（本文件写死）：启动应用、健康检查、运行时就绪、发消息等真实回复、
 *   技术不变量断言、issue 去重与创建。判据仅在技术层面，不判回复内容质量。
 * - 探索空间（Hermes 决定）：发什么内容，通过 QA_MESSAGE 环境变量传入。
 *
 * 用法（本地/定时，需真实 HOME 与钥匙串以解密 Provider Key）：
 *   pnpm --filter apps-desktop qa
 *   QA_MESSAGE="帮我读一下 README" pnpm --filter apps-desktop qa
 *   QA_FILE_ISSUES=1 QA_MESSAGE="..." pnpm --filter apps-desktop qa
 *
 * 绝不进 CI：依赖真实 API Key、真实模型调用与本机钥匙串。
 */
test.describe('真实模型对话 QA', () => {
  let harness: AppHarness
  const violations: InvariantViolation[] = []

  const sentContent = process.env.QA_MESSAGE ?? '你好，请用一句话介绍你自己。'
  const scenario = '新建会话并发送一条消息，等待真实模型回复'

  test.beforeAll(async () => {
    harness = await launchApp()
    // QA 模式：用环境变量注入的测试 key 配置并真实验证运行时。
    const configured = await configureForQa(harness)
    if (!configured.ok) {
      console.warn(`[QA] 配置未完成：${configured.reason ?? '未知'}`)
    }
  })

  test.afterAll(async () => {
    if (harness) await harness.close()

    // 收敛去重后按需提 issue
    const seen = new Set<string>()
    const unique = violations.filter((v) => {
      if (seen.has(v.code)) return false
      seen.add(v.code)
      return true
    })
    if (unique.length > 0 && process.env.QA_FILE_ISSUES === '1') {
      for (const v of unique) {
        const outcome = fileIssueForViolation(v, { scenario, sentContent })
        console.log(`[QA:${v.code}] → ${outcome}`)
      }
    }
  })

  test('应用启动后健康、无运行时错误', async () => {
    const found = await checkAppHealth(harness)
    violations.push(...found)
    expect(found, JSON.stringify(found, null, 2)).toHaveLength(0)
  })

  test('运行时就绪（真实 Provider Key 可解密）', async () => {
    const found = await checkRuntimeReady(harness)
    violations.push(...found)
    expect(found, JSON.stringify(found, null, 2)).toHaveLength(0)
  })

  test('发送消息并收到真实模型回复', async () => {
    const result = await sendAndAwaitReply(harness, sentContent)
    violations.push(...result.violations)
    violations.push(...(await checkAppHealth(harness)))
    expect(result.violations, JSON.stringify(result.violations, null, 2)).toHaveLength(0)
  })
})
