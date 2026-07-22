import { expect, test } from '@playwright/test'
import type {
  AgentReplyEntry,
  AgentSessionSummary,
  RuntimeSnapshot,
  TranscriptEntry,
  TranscriptSnapshot,
  UserMessageEntry
} from '@tangyuan/contracts'
import {
  createPreloadApiInitScript,
  createReadyRuntimeSnapshot,
  createTestSessions
} from '../fixtures/preload-mock'

const FIXED_TIME = '2026-07-22T08:30:00.000Z'

function userEntry(index: number, content: string, sessionId = 'session-1'): UserMessageEntry {
  return {
    kind: 'user-message',
    index,
    messageId: `${sessionId}-user-${index}`,
    content,
    createdAt: FIXED_TIME
  }
}

function agentEntry(
  index: number,
  content: string,
  overrides: Partial<AgentReplyEntry> = {}
): AgentReplyEntry {
  return {
    kind: 'agent-reply',
    index,
    messageId: `agent-${index}`,
    content,
    createdAt: FIXED_TIME,
    attempt: null,
    turns: [],
    ...overrides
  }
}

function transcript(
  sessionId: string,
  entries: TranscriptEntry[],
  agentId = 'tangyuan'
): TranscriptSnapshot {
  return { sessionId, agentId, entries, updatedAt: FIXED_TIME }
}

function completedAttempt(runId: string): NonNullable<AgentReplyEntry['attempt']> {
  return {
    attemptId: runId,
    runId,
    status: 'completed',
    startedAt: FIXED_TIME,
    completedAt: '2026-07-22T08:30:04.000Z'
  }
}

function createRendererInitScript(
  runtime: RuntimeSnapshot,
  sessions: AgentSessionSummary[],
  transcripts: Record<string, TranscriptSnapshot>
): string {
  const base = createPreloadApiInitScript(runtime, sessions, [])
  const serialized = JSON.stringify(transcripts)

  return `${base}
    (() => {
      const transcripts = ${serialized};
      let listener = null;
      window.__retryMessageCalls__ = [];
      window.__getTranscriptCalls__ = [];
      window.api = {
        ...window.api,
        getTranscript: async (request) => {
          window.__getTranscriptCalls__.push(request);
          const result = transcripts[request.sessionId] || {
          sessionId: request.sessionId,
          agentId: request.agentId,
          entries: [],
          updatedAt: '${FIXED_TIME}'
        };
          return result;
        },
        retryMessage: async (request) => {
          window.__retryMessageCalls__.push(request);
          return transcripts[request.sessionId];
        },
        subscribeToAgentEvents: (nextListener) => {
          listener = nextListener;
          return () => { listener = null; };
        }
      };
      window.__dispatchAgentEvent__ = (event) => listener?.(event);
    })();`
}

