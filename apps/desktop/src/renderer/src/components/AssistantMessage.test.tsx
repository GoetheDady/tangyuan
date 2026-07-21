import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentReplyEntry, RunTurn, TurnStep } from '@tangyuan/contracts'
import { AssistantMessage } from './AssistantMessage'

function createMockApi() {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { openExternalLink: vi.fn().mockResolvedValue(undefined) },
  })
}

function createEntry(overrides?: Partial<AgentReplyEntry>): AgentReplyEntry {
  return {
    kind: 'agent-reply',
    index: 1,
    messageId: 'msg-1',
    content: '分析完成。',
    createdAt: '2026-07-21T00:00:00.000Z',
    attempt: {
      attemptId: 'run-1',
      runId: 'run-1',
      status: 'running',
      startedAt: '2026-07-21T00:00:00.000Z',
      completedAt: null,
    },
    turns: [],
    ...overrides,
  }
}

function createThinkingStep(overrides?: Partial<TurnStep>): TurnStep {
  return {
    index: 0,
    kind: 'thinking',
    content: 'Let me think...',
    status: 'running',
    startedAt: '2026-07-21T00:00:01.000Z',
    completedAt: null,
    ...overrides,
  }
}

function createToolStep(overrides?: Partial<TurnStep>): TurnStep {
  return {
    index: 0,
    kind: 'tool-call',
    content: '正在搜索',
    status: 'running',
    startedAt: '2026-07-21T00:00:02.000Z',
    completedAt: null,
    ...overrides,
  }
}

function createTurn(overrides?: Partial<RunTurn>): RunTurn {
  return {
    index: 0,
    runId: 'run-1',
    steps: [],
    status: 'running',
    startedAt: '2026-07-21T00:00:00.000Z',
    completedAt: null,
    ...overrides,
  }
}

