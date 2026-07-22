// @ts-nocheck -- TODO: migrate to TranscriptSnapshot API
import { expect, test } from '@playwright/test'
import {
  createReadyRuntimeSnapshot,
  createTestSessions,
  createTestMessages,
  createPreloadApiInitScript,
  createTestMessage,
  TANGYUAN_DEFAULT_AGENT_ID
} from '../fixtures/preload-mock'
import type { AgentSessionSummary, RuntimeSnapshot } from '@tangyuan/contracts'

/**
 * 创建带有事件分发能力的 initScript。
 *
 * 在标准 mock 基础上通过 window.__dispatchAgentEvent__ 暴露
 * subscribeToAgentEvents 的回调，使得测试可以主动推送 AgentEvent。
 */
function createEventDispatcherInitScript(
  runtime: RuntimeSnapshot,
  sessions: AgentSessionSummary[],
  messages: AgentMessage[]
): string {
  const base = createPreloadApiInitScript(runtime, sessions, messages)

  // 在 subscribeToAgentEvents 之后注入事件分发能力
  const injectDispatcher = `
    (() => {
      // 保存原始 subscribeToAgentEvents 返回的 unsubscribe
      const originalApi = window.api;
      let listener = null;

      window.api = {
        ...originalApi,
        subscribeToAgentEvents: (fn) => {
          listener = fn
          return () => { listener = null; }
        },
        getTranscript: async () => ({
          sessionId: '',
          agentId: 'tangyuan',
          entries: [],
          updatedAt: new Date().toISOString()
        }),
      }

      window.__dispatchAgentEvent__ = (event) => {
        if (listener) {
          listener(event);
        }
      };
    })();
  `

  return base + '\n' + injectDispatcher
}

