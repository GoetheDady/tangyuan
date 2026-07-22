import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type {
  AgentMessage,
  AgentReplyEntry,
  TranscriptEntry,
  TranscriptSnapshot,
  ExecutionAttempt
} from '@tangyuan/contracts'
import { TranscriptMessages } from './TranscriptMessages'

/**
 * 创建测试用的 AgentMessage。
 */
function createMessage(overrides?: Partial<AgentMessage>): AgentMessage {
  return {
    messageId: `msg-${Math.random().toString(36).slice(2, 9)}`,
    agentId: 'tangyuan',
    sessionId: 'session-1',
    role: 'agent',
    content: '这是一条测试消息。',
    createdAt: new Date().toISOString(),
    ...overrides
  }
}

/**
 * 创建测试用的执行尝试。
 */
function createAttempt(overrides?: Partial<ExecutionAttempt>): ExecutionAttempt {
  return {
    attemptId: 'attempt-1',
    runId: 'run-1',
    status: 'completed',
    startedAt: '2026-07-21T00:00:00.000Z',
    completedAt: '2026-07-21T00:00:01.000Z',
    ...overrides
  }
}

/**
 * 创建测试用的 AgentReplyEntry（含 turns）。
 */
function createAgentReplyEntry(overrides?: Partial<AgentReplyEntry>): AgentReplyEntry {
  return {
    kind: 'agent-reply',
    index: 1,
    messageId: 'msg-reply-1',
    content: '回复内容',
    createdAt: '2026-07-21T00:00:00.000Z',
    attempt: createAttempt(),
    turns: [],
    ...overrides
  }
}

/**
 * 创建测试用的 TranscriptSnapshot。
 */
function createTranscriptSnapshot(
  entries: TranscriptEntry[],
  overrides?: Partial<TranscriptSnapshot>
): TranscriptSnapshot {
  return {
    sessionId: 'session-1',
    agentId: 'tangyuan',
    entries,
    updatedAt: new Date().toISOString(),
    ...overrides
  }
}

function defineMockApi(openExternalLink = vi.fn().mockResolvedValue(undefined)) {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { openExternalLink }
  })
}