describe('AssistantMessage', () => {
  beforeEach(() => {
    createMockApi()
  })

  it('renders expanded disclosure with loader when in active tool loop state', () => {
    const entry = createEntry({
      attempt: { attemptId: 'run-1', runId: 'run-1', status: 'running', startedAt: '2026-07-21T00:00:00.000Z', completedAt: null },
      turns: [
        createTurn({
          steps: [
            createThinkingStep({ status: 'completed', completedAt: '2026-07-21T00:00:01.000Z' }),
            createToolStep({ content: '正在读取文件', status: 'completed', completedAt: '2026-07-21T00:00:02.000Z' }),
          ],
          status: 'completed',
          completedAt: '2026-07-21T00:00:02.000Z',
        }),
        createTurn({
          index: 1,
          steps: [createToolStep({ index: 1, content: '正在搜索', status: 'running' })],
          status: 'running',
        }),
      ],
    })

    render(<AssistantMessage entry={entry} isStreaming />)

    expect(screen.getByText('仍在执行')).toBeInTheDocument()
    expect(screen.getByText(/2 回合/)).toBeInTheDocument()
    expect(screen.getByText(/3 步/)).toBeInTheDocument()
    expect(screen.getByText('回合 1')).toBeInTheDocument()
    expect(screen.getByText('最终回合')).toBeInTheDocument()
  })

  it('shows unconfirmed notice in unconfirmed-text state', () => {
    const entry = createEntry({
      content: '分析正在进行中...',
      attempt: { attemptId: 'run-1', runId: 'run-1', status: 'running', startedAt: '2026-07-21T00:00:00.000Z', completedAt: null },
      turns: [
        createTurn({
          steps: [createThinkingStep({ status: 'completed', completedAt: '2026-07-21T00:00:01.000Z' })],
          status: 'running',
        }),
      ],
    })

    render(<AssistantMessage entry={entry} isStreaming />)

    expect(screen.getByText('仍在执行')).toBeInTheDocument()
    expect(screen.getByText(/尚未确认/)).toBeInTheDocument()
  })

  it('shows completed disclosure when run is done', () => {
    const entry = createEntry({
      attempt: { attemptId: 'run-1', runId: 'run-1', status: 'completed', startedAt: '2026-07-21T00:00:00.000Z', completedAt: '2026-07-21T00:00:05.000Z' },
      turns: [
        createTurn({
          steps: [
            createThinkingStep({ status: 'completed', completedAt: '2026-07-21T00:00:01.000Z' }),
          ],
          status: 'completed',
          completedAt: '2026-07-21T00:00:02.000Z',
        }),
      ],
    })

    render(<AssistantMessage entry={entry} isStreaming={false} />)

    expect(screen.getByText('已完成执行过程')).toBeInTheDocument()
    expect(screen.queryByText(/1 步/)).toBeInTheDocument()
  })

  it('expands timeline after clicking disclosure when completed', () => {
    const entry = createEntry({
      attempt: { attemptId: 'run-1', runId: 'run-1', status: 'completed', startedAt: '2026-07-21T00:00:00.000Z', completedAt: '2026-07-21T00:00:05.000Z' },
      turns: [
        createTurn({
          steps: [createThinkingStep({ content: '分析完成', status: 'completed', completedAt: '2026-07-21T00:00:01.000Z' })],
          status: 'completed',
          completedAt: '2026-07-21T00:00:01.000Z',
        }),
      ],
    })

    render(<AssistantMessage entry={entry} isStreaming={false} />)

    // Timeline should be hidden initially (collapsed)
    expect(screen.queryByText(/回合/)).not.toBeInTheDocument()

    // Click the disclosure to expand
    const disclosure = screen.getByText('已完成执行过程').closest('button')!
    fireEvent.click(disclosure)

    // Timeline should now be visible
    expect(screen.getByText(/回合/)).toBeInTheDocument()
    expect(screen.getByText('分析完成')).toBeInTheDocument()
  })

  it('shows cancelled state with preserved content', () => {
    const entry = createEntry({
      content: '部分分析结果...',
      attempt: { attemptId: 'run-1', runId: 'run-1', status: 'cancelled', startedAt: '2026-07-21T00:00:00.000Z', completedAt: '2026-07-21T00:00:03.000Z' },
      turns: [
        createTurn({
          steps: [createThinkingStep({ status: 'completed', completedAt: '2026-07-21T00:00:01.000Z' })],
          status: 'cancelled',
          completedAt: '2026-07-21T00:00:03.000Z',
        }),
      ],
    })

    render(<AssistantMessage entry={entry} isStreaming={false} />)

    expect(screen.getByText('已中断执行过程')).toBeInTheDocument()
    expect(screen.getByText(/被用户中断/)).toBeInTheDocument()
    expect(screen.getByText('部分分析结果...')).toBeInTheDocument()
  })

  it('shows failed state', () => {
    const entry = createEntry({
      attempt: { attemptId: 'run-1', runId: 'run-1', status: 'failed', startedAt: '2026-07-21T00:00:00.000Z', completedAt: '2026-07-21T00:00:01.000Z' },
      turns: [
        createTurn({
          steps: [createToolStep({ status: 'failed', completedAt: '2026-07-21T00:00:01.000Z' })],
          status: 'failed',
          completedAt: '2026-07-21T00:00:01.000Z',
        }),
      ],
    })

    render(<AssistantMessage entry={entry} isStreaming={false} />)

    expect(screen.getByText('执行失败')).toBeInTheDocument()
  })

  it('falls back to plain text bubble when turns are empty', () => {
    const entry = createEntry({ turns: [] })

    render(<AssistantMessage entry={entry} isStreaming={false} />)

    expect(screen.getByText('分析完成。')).toBeInTheDocument()
    expect(screen.queryByText('仍在执行')).not.toBeInTheDocument()
    expect(screen.queryByText('已完成执行过程')).not.toBeInTheDocument()
  })

  it('shows thinking content in timeline', () => {
    const entry = createEntry({
      attempt: { attemptId: 'run-1', runId: 'run-1', status: 'running', startedAt: '2026-07-21T00:00:00.000Z', completedAt: null },
      turns: [
        createTurn({
          steps: [createThinkingStep({ content: '正在分析数据库 schema...', status: 'completed', completedAt: '2026-07-21T00:00:01.000Z' })],
          status: 'completed',
          completedAt: '2026-07-21T00:00:01.000Z',
        }),
      ],
    })

    render(<AssistantMessage entry={entry} isStreaming />)

    expect(screen.getByText('正在分析数据库 schema...')).toBeInTheDocument()
  })

  it('shows running indicator for empty running turn', () => {
    const entry = createEntry({
      attempt: { attemptId: 'run-1', runId: 'run-1', status: 'running', startedAt: '2026-07-21T00:00:00.000Z', completedAt: null },
      turns: [
        createTurn({ steps: [], status: 'running' }),
      ],
    })

    render(<AssistantMessage entry={entry} isStreaming />)

    expect(screen.getByText('等待中…')).toBeInTheDocument()
  })
})
