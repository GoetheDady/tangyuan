import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type {
  AgentReplyEntry,
  ExecutionAttempt,
  TranscriptEntry,
  TranscriptSnapshot,
  UserMessageEntry
} from '@tangyuan/contracts'
import { TranscriptMessages } from './TranscriptMessages'

const FIXED_TIME = '2026-07-21T00:00:00.000Z'

/** 创建测试用的用户消息条目。 */
function createUserMessageEntry(overrides?: Partial<UserMessageEntry>): UserMessageEntry {
  return {
    kind: 'user-message',
    index: 0,
    messageId: 'msg-user-1',
    content: '这是一条测试消息。',
    createdAt: FIXED_TIME,
    ...overrides
  }
}

/** 创建测试用的执行尝试。 */
function createAttempt(overrides?: Partial<ExecutionAttempt>): ExecutionAttempt {
  return {
    attemptId: 'attempt-1',
    runId: 'run-1',
    status: 'completed',
    startedAt: FIXED_TIME,
    completedAt: '2026-07-21T00:00:01.000Z',
    ...overrides
  }
}

/** 创建测试用的 AgentReplyEntry（含 turns）。 */
function createAgentReplyEntry(overrides?: Partial<AgentReplyEntry>): AgentReplyEntry {
  return {
    kind: 'agent-reply',
    index: 1,
    messageId: 'msg-reply-1',
    content: '回复内容',
    createdAt: FIXED_TIME,
    attempt: createAttempt(),
    turns: [],
    ...overrides
  }
}