test.describe('Transcript 真实 Renderer 回归', () => {
  test('多 turn 工具循环和最终正文共同渲染', async ({ page }) => {
    const runtime = createReadyRuntimeSnapshot()
    const sessions = createTestSessions(1)
    const structured = transcript('session-1', [
      userEntry(0, '请检查实现并运行测试。'),
      agentEntry(1, '检查完成，所有关键回归均通过。', {
        attempt: completedAttempt('run-1'),
        inReplyTo: 'session-1-user-0',
        turns: [
          {
            index: 0,
            runId: 'run-1',
            status: 'completed',
            startedAt: FIXED_TIME,
            completedAt: '2026-07-22T08:30:02.000Z',
            steps: [
              {
                index: 0,
                kind: 'thinking',
                content: '先定位相关测试与 Renderer 调用路径。',
                status: 'completed',
                startedAt: FIXED_TIME,
                completedAt: '2026-07-22T08:30:01.000Z'
              },
              {
                index: 1,
                kind: 'tool-call',
                toolCallId: 'tool-read',
                toolName: 'read',
                content: '读取对话组件和测试配置',
                status: 'completed',
                startedAt: '2026-07-22T08:30:01.000Z',
                completedAt: '2026-07-22T08:30:02.000Z'
              }
            ]
          },
          {
            index: 1,
            runId: 'run-1',
            status: 'completed',
            startedAt: '2026-07-22T08:30:02.000Z',
            completedAt: '2026-07-22T08:30:04.000Z',
            steps: [
              {
                index: 0,
                kind: 'tool-call',
                toolCallId: 'tool-test',
                toolName: 'bash',
                content: '运行 Renderer 测试',
                status: 'completed',
                startedAt: '2026-07-22T08:30:02.000Z',
                completedAt: '2026-07-22T08:30:04.000Z'
              }
            ]
          }
        ]
      })
    ])

    await page.addInitScript({
      content: createRendererInitScript(runtime, sessions, { 'session-1': structured })
    })
    await page.goto('/#/chat/tangyuan')

    await expect(page.getByText('请检查实现并运行测试。')).toBeVisible()
    await expect(page.getByRole('button', { name: '已完成执行过程' })).toBeVisible()
    await page.getByRole('button', { name: '已完成执行过程' }).click()
    await expect(page.getByText('读取对话组件和测试配置')).toBeVisible()
    await expect(page.getByText('运行 Renderer 测试')).toBeVisible()
  })

  test('transcript-delta 让流式正文逐步增长', async ({ page }) => {
    const runtime = createReadyRuntimeSnapshot()
    const sessions = createTestSessions(1).map((session) => ({
      ...session,
      state: 'running' as const
    }))
    const initial = transcript('session-1', [
      userEntry(0, '开始流式测试。'),
      agentEntry(1, '', {
        attempt: {
          attemptId: 'run-stream',
          runId: 'run-stream',
          status: 'running',
          startedAt: FIXED_TIME,
          completedAt: null
        },
        turns: []
      })
    ])

    await page.addInitScript({
      content: createRendererInitScript(runtime, sessions, { 'session-1': initial })
    })
    await page.goto('/#/chat/tangyuan')
    await page.waitForSelector('#composer')
    await expect(page.getByText('开始流式测试。')).toBeVisible()

    for (const delta of ['这是', '流式输出的测试文本。']) {
      await page.evaluate((text) => {
        window.__dispatchAgentEvent__?.({
          type: 'transcript-delta',
          agentId: 'tangyuan',
          sessionId: 'session-1',
          delta: { type: 'delta-appended', index: 1, delta: text },
          occurredAt: '2026-07-22T08:30:01.000Z'
        })
      }, delta)
    }

    await expect(page.getByText('这是流式输出的测试文本。')).toBeVisible()
    await expect(page.getByRole('button', { name: '停止' })).toBeVisible()
  })

  test('用户在底部时新增结构化条目自动进入视口', async ({ page }) => {
    const runtime = createReadyRuntimeSnapshot()
    const sessions = createTestSessions(1)
    const entries = createAlternatingEntries(40, '底部消息')
    await page.addInitScript({
      content: createRendererInitScript(runtime, sessions, {
        'session-1': transcript('session-1', entries)
      })
    })
    await page.goto('/#/chat/tangyuan')

    const scrollArea = page.getByTestId('message-scroll-area')
    await scrollArea.evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    await page.evaluate(() => {
      window.__dispatchAgentEvent__?.({
        type: 'transcript-delta',
        agentId: 'tangyuan',
        sessionId: 'session-1',
        delta: {
          type: 'entry-appended',
          entry: {
            kind: 'agent-reply',
            index: 40,
            messageId: 'new-bottom-entry',
            content: '新消息已到达',
            createdAt: '2026-07-22T08:31:00.000Z',
            attempt: null,
            turns: []
          }
        },
        occurredAt: '2026-07-22T08:31:00.000Z'
      })
    })

    await expect(page.getByText('新消息已到达')).toBeVisible()
  })

  test('阅读历史时新增条目不强制拉回底部', async ({ page }) => {
    const runtime = createReadyRuntimeSnapshot()
    const sessions = createTestSessions(1)
    const entries = createAlternatingEntries(60, '历史消息')
    await page.addInitScript({
      content: createRendererInitScript(runtime, sessions, {
        'session-1': transcript('session-1', entries)
      })
    })
    await page.goto('/#/chat/tangyuan')

    const scrollArea = page.getByTestId('message-scroll-area')
    await scrollArea.evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    await page.waitForTimeout(100)
    await scrollArea.evaluate((element) => {
      element.scrollTop = 0
      element.dispatchEvent(new Event('scroll'))
    })
    await page.waitForTimeout(100)
    await page.evaluate(() => {
      window.__dispatchAgentEvent__?.({
        type: 'transcript-delta',
        agentId: 'tangyuan',
        sessionId: 'session-1',
        delta: {
          type: 'entry-appended',
          entry: {
            kind: 'agent-reply',
            index: 60,
            messageId: 'history-new-entry',
            content: '不应该强制滚动',
            createdAt: '2026-07-22T08:31:00.000Z',
            attempt: null,
            turns: []
          }
        },
        occurredAt: '2026-07-22T08:31:00.000Z'
      })
    })

    await expect.poll(() => scrollArea.evaluate((element) => element.scrollTop)).toBeLessThan(80)
  })

  test('500 个结构化条目保持虚拟化和可交互', async ({ page }) => {
    const runtime = createReadyRuntimeSnapshot()
    const sessions = createTestSessions(1)
    const entries = createAlternatingEntries(500, '批量消息')
    await page.addInitScript({
      content: createRendererInitScript(runtime, sessions, {
        'session-1': transcript('session-1', entries)
      })
    })
    await page.goto('/#/chat/tangyuan')

    const scrollArea = page.getByTestId('message-scroll-area')
    await expect(scrollArea).toBeVisible()
    const rendered = await scrollArea.locator('[data-index]').count()
    expect(rendered).toBeGreaterThan(0)
    expect(rendered).toBeLessThan(100)
    await page.locator('#composer').fill('仍然可输入')
    await expect(page.locator('#composer')).toHaveValue('仍然可输入')
  })

  test('压缩提示作为非阻塞 status 出现在消息流中', async ({ page }) => {
    const runtime = createReadyRuntimeSnapshot()
    const sessions = createTestSessions(1)
    const structured = transcript('session-1', [
      userEntry(0, '压缩前'),
      { kind: 'compaction', index: 1, timestamp: FIXED_TIME },
      agentEntry(2, '压缩后继续')
    ])
    await page.addInitScript({
      content: createRendererInitScript(runtime, sessions, { 'session-1': structured })
    })
    await page.goto('/#/chat/tangyuan')

    await expect(page.getByRole('status')).toContainText('自动压缩')
    await expect(page.locator('#composer')).toBeEnabled()
  })

  test('重新打开另一会话时只展示对应结构化历史', async ({ page }) => {
    const runtime = createReadyRuntimeSnapshot()
    const sessions = createTestSessions(2)
    const first = transcript('session-1', [userEntry(0, '第一会话内容')])
    const second = transcript('session-2', [userEntry(0, '第二会话内容', 'session-2')])
    await page.addInitScript({
      content: createRendererInitScript(runtime, sessions, {
        'session-1': first,
        'session-2': second
      })
    })
    await page.goto('/#/chat/tangyuan')

    await expect(page.getByText('第一会话内容')).toBeVisible()
    await page.getByRole('button', { name: /测试会话 2/ }).click()
    await expect
      .poll(() => page.evaluate(() => window.__getTranscriptCalls__))
      .toContainEqual({ agentId: 'tangyuan', sessionId: 'session-2' })
    await expect(page.getByText('第二会话内容')).toBeVisible()
    await expect(page.getByTestId('message-scroll-area').getByText('第一会话内容')).toHaveCount(0)
  })

  test('失败尝试可以重试且保留原用户消息', async ({ page }) => {
    const runtime = createReadyRuntimeSnapshot()
    const sessions = createTestSessions(1).map((session) => ({
      ...session,
      state: 'failed' as const
    }))
    const failed = transcript('session-1', [
      userEntry(0, '请重试这个请求。'),
      agentEntry(1, '失败前已收到部分内容。', {
        inReplyTo: 'session-1-user-0',
        attempt: {
          attemptId: 'run-failed',
          runId: 'run-failed',
          status: 'failed',
          startedAt: FIXED_TIME,
          completedAt: '2026-07-22T08:30:02.000Z',
          error: { code: 'unknown', message: '网络中断', recoverable: true }
        },
        turns: [
          {
            index: 0,
            runId: 'run-failed',
            status: 'failed',
            startedAt: FIXED_TIME,
            completedAt: '2026-07-22T08:30:02.000Z',
            steps: [
              {
                index: 0,
                kind: 'thinking',
                content: '正在处理请求。',
                status: 'failed',
                startedAt: FIXED_TIME,
                completedAt: '2026-07-22T08:30:02.000Z'
              }
            ]
          }
        ]
      })
    ])
    await page.addInitScript({
      content: createRendererInitScript(runtime, sessions, { 'session-1': failed })
    })
    await page.goto('/#/chat/tangyuan')

    await page.getByRole('button', { name: '重试' }).click()
    const calls = await page.evaluate(() => window.__retryMessageCalls__)
    expect(calls).toEqual([
      { agentId: 'tangyuan', sessionId: 'session-1', userMessageId: 'session-1-user-0' }
    ])
    await expect(page.getByText('请重试这个请求。')).toBeVisible()
  })

  test('流式增长后虚拟列表总高度增加', async ({ page }) => {
    const runtime = createReadyRuntimeSnapshot()
    const sessions = createTestSessions(1).map((session) => ({
      ...session,
      state: 'running' as const
    }))
    const initial = transcript('session-1', [
      userEntry(0, '检查动态高度。'),
      agentEntry(1, '短内容', {
        attempt: {
          attemptId: 'run-height',
          runId: 'run-height',
          status: 'running',
          startedAt: FIXED_TIME,
          completedAt: null
        }
      })
    ])
    await page.addInitScript({
      content: createRendererInitScript(runtime, sessions, { 'session-1': initial })
    })
    await page.goto('/#/chat/tangyuan')

    const inner = page.getByTestId('message-scroll-area').locator(':scope > div')
    const before = await inner.evaluate((element) => element.getBoundingClientRect().height)
    await page.evaluate(() => {
      window.__dispatchAgentEvent__?.({
        type: 'transcript-delta',
        agentId: 'tangyuan',
        sessionId: 'session-1',
        delta: {
          type: 'delta-appended',
          index: 1,
          delta: '\n\n' + '增长后的长段落。'.repeat(120)
        },
        occurredAt: '2026-07-22T08:31:00.000Z'
      })
    })
    await expect
      .poll(() => inner.evaluate((element) => element.getBoundingClientRect().height))
      .toBeGreaterThan(before)
  })
})

function createAlternatingEntries(count: number, prefix: string): TranscriptEntry[] {
  return Array.from({ length: count }, (_, index) =>
    index % 2 === 0
      ? userEntry(index, `${prefix} ${index + 1}：验证虚拟列表。`)
      : agentEntry(index, `${prefix} ${index + 1}：${'结构化内容 '.repeat(8)}`)
  )
}

declare global {
  interface Window {
    __dispatchAgentEvent__?: (event: Record<string, unknown>) => void
    __retryMessageCalls__?: unknown[]
    __getTranscriptCalls__?: unknown[]
  }
}