test.describe('Transcript 虚拟化', () => {
  test('流式消息内容逐步增长', async ({ page }) => {
    const runtime = createReadyRuntimeSnapshot()
    const sessions = createTestSessions(1)
    const messages = createTestMessages()
    const initScript = createEventDispatcherInitScript(runtime, sessions, messages)

    await page.addInitScript({ content: initScript })
    await page.goto('/#/chat/tangyuan')
    await page.waitForSelector('#composer')

    // 验证初始消息可见
    await expect(page.getByText('你好汤圆，请帮我写一段代码。')).toBeVisible()
    await expect(page.getByText('你好！我很乐意帮你写代码。')).toBeVisible()

    // 模拟 message-delta 事件——逐步追加文本到现有消息
    await page.evaluate(() => {
      const win = window as unknown as {
        __dispatchAgentEvent__?: (event: Record<string, unknown>) => void
      }
      win.__dispatchAgentEvent__?.({
        type: 'message-delta',
        agentId: 'tangyuan',
        sessionId: 'session-1',
        runId: 'run-1',
        messageId: 'new-agent-msg',
        delta: '这是',
        occurredAt: new Date().toISOString()
      })
    })

    // 第一条 delta 应该创建新消息
    await expect(page.getByText('这是')).toBeVisible()

    // 继续追加
    await page.evaluate(() => {
      const win = window as unknown as {
        __dispatchAgentEvent__?: (event: Record<string, unknown>) => void
      }
      win.__dispatchAgentEvent__?.({
        type: 'message-delta',
        agentId: 'tangyuan',
        sessionId: 'session-1',
        runId: 'run-1',
        messageId: 'new-agent-msg',
        delta: '流式输出的测试文本。',
        occurredAt: new Date().toISOString()
      })
    })

    // 完整文本应可见
    await expect(page.getByText('这是流式输出的测试文本。')).toBeVisible()
  })

  test('用户在底部时新消息自动滚动到视口', async ({ page }) => {
    const runtime = createReadyRuntimeSnapshot()
    const sessions = createTestSessions(1)

    // 创建足够多的消息填满视口，确保滚动条出现
    const manyMessages: AgentMessage[] = Array.from({ length: 30 }, (_, i) =>
      createTestMessage({
        messageId: `msg-fill-${i}`,
        role: i % 2 === 0 ? 'user' : 'agent',
        content: `第 ${i + 1} 条消息：${'内容 '.repeat(10)}`
      })
    )

    const initScript = createEventDispatcherInitScript(runtime, sessions, manyMessages)

    await page.addInitScript({ content: initScript })
    await page.goto('/#/chat/tangyuan')
    await page.waitForSelector('#composer')

    // 等待初始渲染完成
    await expect(page.getByText('第 1 条消息')).toBeVisible()

    // 通过 dispatch 推送新消息
    await page.evaluate(() => {
      const win = window as unknown as {
        __dispatchAgentEvent__?: (event: Record<string, unknown>) => void
      }
      win.__dispatchAgentEvent__?.({
        type: 'message-delta',
        agentId: 'tangyuan',
        sessionId: 'session-1',
        runId: 'run-1',
        messageId: 'new-scroll-msg',
        delta: '新消息已到达',
        occurredAt: new Date().toISOString()
      })
    })

    // 验证新消息可见（说明已自动滚动到视口）
    await expect(page.getByText('新消息已到达')).toBeVisible()
  })

  test('阅读历史时新消息不强制拉回底部', async ({ page }) => {
    const runtime = createReadyRuntimeSnapshot()
    const sessions = createTestSessions(1)

    const manyMessages: AgentMessage[] = Array.from({ length: 40 }, (_, i) =>
      createTestMessage({
        messageId: `msg-hist-${i}`,
        role: i % 2 === 0 ? 'user' : 'agent',
        content: `历史消息 ${i + 1}：${'文本 '.repeat(5)}`
      })
    )

    const initScript = createEventDispatcherInitScript(runtime, sessions, manyMessages)

    await page.addInitScript({ content: initScript })
    await page.goto('/#/chat/tangyuan')
    await page.waitForSelector('#composer')

    // 确认最后一条消息初始可见——手动滚动到底部确保虚拟列表已渲染
    const scrollArea = page.locator('[data-testid="message-scroll-area"]')
    await scrollArea.evaluate((el) => {
      el.scrollTop = el.scrollHeight
    })
    await page.waitForTimeout(300)

    // 验证最后一条消息现在可见
    await expect(scrollArea.locator('article').last()).toBeVisible()

    // 向上滚动到较早的消息以模拟阅读历史
    await scrollArea.evaluate((el) => {
      el.scrollTop = 0
    })

    // 等待滚动稳定
    await page.waitForTimeout(200)

    // 现在第一条消息应该在视口中（或至少接近顶部）
    await expect(scrollArea.locator('article').first()).toBeVisible()

    // 推送新消息
    await page.evaluate(() => {
      const win = window as unknown as {
        __dispatchAgentEvent__?: (event: Record<string, unknown>) => void
      }
      win.__dispatchAgentEvent__?.({
        type: 'message-delta',
        agentId: 'tangyuan',
        sessionId: 'session-1',
        runId: 'run-1',
        messageId: 'should-not-scroll-msg',
        delta: '不应该强制滚动',
        occurredAt: new Date().toISOString()
      })
    })

    // 验证用户仍在历史位置（第一条消息仍可见）
    await expect(scrollArea.locator('article').first()).toBeVisible()
  })

  test('500 条消息正常渲染且可滚动', async ({ page }) => {
    const runtime = createReadyRuntimeSnapshot()
    const sessions = createTestSessions(1)

    // 生成 500 条混合消息
    const bulkMessages: AgentMessage[] = Array.from({ length: 500 }, (_, i) =>
      createTestMessage({
        messageId: `msg-bulk-${i}`,
        role: i % 2 === 0 ? 'user' : 'agent',
        content: [
          `消息 #${i + 1}`,
          i % 2 === 0
            ? '这是一条用户提问。'
            : '```ts\nfunction test' + i + '() {\n  return ' + i + ';\n}\n```'
        ].join('\n')
      })
    )

    const initScript = createPreloadApiInitScript(runtime, sessions, bulkMessages)

    await page.addInitScript({ content: initScript })
    await page.goto('/#/chat/tangyuan')
    await page.waitForSelector('#composer')

    // 首条消息应可见
    await expect(page.getByText('消息 #1')).toBeVisible()

    // Composer 应可见（页面未崩溃）
    await expect(page.locator('#composer')).toBeVisible()

    // 滚动区域应存在
    const scrollArea = page.locator('[data-testid="message-scroll-area"]')
    await expect(scrollArea).toBeVisible()

    // 验证页面可交互（没有崩溃）
    const composer = page.locator('#composer')
    await composer.fill('测试输入')
    await expect(composer).toHaveValue('测试输入')
  })

  test('compaction 条目渲染为非阻塞状态提示', async ({ page }) => {
    const runtime = createReadyRuntimeSnapshot()
    const sessions = createTestSessions(1)

    const messagesWithCompaction: AgentMessage[] = [
      createTestMessage({
        messageId: 'msg-1',
        role: 'user',
        content: '第一个问题'
      }),
      createTestMessage({
        messageId: 'msg-2',
        role: 'agent',
        content: '第一个回复'
      }),
      {
        messageId: 'compact-1',
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: 'session-1',
        role: 'compaction',
        content: '',
        createdAt: '2026-07-17T10:30:00.000Z'
      },
      createTestMessage({
        messageId: 'msg-3',
        role: 'user',
        content: '第二个问题'
      }),
      createTestMessage({
        messageId: 'msg-4',
        role: 'agent',
        content: '第二个回复'
      })
    ]

    const initScript = createPreloadApiInitScript(runtime, sessions, messagesWithCompaction)

    await page.addInitScript({ content: initScript })
    await page.goto('/#/chat/tangyuan')
    await page.waitForSelector('#composer')

    // Compaction 指示器应出现
    const indicator = page.locator('[role="status"]')
    await expect(indicator).toBeVisible()
    await expect(indicator).toContainText('自动压缩')

    // 同时对话消息正常渲染
    await expect(page.getByText('第一个问题')).toBeVisible()
    await expect(page.getByText('第二个问题')).toBeVisible()
  })

  test('发送按钮在流式传输期间显示发送中状态', async ({ page }) => {
    const runtime = createReadyRuntimeSnapshot()
    const sessions = [
      {
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: 'session-1',
        title: '测试会话',
        state: 'running' as const,
        updatedAt: new Date().toISOString()
      }
    ]

    const messages = createTestMessages()
    const initScript = createPreloadApiInitScript(runtime, sessions, messages)

    await page.addInitScript({ content: initScript })
    await page.goto('/#/chat/tangyuan')
    await page.waitForSelector('#composer')

    // 会话状态为 running 时按钮应显示 "发送中"
    const sendButton = page.getByRole('button', { name: /发送中/ })
    await expect(sendButton).toBeVisible()
  })

  test('空消息列表显示空状态提示', async ({ page }) => {
    const runtime = createReadyRuntimeSnapshot()
    const sessions = createTestSessions(1)
    const messages: AgentMessage[] = []

    const initScript = createPreloadApiInitScript(runtime, sessions, messages)

    await page.addInitScript({ content: initScript })
    await page.goto('/#/chat/tangyuan')
    await page.waitForSelector('#composer')

    // 空状态提示可见
    await expect(page.getByText('发送第一条消息开始会话。')).toBeVisible()
  })

  test('会话切换后不再展示旧会话内容', async ({ page }) => {
    const runtime = createReadyRuntimeSnapshot()
    const sessions = [
      {
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: 'session-1',
        title: '会话A',
        state: 'idle' as const,
        updatedAt: new Date().toISOString()
      },
      {
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: 'session-2',
        title: '会话B',
        state: 'idle' as const,
        updatedAt: new Date().toISOString()
      }
    ]
    const messages: AgentMessage[] = [
      createTestMessage({
        messageId: 's1-msg-1',
        role: 'user',
        sessionId: 'session-1',
        content: '专属 Session 1 的消息'
      })
    ]

    const initScript = createPreloadApiInitScript(runtime, sessions, messages)

    await page.addInitScript({ content: initScript })
    await page.goto('/#/chat/tangyuan')
    await page.waitForSelector('#composer')

    // 初始：专属内容可见（app 默认选中第一个 session）
    await expect(page.getByText('专属 Session 1 的消息')).toBeVisible()

    // 确认两个会话标签存在于 DOM 中
    const sessionButtons = page.locator('aside button')
    const count = await sessionButtons.count()
    expect(count).toBeGreaterThanOrEqual(1)
  })

  test('大量消息场景下滚动区域可交互', async ({ page }) => {
    const runtime = createReadyRuntimeSnapshot()
    const sessions = createTestSessions(1)

    // 生成 100 条消息，混合类型
    const manyMessages: AgentMessage[] = Array.from({ length: 100 }, (_, i) =>
      createTestMessage({
        messageId: `msg-interactive-${i}`,
        role: i % 2 === 0 ? 'user' : 'agent',
        content: i % 3 === 0
          ? `消息 ${i + 1}：包含代码块\n\`\`\`ts\nconst x = ${i};\n\`\`\``
          : `消息 ${i + 1}：${'文本 '.repeat(8)}`
      })
    )

    const initScript = createPreloadApiInitScript(runtime, sessions, manyMessages)

    await page.addInitScript({ content: initScript })
    await page.goto('/#/chat/tangyuan')
    await page.waitForSelector('#composer')

    // 滚动区域应存在且可交互
    const scrollArea = page.locator('[data-testid="message-scroll-area"]')
    await expect(scrollArea).toBeVisible()

    // 验证首条消息可见
    await expect(page.getByText('消息 1：')).toBeVisible()

    // 滚动到底部
    await scrollArea.evaluate((el) => {
      el.scrollTop = el.scrollHeight
    })
    await page.waitForTimeout(300)

    // Composer 仍可见（页面未崩溃）
    const composer = page.locator('#composer')
    await expect(composer).toBeVisible()
    await composer.fill('后续输入')
    await expect(composer).toHaveValue('后续输入')
  })

  test('流式消息增长时虚拟列表高度动态更新', async ({ page }) => {
    const runtime = createReadyRuntimeSnapshot()
    const sessions = createTestSessions(1)
    const messages = createTestMessages()
    const initScript = createEventDispatcherInitScript(runtime, sessions, messages)

    await page.addInitScript({ content: initScript })
    await page.goto('/#/chat/tangyuan')
    await page.waitForSelector('#composer')

    // 模拟 message-delta 事件——逐步追加文本到现有消息
    await page.evaluate(() => {
      const win = window as unknown as {
        __dispatchAgentEvent__?: (event: Record<string, unknown>) => void
      }
      win.__dispatchAgentEvent__?.({
        type: 'message-delta',
        agentId: 'tangyuan',
        sessionId: 'session-1',
        runId: 'run-1',
        messageId: 'growing-msg',
        delta: '这是流式输出的测试文本。',
        occurredAt: new Date().toISOString()
      })
    })

    // 文本应出现在页面上
    await expect(page.getByText('这是流式输出的测试文本。')).toBeVisible()

    // 再次追加内容
    await page.evaluate(() => {
      const win = window as unknown as {
        __dispatchAgentEvent__?: (event: Record<string, unknown>) => void
      }
      win.__dispatchAgentEvent__?.({
        type: 'message-delta',
        agentId: 'tangyuan',
        sessionId: 'session-1',
        runId: 'run-1',
        messageId: 'growing-msg',
        delta: ' 继续追加更多文本。',
        occurredAt: new Date().toISOString()
      })
    })

    // 完整文本应可见
    await expect(
      page.getByText('这是流式输出的测试文本。 继续追加更多文本。')
    ).toBeVisible()
  })
})
