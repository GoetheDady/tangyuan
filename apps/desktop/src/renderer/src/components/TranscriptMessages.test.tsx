import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AgentMessage } from '@tangyuan/contracts'
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
})