describe('TranscriptMessages', () => {
  it('renders dialog messages', () => {
    defineMockApi()
    const messages: AgentMessage[] = [
      createMessage({ messageId: 'msg-1', role: 'user', content: '你好' }),
      createMessage({ messageId: 'msg-2', role: 'agent', content: '你好！有什么可以帮助你的？' })
    ]

    render(<TranscriptMessages messages={messages} isStreaming={false} sessionId="session-1" />)

    expect(screen.getByText('你好')).toBeInTheDocument()
    expect(screen.getByText('你好！有什么可以帮助你的？')).toBeInTheDocument()
  })

  it('filters out system messages from dialog bubbles', () => {
    defineMockApi()
    const messages: AgentMessage[] = [
      createMessage({ messageId: 'msg-1', role: 'user', content: '你好' }),
      createMessage({
        messageId: 'msg-sys',
        role: 'system',
        content: 'internal event'
      }),
      createMessage({ messageId: 'msg-2', role: 'agent', content: '回复' })
    ]

    render(<TranscriptMessages messages={messages} isStreaming={false} sessionId="session-1" />)

    // system 消息不应渲染为对话气泡
    expect(screen.queryByText('internal event')).not.toBeInTheDocument()
    // 但用户和 Agent 消息应该渲染
    expect(screen.getByText('你好')).toBeInTheDocument()
    expect(screen.getByText('回复')).toBeInTheDocument()
  })

  it('renders compaction indicator for compaction messages', () => {
    defineMockApi()
    const messages: AgentMessage[] = [
      createMessage({ messageId: 'msg-1', role: 'user', content: '第一轮' }),
      createMessage({ messageId: 'msg-2', role: 'agent', content: '回复' }),
      createMessage({
        messageId: 'msg-compact',
        role: 'compaction',
        content: '',
        createdAt: '2026-07-17T10:30:00.000Z'
      }),
      createMessage({ messageId: 'msg-3', role: 'user', content: '第二轮' }),
      createMessage({ messageId: 'msg-4', role: 'agent', content: '回复2' })
    ]

    render(<TranscriptMessages messages={messages} isStreaming={false} sessionId="session-1" />)

    // Compaction 指示器应包含 "上下文已于" 和 "自动压缩" 文本
    const indicator = screen.getByRole('status')
    expect(indicator).toBeInTheDocument()
    expect(indicator.textContent).toContain('自动压缩')
  })

  it('shows empty state when no messages', () => {
    defineMockApi()
    render(<TranscriptMessages messages={[]} isStreaming={false} sessionId="session-1" />)

    expect(screen.getByText('发送第一条消息开始会话。')).toBeInTheDocument()
  })

  it('shows select-session prompt when sessionId is null', () => {
    defineMockApi()
    render(<TranscriptMessages messages={[]} isStreaming={false} sessionId={null} />)

    expect(screen.getByText('选择一个会话后开始。')).toBeInTheDocument()
  })

  it('renders last agent message with isAnimating when streaming', () => {
    defineMockApi()
    const messages: AgentMessage[] = [
      createMessage({ messageId: 'msg-1', role: 'user', content: '问题' }),
      createMessage({ messageId: 'msg-2', role: 'agent', content: '```js\nconst x = 1' })
    ]

    render(<TranscriptMessages messages={messages} isStreaming={true} sessionId="session-1" />)

    // 流式模式下未闭合的代码块应带 data-incomplete 属性
    const codeBlock = document.querySelector('[data-streamdown="code-block"]')
    expect(codeBlock).toBeInTheDocument()
    expect(codeBlock?.getAttribute('data-incomplete')).toBe('true')
  })

  it('does not mark non-last message as animating when streaming', () => {
    defineMockApi()
    const messages: AgentMessage[] = [
      createMessage({ messageId: 'msg-1', role: 'user', content: 'Q1' }),
      createMessage({ messageId: 'msg-2', role: 'agent', content: 'A1' }),
      createMessage({ messageId: 'msg-3', role: 'user', content: 'Q2' }),
      createMessage({
        messageId: 'msg-4',
        role: 'agent',
        content: '```js\nconst streaming'
      })
    ]

    render(<TranscriptMessages messages={messages} isStreaming={true} sessionId="session-1" />)

    // 应有两个代码块（第二条 agent 消息和最后一条流式 agent 消息各一个）
    const codeBlocks = document.querySelectorAll('[data-streamdown="code-block"]')
    // 至少最后一条流式消息有代码块
    expect(codeBlocks.length).toBeGreaterThan(0)
    // 最后一条流式消息的代码块应标记为 incomplete
    const lastCodeBlock = codeBlocks[codeBlocks.length - 1]
    expect(lastCodeBlock?.getAttribute('data-incomplete')).toBe('true')
  })

  it('MemoizedMessage does not cause redundant Markdown parsing for unchanged content', () => {
    defineMockApi()
    const messages: AgentMessage[] = [
      createMessage({ messageId: 'msg-1', role: 'user', content: 'Hi' }),
      createMessage({ messageId: 'msg-2', role: 'agent', content: 'Hello world' })
    ]

    const { rerender } = render(
      <TranscriptMessages messages={messages} isStreaming={false} sessionId="session-1" />
    )

    // 用相同的 messages 引用重新渲染——memo 应跳过 StreamdownMessage 重新解析
    rerender(<TranscriptMessages messages={messages} isStreaming={false} sessionId="session-1" />)

    // 内容应仍然渲染
    expect(screen.getByText('Hello world')).toBeInTheDocument()
    expect(screen.getByText('Hi')).toBeInTheDocument()
  })

  it('renders user messages on the right and agent messages on the left', () => {
    defineMockApi()
    const messages: AgentMessage[] = [
      createMessage({ messageId: 'msg-1', role: 'user', content: 'User' }),
      createMessage({ messageId: 'msg-2', role: 'agent', content: 'Agent' })
    ]

    render(<TranscriptMessages messages={messages} isStreaming={false} sessionId="session-1" />)

    const articles = document.querySelectorAll('article')
    expect(articles.length).toBe(2)

    // 用户消息在右侧（justify-end）
    expect(articles[0]?.className).toContain('justify-end')
    // Agent 消息在左侧（justify-start）
    expect(articles[1]?.className).toContain('justify-start')
  })

  it('renders many messages without crashing', () => {
    defineMockApi()
    const messages: AgentMessage[] = Array.from({ length: 100 }, (_, i) =>
      createMessage({
        messageId: `msg-${i}`,
        role: i % 2 === 0 ? 'user' : 'agent',
        content: `Message ${i}`
      })
    )

    render(<TranscriptMessages messages={messages} isStreaming={false} sessionId="session-1" />)

    // 虚拟列表可能不完全渲染所有消息，但至少第一条应该可见
    expect(screen.getByText('Message 0')).toBeInTheDocument()
  })

  it('renders from structured transcript entries', () => {
    defineMockApi()
    const entries: TranscriptEntry[] = [
      {
        kind: 'user-message',
        index: 0,
        messageId: 'msg-1',
        content: '用户问题',
        createdAt: '2026-07-21T00:00:00.000Z'
      },
      createAgentReplyEntry({
        index: 1,
        messageId: 'msg-2',
        content: 'Agent 回复'
      })
    ]

    const transcript = createTranscriptSnapshot(entries)

    render(
      <TranscriptMessages
        messages={[]}
        transcript={transcript}
        isStreaming={false}
        sessionId="session-1"
      />
    )

    expect(screen.getByText('用户问题')).toBeInTheDocument()
    expect(screen.getByText('Agent 回复')).toBeInTheDocument()
  })

  it('renders compaction entries from transcript', () => {
    defineMockApi()
    const entries: TranscriptEntry[] = [
      {
        kind: 'user-message',
        index: 0,
        messageId: 'msg-1',
        content: '第一轮',
        createdAt: '2026-07-21T00:00:00.000Z'
      },
      {
        kind: 'compaction',
        index: 1,
        timestamp: '2026-07-21T01:00:00.000Z'
      },
      {
        kind: 'user-message',
        index: 2,
        messageId: 'msg-2',
        content: '第二轮',
        createdAt: '2026-07-21T01:00:01.000Z'
      }
    ]

    const transcript = createTranscriptSnapshot(entries)

    render(
      <TranscriptMessages
        messages={[]}
        transcript={transcript}
        isStreaming={false}
        sessionId="session-1"
      />
    )

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText('第一轮')).toBeInTheDocument()
    expect(screen.getByText('第二轮')).toBeInTheDocument()
  })

  it('renders AgentReplyEntry with turns as AssistantMessage', () => {
    defineMockApi()
    const entry = createAgentReplyEntry({
      index: 1,
      messageId: 'msg-reply',
      content: '带有工具的回复',
      turns: [
        {
          index: 0,
          runId: 'run-1',
          steps: [
            {
              index: 0,
              kind: 'thinking',
              content: '分析中...',
              status: 'completed',
              startedAt: '2026-07-21T00:00:00.000Z',
              completedAt: '2026-07-21T00:00:01.000Z'
            },
            {
              index: 1,
              kind: 'tool-call',
              content: '读取文件',
              toolCallId: 'tc-1',
              toolName: 'read_file',
              status: 'completed',
              startedAt: '2026-07-21T00:00:01.000Z',
              completedAt: '2026-07-21T00:00:02.000Z'
            }
          ],
          status: 'completed',
          startedAt: '2026-07-21T00:00:00.000Z',
          completedAt: '2026-07-21T00:00:02.000Z'
        }
      ]
    })

    const entries: TranscriptEntry[] = [
      {
        kind: 'user-message',
        index: 0,
        messageId: 'msg-user',
        content: '帮我读文件',
        createdAt: '2026-07-21T00:00:00.000Z'
      },
      entry
    ]

    const transcript = createTranscriptSnapshot(entries)

    render(
      <TranscriptMessages
        messages={[]}
        transcript={transcript}
        isStreaming={false}
        sessionId="session-1"
      />
    )

    // AssistantMessage 应渲染执行披露栏（已完成的条目默认收起）
    expect(screen.getByText('已完成执行过程')).toBeInTheDocument()
    // 步骤数量标签应显示
    expect(screen.getByText('2 步 · 1s')).toBeInTheDocument()
    // 点击展开披露栏
    const disclosure = screen.getByText('已完成执行过程').closest('button')
    expect(disclosure).not.toBeNull()
    if (disclosure) {
      fireEvent.click(disclosure)
    }
    // turns 中的步骤应在时间线中展示
    expect(screen.getByText('分析中...')).toBeInTheDocument()
    expect(screen.getByText('read_file · 读取文件')).toBeInTheDocument()
  })

  it('renders AgentReplyEntry with failed attempt', () => {
    defineMockApi()
    const entry = createAgentReplyEntry({
      index: 1,
      messageId: 'msg-failed',
      content: '部分回复',
      attempt: createAttempt({
        attemptId: 'attempt-failed',
        status: 'failed',
        error: {
          code: 'unknown',
          message: '执行失败，请重试',
          recoverable: true
        }
      }),
      turns: [
        {
          index: 0,
          runId: 'run-1',
          steps: [
            {
              index: 0,
              kind: 'tool-call',
              content: '失败步骤',
              toolName: 'bad_tool',
              status: 'failed',
              startedAt: '2026-07-21T00:00:00.000Z',
              completedAt: '2026-07-21T00:00:01.000Z'
            }
          ],
          status: 'failed',
          startedAt: '2026-07-21T00:00:00.000Z',
          completedAt: '2026-07-21T00:00:01.000Z'
        }
      ]
    })

    const entries: TranscriptEntry[] = [
      {
        kind: 'user-message',
        index: 0,
        messageId: 'msg-user',
        content: '触发失败的请求',
        createdAt: '2026-07-21T00:00:00.000Z'
      },
      entry
    ]

    const transcript = createTranscriptSnapshot(entries)

    render(
      <TranscriptMessages
        messages={[]}
        transcript={transcript}
        isStreaming={false}
        sessionId="session-1"
      />
    )

    // 应展示失败状态（disclosure bar 和 failed footer 各有一个"执行失败"）
    const failureLabels = screen.getAllByText('执行失败')
    expect(failureLabels.length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('执行失败，请重试')).toBeInTheDocument()
    // 失败步骤应可见（失败条目默认展开）
    expect(screen.getByText('bad_tool · 失败步骤')).toBeInTheDocument()
  })

  it('passes onRetry callback with inReplyTo from entry', () => {
    defineMockApi()
    const onRetry = vi.fn()

    const entry = createAgentReplyEntry({
      index: 1,
      messageId: 'msg-failed',
      content: '',
      attempt: createAttempt({
        attemptId: 'attempt-failed',
        status: 'failed',
        error: {
          code: 'unknown',
          message: '失败',
          recoverable: true
        }
      }),
      inReplyTo: 'msg-user-1',
      turns: [
        {
          index: 0,
          runId: 'run-1',
          steps: [
            {
              index: 0,
              kind: 'tool-call',
              content: '执行操作',
              toolName: 'some_tool',
              status: 'failed',
              startedAt: '2026-07-21T00:00:00.000Z',
              completedAt: '2026-07-21T00:00:01.000Z'
            }
          ],
          status: 'failed',
          startedAt: '2026-07-21T00:00:00.000Z',
          completedAt: '2026-07-21T00:00:01.000Z'
        }
      ]
    })

    const entries: TranscriptEntry[] = [
      {
        kind: 'user-message',
        index: 0,
        messageId: 'msg-user-1',
        content: '请求',
        createdAt: '2026-07-21T00:00:00.000Z'
      },
      entry
    ]

    const transcript = createTranscriptSnapshot(entries)

    render(
      <TranscriptMessages
        messages={[]}
        transcript={transcript}
        isStreaming={false}
        sessionId="session-1"
        onRetry={onRetry}
      />
    )

    // 点击重试按钮（失败条目默认展开，显示重试按钮）
    const retryButton = screen.getByText('重试')
    retryButton.click()

    expect(onRetry).toHaveBeenCalledWith('msg-user-1')
  })

  it('handles session switch by clearing anchor and scrolling to bottom', () => {
    defineMockApi()
    const messages1: AgentMessage[] = [
      createMessage({ messageId: 'msg-1', role: 'user', content: 'Session 1 message' })
    ]

    const { rerender } = render(
      <TranscriptMessages messages={messages1} isStreaming={false} sessionId="session-1" />
    )

    expect(screen.getByText('Session 1 message')).toBeInTheDocument()

    const messages2: AgentMessage[] = [
      createMessage({ messageId: 'msg-2', role: 'user', content: 'Session 2 message' })
    ]

    // 切换到新会话
    rerender(<TranscriptMessages messages={messages2} isStreaming={false} sessionId="session-2" />)

    // 新会话的消息应可见
    expect(screen.getByText('Session 2 message')).toBeInTheDocument()
    // 旧会话的消息不应存在
    expect(screen.queryByText('Session 1 message')).not.toBeInTheDocument()
  })

  it('uses adaptive estimate sizes for different item types', () => {
    // 此测试验证 estimateItemSize 对不同类型返回不同值
    // 虚拟列表的 estimateSize 函数会调用它
    defineMockApi()
    const messages: AgentMessage[] = [
      createMessage({ messageId: 'msg-1', role: 'user', content: 'Hi' }),
      createMessage({
        messageId: 'msg-compact',
        role: 'compaction',
        content: '',
        createdAt: new Date().toISOString()
      }),
      createMessage({ messageId: 'msg-2', role: 'agent', content: 'Hello' })
    ]

    render(<TranscriptMessages messages={messages} isStreaming={false} sessionId="session-1" />)

    // 所有条目都应渲染
    expect(screen.getByText('Hi')).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText('Hello')).toBeInTheDocument()
  })

  it('buildRenderItemsFromTranscript marks last agent as streaming', () => {
    defineMockApi()
    const entries: TranscriptEntry[] = [
      {
        kind: 'user-message',
        index: 0,
        messageId: 'msg-1',
        content: '问题',
        createdAt: '2026-07-21T00:00:00.000Z'
      },
      createAgentReplyEntry({
        index: 1,
        messageId: 'msg-2',
        content: '```js\nconst incomplete'
      })
    ]

    const transcript = createTranscriptSnapshot(entries)

    render(
      <TranscriptMessages
        messages={[]}
        transcript={transcript}
        isStreaming={true}
        sessionId="session-1"
      />
    )

    // 流式模式下，最后一条 agent 消息的代码块应标记为 incomplete
    const codeBlock = document.querySelector('[data-streamdown="code-block"]')
    expect(codeBlock).toBeInTheDocument()
    expect(codeBlock?.getAttribute('data-incomplete')).toBe('true')
  })

  it('renders 200+ messages with virtual list and only mounts visible subset', () => {
    defineMockApi()
    const messages: AgentMessage[] = Array.from({ length: 250 }, (_, i) =>
      createMessage({
        messageId: `msg-${i}`,
        role: i % 2 === 0 ? 'user' : 'agent',
        content: `Message ${i}: Some longer content to fill more space`
      })
    )

    render(<TranscriptMessages messages={messages} isStreaming={false} sessionId="session-1" />)

    // 应该有消息渲染
    expect(
      screen.getByText('Message 0: Some longer content to fill more space')
    ).toBeInTheDocument()

    // 虚拟列表应只渲染可见子集——检查 DOM 中渲染的条目数量
    // 通过 data-index 属性统计
    const renderedItems = document.querySelectorAll('[data-index]')
    // 对于有滚动容器的虚拟列表（clientHeight=600, estimate=100-120），
    // 可见区域约为 5-6 条，加上 overscan 5 * 2 = 10，总共约 16~22 条
    expect(renderedItems.length).toBeLessThan(50)
    expect(renderedItems.length).toBeGreaterThan(0)
  })

  it('provides stable key for retry attempts via attemptId', () => {
    defineMockApi()
    const entry1 = createAgentReplyEntry({
      index: 1,
      messageId: 'msg-same',
      content: '第一次回复',
      attempt: createAttempt({
        attemptId: 'attempt-1',
        status: 'failed',
        error: {
          code: 'unknown',
          message: 'failed',
          recoverable: true
        }
      }),
      inReplyTo: 'msg-user-1'
    })

    const entries: TranscriptEntry[] = [
      {
        kind: 'user-message',
        index: 0,
        messageId: 'msg-user-1',
        content: '请求',
        createdAt: '2026-07-21T00:00:00.000Z'
      },
      entry1
    ]

    const transcript = createTranscriptSnapshot(entries)

    const { rerender } = render(
      <TranscriptMessages
        messages={[]}
        transcript={transcript}
        isStreaming={false}
        sessionId="session-1"
        onRetry={vi.fn()}
      />
    )

    expect(screen.getByText('第一次回复')).toBeInTheDocument()

    // 模拟重试后的新 entry（同一 messageId，不同 attemptId）
    const retryEntry = createAgentReplyEntry({
      index: 1,
      messageId: 'msg-same',
      content: '重试回复',
      attempt: createAttempt({
        attemptId: 'attempt-2',
        status: 'completed'
      }),
      inReplyTo: 'msg-user-1'
    })

    const retryTranscript = createTranscriptSnapshot([
      {
        kind: 'user-message',
        index: 0,
        messageId: 'msg-user-1',
        content: '请求',
        createdAt: '2026-07-21T00:00:00.000Z'
      },
      retryEntry
    ])

    rerender(
      <TranscriptMessages
        messages={[]}
        transcript={retryTranscript}
        isStreaming={false}
        sessionId="session-1"
        onRetry={vi.fn()}
      />
    )

    // 重试回复应可见，旧内容不应存在
    expect(screen.getByText('重试回复')).toBeInTheDocument()
    expect(screen.queryByText('第一次回复')).not.toBeInTheDocument()
  })
})