/** 创建测试用的 TranscriptSnapshot。 */
function createTranscriptSnapshot(
  entries: TranscriptEntry[],
  overrides?: Partial<TranscriptSnapshot>
): TranscriptSnapshot {
  return {
    sessionId: 'session-1',
    agentId: 'tangyuan',
    entries,
    updatedAt: FIXED_TIME,
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
    const transcript = createTranscriptSnapshot([
      createUserMessageEntry({ index: 0, messageId: 'msg-1', content: '你好' }),
      createAgentReplyEntry({
        index: 1,
        messageId: 'msg-2',
        content: '你好！有什么可以帮助你的？'
      })
    ])

    render(<TranscriptMessages transcript={transcript} isStreaming={false} sessionId="session-1" />)

    expect(screen.getByText('你好')).toBeInTheDocument()
    expect(screen.getByText('你好！有什么可以帮助你的？')).toBeInTheDocument()
  })

  it('renders only structured dialog entries', () => {
    defineMockApi()
    const transcript = createTranscriptSnapshot([
      createUserMessageEntry({ index: 0, content: '你好' }),
      { kind: 'compaction', index: 1, timestamp: FIXED_TIME },
      createAgentReplyEntry({ index: 2, content: '回复' })
    ])

    render(<TranscriptMessages transcript={transcript} isStreaming={false} sessionId="session-1" />)

    expect(screen.getByText('你好')).toBeInTheDocument()
    expect(screen.getByText('回复')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('自动压缩')
  })

  it('renders compaction indicator for compaction entries', () => {
    defineMockApi()
    const transcript = createTranscriptSnapshot([
      createUserMessageEntry({ index: 0, content: '第一轮' }),
      createAgentReplyEntry({ index: 1, content: '回复' }),
      { kind: 'compaction', index: 2, timestamp: '2026-07-17T10:30:00.000Z' },
      createUserMessageEntry({ index: 3, messageId: 'msg-3', content: '第二轮' }),
      createAgentReplyEntry({ index: 4, messageId: 'msg-4', content: '回复2' })
    ])

    render(<TranscriptMessages transcript={transcript} isStreaming={false} sessionId="session-1" />)

    expect(screen.getByRole('status')).toHaveTextContent('自动压缩')
  })

  it('shows empty state when transcript has no entries', () => {
    defineMockApi()
    render(
      <TranscriptMessages
        transcript={createTranscriptSnapshot([])}
        isStreaming={false}
        sessionId="session-1"
      />
    )

    expect(screen.getByText('发送第一条消息开始会话。')).toBeInTheDocument()
  })

  it('shows select-session prompt when sessionId is null', () => {
    defineMockApi()
    render(<TranscriptMessages transcript={null} isStreaming={false} sessionId={null} />)

    expect(screen.getByText('选择一个会话后开始。')).toBeInTheDocument()
  })

  it('renders last agent message with isAnimating when streaming', () => {
    defineMockApi()
    const transcript = createTranscriptSnapshot([
      createUserMessageEntry({ index: 0, content: '问题' }),
      createAgentReplyEntry({ index: 1, content: '```js\nconst x = 1' })
    ])

    render(<TranscriptMessages transcript={transcript} isStreaming sessionId="session-1" />)

    expect(document.querySelector('[data-streamdown="code-block"]')).toHaveAttribute(
      'data-incomplete',
      'true'
    )
  })

  it('does not mark non-last message as animating when streaming', () => {
    defineMockApi()
    const transcript = createTranscriptSnapshot([
      createUserMessageEntry({ index: 0, content: 'Q1' }),
      createAgentReplyEntry({ index: 1, content: 'A1' }),
      createUserMessageEntry({ index: 2, messageId: 'msg-3', content: 'Q2' }),
      createAgentReplyEntry({ index: 3, messageId: 'msg-4', content: '```js\nconst y = 2' })
    ])

    render(<TranscriptMessages transcript={transcript} isStreaming sessionId="session-1" />)

    expect(screen.getByText('A1')).toBeInTheDocument()
    expect(document.querySelectorAll('[data-incomplete="true"]')).toHaveLength(1)
  })

  it('does not reparse unchanged Markdown on rerender', () => {
    defineMockApi()
    const transcript = createTranscriptSnapshot([
      createUserMessageEntry({ index: 0, content: 'Hi' }),
      createAgentReplyEntry({ index: 1, content: 'Hello world' })
    ])

    const { rerender } = render(
      <TranscriptMessages transcript={transcript} isStreaming={false} sessionId="session-1" />
    )
    rerender(
      <TranscriptMessages transcript={transcript} isStreaming={false} sessionId="session-1" />
    )

    expect(screen.getByText('Hello world')).toBeInTheDocument()
  })

  it('renders user messages on the right and agent messages on the left', () => {
    defineMockApi()
    const transcript = createTranscriptSnapshot([
      createUserMessageEntry({ index: 0, content: 'User' }),
      createAgentReplyEntry({ index: 1, content: 'Agent' })
    ])

    render(<TranscriptMessages transcript={transcript} isStreaming={false} sessionId="session-1" />)

    const articles = document.querySelectorAll('article')
    expect(articles[0]).toHaveClass('justify-end')
    expect(articles[1]).toHaveClass('justify-start')
  })

  it('renders many structured entries without crashing', () => {
    defineMockApi()
    const entries: TranscriptEntry[] = Array.from({ length: 100 }, (_, index) =>
      index % 2 === 0
        ? createUserMessageEntry({ index, messageId: `msg-${index}`, content: `Message ${index}` })
        : createAgentReplyEntry({ index, messageId: `msg-${index}`, content: `Message ${index}` })
    )
    const transcript = createTranscriptSnapshot(entries)

    render(<TranscriptMessages transcript={transcript} isStreaming={false} sessionId="session-1" />)

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

    render(<TranscriptMessages transcript={transcript} isStreaming={false} sessionId="session-1" />)

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

    render(<TranscriptMessages transcript={transcript} isStreaming={false} sessionId="session-1" />)

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

    render(<TranscriptMessages transcript={transcript} isStreaming={false} sessionId="session-1" />)

    // AssistantMessage 应渲染执行披露栏（已完成的条目默认收起）
    expect(screen.getByText('已完成执行过程')).toBeInTheDocument()
    // 步骤数量标签应显示
    expect(screen.getByText('2 步 · 01s')).toBeInTheDocument()
    // 点击展开披露栏
    const disclosure = screen.getByText('已完成执行过程').closest('button')
    expect(disclosure).not.toBeNull()
    if (disclosure) {
      fireEvent.click(disclosure)
    }
    // turns 中的步骤应在时间线中展示（标签与内容分行）
    expect(screen.getByText('分析中...')).toBeInTheDocument()
    expect(screen.getByText('read_file')).toBeInTheDocument()
    expect(screen.getByText('读取文件')).toBeInTheDocument()
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

    render(<TranscriptMessages transcript={transcript} isStreaming={false} sessionId="session-1" />)

    // 应展示失败状态（disclosure bar 和 failed footer 各有一个"执行失败"）
    const failureLabels = screen.getAllByText('执行失败')
    expect(failureLabels.length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('执行失败，请重试')).toBeInTheDocument()
    // 失败步骤应可见（失败条目默认展开，标签与内容分行）
    expect(screen.getAllByText('bad_tool').length).toBeGreaterThan(0)
    expect(screen.getByText('失败步骤')).toBeInTheDocument()
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

  it('handles session switch by clearing anchor and rendering the new transcript', () => {
    defineMockApi()
    const transcript1 = createTranscriptSnapshot(
      [createUserMessageEntry({ content: 'Session 1 message' })],
      { sessionId: 'session-1' }
    )

    const { rerender } = render(
      <TranscriptMessages transcript={transcript1} isStreaming={false} sessionId="session-1" />
    )

    expect(screen.getByText('Session 1 message')).toBeInTheDocument()

    const transcript2 = createTranscriptSnapshot(
      [createUserMessageEntry({ content: 'Session 2 message' })],
      { sessionId: 'session-2' }
    )
    rerender(
      <TranscriptMessages transcript={transcript2} isStreaming={false} sessionId="session-2" />
    )

    expect(screen.getByText('Session 2 message')).toBeInTheDocument()
    expect(screen.queryByText('Session 1 message')).not.toBeInTheDocument()
  })

  it('uses adaptive estimate sizes for different structured item types', () => {
    defineMockApi()
    const transcript = createTranscriptSnapshot([
      createUserMessageEntry({ index: 0, content: 'Hi' }),
      { kind: 'compaction', index: 1, timestamp: FIXED_TIME },
      createAgentReplyEntry({ index: 2, content: 'Hello' })
    ])

    render(<TranscriptMessages transcript={transcript} isStreaming={false} sessionId="session-1" />)

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

    render(<TranscriptMessages transcript={transcript} isStreaming={true} sessionId="session-1" />)

    // 流式模式下，最后一条 agent 消息的代码块应标记为 incomplete
    const codeBlock = document.querySelector('[data-streamdown="code-block"]')
    expect(codeBlock).toBeInTheDocument()
    expect(codeBlock?.getAttribute('data-incomplete')).toBe('true')
  })

  it('renders 200+ structured entries with virtual list and only mounts visible subset', () => {
    defineMockApi()
    const entries: TranscriptEntry[] = Array.from({ length: 250 }, (_, index) =>
      index % 2 === 0
        ? createUserMessageEntry({
            index,
            messageId: `msg-${index}`,
            content: `Message ${index}: Some longer content to fill more space`
          })
        : createAgentReplyEntry({
            index,
            messageId: `msg-${index}`,
            content: `Message ${index}: Some longer content to fill more space`
          })
    )
    const transcript = createTranscriptSnapshot(entries)

    render(<TranscriptMessages transcript={transcript} isStreaming={false} sessionId="session-1" />)

    expect(
      screen.getByText('Message 0: Some longer content to fill more space')
    ).toBeInTheDocument()
    const renderedItems = document.querySelectorAll('[data-index]')
    expect(renderedItems.length).toBeLessThan(50)
    expect(renderedItems.length).toBeGreaterThan(0)
  })

  it('shows waiting indicator when awaiting response after a user message', () => {
    defineMockApi()
    const transcript = createTranscriptSnapshot([
      createUserMessageEntry({ index: 0, content: '在吗' })
    ])

    render(
      <TranscriptMessages
        transcript={transcript}
        isStreaming={false}
        isAwaitingResponse
        sessionId="session-1"
      />
    )

    expect(screen.getByTestId('awaiting-response-indicator')).toBeInTheDocument()
  })

  it('hides waiting indicator once agent reply has visible content', () => {
    defineMockApi()
    const transcript = createTranscriptSnapshot([
      createUserMessageEntry({ index: 0, content: '在吗' }),
      createAgentReplyEntry({ index: 1, content: '在的' })
    ])

    render(
      <TranscriptMessages
        transcript={transcript}
        isStreaming
        isAwaitingResponse
        sessionId="session-1"
      />
    )

    expect(screen.queryByTestId('awaiting-response-indicator')).not.toBeInTheDocument()
  })

  it('does not show waiting indicator when not awaiting response', () => {
    defineMockApi()
    const transcript = createTranscriptSnapshot([
      createUserMessageEntry({ index: 0, content: '在吗' })
    ])

    render(
      <TranscriptMessages
        transcript={transcript}
        isStreaming={false}
        isAwaitingResponse={false}
        sessionId="session-1"
      />
    )

    expect(screen.queryByTestId('awaiting-response-indicator')).not.toBeInTheDocument()
  })

  it('hides waiting indicator once agent reply is announced with only a thinking step', () => {
    defineMockApi()
    // 惰性宣告：首个到达的是思考步骤，agent-reply 已宣告但 content 仍为空。
    const transcript = createTranscriptSnapshot([
      createUserMessageEntry({ index: 0, content: '在吗' }),
      createAgentReplyEntry({
        index: 1,
        content: '',
        attempt: createAttempt({ status: 'running', completedAt: null }),
        turns: [
          {
            index: 0,
            runId: 'run-1',
            steps: [
              {
                index: 0,
                kind: 'thinking',
                content: '分析中...',
                status: 'running',
                startedAt: FIXED_TIME,
                completedAt: null
              }
            ],
            status: 'running',
            startedAt: FIXED_TIME,
            completedAt: null
          }
        ]
      })
    ])

    render(
      <TranscriptMessages
        transcript={transcript}
        isStreaming
        isAwaitingResponse
        sessionId="session-1"
      />
    )

    expect(screen.queryByTestId('awaiting-response-indicator')).not.toBeInTheDocument()
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

/**
 * 确定性大数据夹具：长 thinking、长 Markdown、代码块、大量工具步骤。
 */
function createBigDataEntries(): TranscriptEntry[] {
  const longThinking =
    '分析用户需求：需要实现一个完整的 REST API 服务，包含用户认证、数据验证、错误处理、' +
    '日志记录、性能监控等模块。' +
    '考虑到现有系统架构基于微服务，新功能需要与已有服务通过 gRPC 通信。' +
    '数据库方面需要同时支持 PostgreSQL 和 Redis 缓存层。' +
    '安全方面需要实现 JWT 令牌刷新、CSRF 防护、速率限制。' +
    '部署方面需要考虑 Docker 容器化和 Kubernetes 编排。'

  const longMarkdown = [
    '# API 设计方案',
    '',
    '## 认证流程',
    '',
    '```ts',
    'interface AuthConfig {',
    '  jwtSecret: string',
    '  expiresIn: number',
    '  refreshWindow: number',
    '  rateLimit: {',
    '    windowMs: number',
    '    max: number',
    '  }',
    '}',
    '',
    'async function authenticate(token: string): Promise<User> {',
    '  const payload = verifyToken(token)',
    '  if (payload.exp < Date.now()) {',
    '    throw new AuthError("Token expired")',
    '  }',
    '  return findUser(payload.sub)',
    '}',
    '```',
    '',
    '## 数据模型',
    '',
    '| 字段 | 类型 | 说明 |',
    '| --- | --- | --- |',
    '| `id` | `uuid` | 主键 |',
    '| `email` | `string` | 用户邮箱 |',
    '| `roles` | `string[]` | 角色列表 |',
    '| `createdAt` | `timestamp` | 创建时间 |',
    '',
    '- [x] 用户认证',
    '- [x] 数据验证',
    '- [ ] 错误处理中间件',
    '- [ ] 日志系统',
    '- [ ] 性能监控',
    '',
    '> **注意：** 生产环境需要配置 HTTPS 和 CORS 白名单。'
  ].join('\n')

  const manyToolSteps = Array.from({ length: 12 }, (_, i) => ({
    index: i,
    kind: (['thinking', 'tool-call', 'text'] as const)[i % 3],
    content:
      i % 3 === 0
        ? `思考步骤 ${i + 1}：分析当前阶段的任务目标和依赖关系`
        : i % 3 === 1
          ? `执行操作 ${i + 1}：调用工具完成子任务`
          : `输出结果 ${i + 1}：生成中间文本`,
    toolCallId: i % 3 === 1 ? `tc-${i}` : undefined,
    toolName: i % 3 === 1 ? `tool_${i}` : undefined,
    status: (i < 10 ? 'completed' : 'running') as 'completed' | 'running',
    startedAt: `2026-07-21T00:0${Math.min(i, 9)}:00.000Z`,
    completedAt: i < 10 ? `2026-07-21T00:0${Math.min(i, 9)}:05.000Z` : null
  }))

  const entries: TranscriptEntry[] = [
    {
      kind: 'user-message',
      index: 0,
      messageId: 'big-user-1',
      content: '请帮我设计一个完整的 REST API 服务',
      createdAt: '2026-07-21T00:00:00.000Z'
    },
    {
      kind: 'agent-reply',
      index: 1,
      messageId: 'big-reply-1',
      content: longMarkdown,
      createdAt: '2026-07-21T00:00:00.000Z',
      attempt: {
        attemptId: 'big-attempt-1',
        runId: 'big-run-1',
        status: 'completed',
        startedAt: '2026-07-21T00:00:00.000Z',
        completedAt: '2026-07-21T00:03:00.000Z'
      },
      turns: [
        {
          index: 0,
          runId: 'big-run-1',
          steps: manyToolSteps,
          status: 'completed' as const,
          startedAt: '2026-07-21T00:00:00.000Z',
          completedAt: '2026-07-21T00:03:00.000Z'
        }
      ]
    },
    {
      kind: 'compaction',
      index: 2,
      timestamp: '2026-07-21T01:00:00.000Z'
    },
    {
      kind: 'user-message',
      index: 3,
      messageId: 'big-user-2',
      content: '现在加上 WebSocket 支持',
      createdAt: '2026-07-21T01:00:01.000Z'
    },
    {
      kind: 'agent-reply',
      index: 4,
      messageId: 'big-reply-2',
      content: longThinking,
      createdAt: '2026-07-21T01:00:01.000Z',
      attempt: {
        attemptId: 'big-attempt-2',
        runId: 'big-run-2',
        status: 'completed',
        startedAt: '2026-07-21T01:00:01.000Z',
        completedAt: '2026-07-21T01:01:00.000Z'
      },
      turns: [
        {
          index: 0,
          runId: 'big-run-2',
          steps: [
            {
              index: 0,
              kind: 'thinking' as const,
              content: longThinking,
              status: 'completed' as const,
              startedAt: '2026-07-21T01:00:01.000Z',
              completedAt: '2026-07-21T01:01:00.000Z'
            }
          ],
          status: 'completed' as const,
          startedAt: '2026-07-21T01:00:01.000Z',
          completedAt: '2026-07-21T01:01:00.000Z'
        }
      ]
    }
  ]

  return entries
}

/**
 * 确定性大数据夹具：多次执行尝试（含重试、失败、成功）。
 */
function createMultipleAttemptEntries(): TranscriptEntry[] {
  const entries: TranscriptEntry[] = []

  // 用户消息
  entries.push({
    kind: 'user-message',
    index: 0,
    messageId: 'multi-user-1',
    content: '部署到生产环境',
    createdAt: '2026-07-21T00:00:00.000Z'
  })

  // 第一次尝试：失败
  entries.push({
    kind: 'agent-reply',
    index: 1,
    messageId: 'multi-reply-1',
    content: '',
    createdAt: '2026-07-21T00:00:00.000Z',
    attempt: {
      attemptId: 'multi-attempt-1',
      runId: 'multi-run-1',
      status: 'failed',
      startedAt: '2026-07-21T00:00:00.000Z',
      completedAt: '2026-07-21T00:00:30.000Z',
      error: {
        code: 'unknown',
        message: '部署脚本执行失败：权限不足',
        recoverable: true
      }
    },
    turns: [
      {
        index: 0,
        runId: 'multi-run-1',
        steps: [
          {
            index: 0,
            kind: 'tool-call' as const,
            content: '执行部署命令',
            toolName: 'deploy',
            toolCallId: 'tc-deploy-1',
            status: 'failed' as const,
            startedAt: '2026-07-21T00:00:00.000Z',
            completedAt: '2026-07-21T00:00:30.000Z'
          }
        ],
        status: 'failed' as const,
        startedAt: '2026-07-21T00:00:00.000Z',
        completedAt: '2026-07-21T00:00:30.000Z'
      }
    ]
  })

  // 重试：成功
  entries.push({
    kind: 'agent-reply',
    index: 2,
    messageId: 'multi-reply-2',
    content: '部署成功！应用已上线。',
    createdAt: '2026-07-21T00:01:00.000Z',
    attempt: {
      attemptId: 'multi-attempt-2',
      runId: 'multi-run-2',
      status: 'completed',
      startedAt: '2026-07-21T00:01:00.000Z',
      completedAt: '2026-07-21T00:02:00.000Z'
    },
    turns: [
      {
        index: 0,
        runId: 'multi-run-2',
        steps: [
          {
            index: 0,
            kind: 'tool-call' as const,
            content: '执行部署命令（已提权）',
            toolName: 'deploy',
            toolCallId: 'tc-deploy-2',
            status: 'completed' as const,
            startedAt: '2026-07-21T00:01:00.000Z',
            completedAt: '2026-07-21T00:02:00.000Z'
          }
        ],
        status: 'completed' as const,
        startedAt: '2026-07-21T00:01:00.000Z',
        completedAt: '2026-07-21T00:02:00.000Z'
      }
    ]
  })

  return entries
}

/**
 * 确定性大数据夹具：多个压缩提示分散在对话中。
 */
function createMultiCompactionEntries(): TranscriptEntry[] {
  const entries: TranscriptEntry[] = []

  for (let i = 0; i < 8; i++) {
    entries.push({
      kind: 'user-message',
      index: entries.length,
      messageId: `comp-user-${i}`,
      content: `第 ${i + 1} 轮提问`,
      createdAt: new Date(Date.now() + i * 60000).toISOString()
    })
    entries.push({
      kind: 'agent-reply',
      index: entries.length,
      messageId: `comp-reply-${i}`,
      content: `第 ${i + 1} 轮回复：处理完成。`,
      createdAt: new Date(Date.now() + i * 60000 + 10000).toISOString(),
      attempt: {
        attemptId: `comp-attempt-${i}`,
        runId: `comp-run-${i}`,
        status: 'completed' as const,
        startedAt: new Date(Date.now() + i * 60000).toISOString(),
        completedAt: new Date(Date.now() + i * 60000 + 10000).toISOString()
      },
      turns: []
    })
    if (i % 3 === 2) {
      entries.push({
        kind: 'compaction',
        index: entries.length,
        timestamp: new Date(Date.now() + i * 60000 + 15000).toISOString()
      })
    }
  }

  return entries
}

describe('TranscriptMessages 确定性大数据夹具', () => {
  it('渲染长 thinking + 长 Markdown + 代码块 + 12 个工具步骤', () => {
    defineMockApi()
    const entries = createBigDataEntries()
    const transcript = createTranscriptSnapshot(entries)

    render(<TranscriptMessages transcript={transcript} isStreaming={false} sessionId="session-1" />)

    // 用户消息应可见
    expect(screen.getByText('请帮我设计一个完整的 REST API 服务')).toBeInTheDocument()
    expect(screen.getByText('现在加上 WebSocket 支持')).toBeInTheDocument()

    // Markdown 渲染应包含代码块（Shiki 高亮后可能包裹在 pre 中）
    const codeBlocks = document.querySelectorAll('[data-streamdown="code-block"]')
    expect(codeBlocks.length).toBeGreaterThan(0)

    // Compaction 指示器应出现
    expect(screen.getByRole('status')).toBeInTheDocument()

    // 第一个 agent-reply 应有执行披露栏
    expect(screen.getAllByText('已完成执行过程').length).toBeGreaterThan(0)

    // 展开第一个 reply 查看工具步骤
    const disclosures = screen.getAllByText('已完成执行过程')
    const firstDisclosure = disclosures[0]?.closest('button')
    expect(firstDisclosure).not.toBeNull()
    if (firstDisclosure) {
      fireEvent.click(firstDisclosure)
    }

    // 12 个步骤中有部分应可见（标签与内容分行）
    expect(screen.getAllByText('tool_1').length).toBeGreaterThan(0)
    expect(screen.getByText('执行操作 2：调用工具完成子任务')).toBeInTheDocument()
  })

  it('渲染多次执行尝试：失败 + 重试成功', () => {
    defineMockApi()
    const entries = createMultipleAttemptEntries()
    const transcript = createTranscriptSnapshot(entries)

    render(<TranscriptMessages transcript={transcript} isStreaming={false} sessionId="session-1" />)

    // 失败的尝试应展示
    const failureLabels = screen.getAllByText('执行失败')
    expect(failureLabels.length).toBeGreaterThanOrEqual(1)

    // 成功的重试应答
    expect(screen.getByText('部署成功！应用已上线。')).toBeInTheDocument()

    // 两个 agent-reply 条目应都渲染
    const articles = document.querySelectorAll('article')
    // 1 user message + 2 agent replies = 3 articles
    expect(articles.length).toBeGreaterThanOrEqual(3)
  })

  it('渲染 8 轮对话 + 2 个压缩提示', () => {
    defineMockApi()
    const entries = createMultiCompactionEntries()
    const transcript = createTranscriptSnapshot(entries)

    render(<TranscriptMessages transcript={transcript} isStreaming={false} sessionId="session-1" />)

    // 前面几轮应可见（虚拟列表只渲染视口内项目）
    expect(screen.getByText('第 1 轮提问')).toBeInTheDocument()
    expect(screen.getByText('第 2 轮提问')).toBeInTheDocument()

    // 压缩提示在可见范围内应有至少 1 个
    const compactionIndicators = screen.getAllByRole('status')
    // 虚拟列表视口内可见的 compaction 至少 1 个
    expect(compactionIndicators.length).toBeGreaterThanOrEqual(1)

    // 虚拟列表只渲染可见子集，不应渲染全部 18+ 条目
    const renderedItems = document.querySelectorAll('[data-index]')
    expect(renderedItems.length).toBeLessThan(18)
    expect(renderedItems.length).toBeGreaterThan(0)
  })

  it('虚拟列表在大数据场景下不渲染全部条目', () => {
    defineMockApi()
    const entries = createBigDataEntries()
    const transcript = createTranscriptSnapshot(entries)

    render(<TranscriptMessages transcript={transcript} isStreaming={false} sessionId="session-1" />)

    const renderedItems = document.querySelectorAll('[data-index]')
    // 大数据条目共 5 条，clientHeight=600，全部在视口内 → 5 条全部渲染
    // + overscan 5*2=10 → 但条目总共才 5
    expect(renderedItems.length).toBeLessThanOrEqual(15)
    expect(renderedItems.length).toBeGreaterThan(0)
  })
})
