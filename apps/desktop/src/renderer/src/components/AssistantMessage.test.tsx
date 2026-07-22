import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentReplyEntry, RunTurn, TurnStep } from '@tangyuan/contracts'
import { AssistantMessage } from './AssistantMessage'

function createMockApi() {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { openExternalLink: vi.fn().mockResolvedValue(undefined) }
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
      completedAt: null
    },
    turns: [],
    ...overrides
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
    ...overrides
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
    ...overrides
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
    ...overrides
  }
}

describe('AssistantMessage', () => {
  beforeEach(() => {
    createMockApi()
  })

  it('renders expanded disclosure with loader when in active tool loop state', () => {
    const entry = createEntry({
      attempt: {
        attemptId: 'run-1',
        runId: 'run-1',
        status: 'running',
        startedAt: '2026-07-21T00:00:00.000Z',
        completedAt: null
      },
      turns: [
        createTurn({
          steps: [
            createThinkingStep({ status: 'completed', completedAt: '2026-07-21T00:00:01.000Z' }),
            createToolStep({
              content: '正在读取文件',
              status: 'completed',
              completedAt: '2026-07-21T00:00:02.000Z'
            })
          ],
          status: 'completed',
          completedAt: '2026-07-21T00:00:02.000Z'
        }),
        createTurn({
          index: 1,
          steps: [createToolStep({ index: 1, content: '正在搜索', status: 'running' })],
          status: 'running'
        })
      ]
    })

    render(<AssistantMessage entry={entry} isStreaming />)

    expect(screen.getByText('仍在执行')).toBeInTheDocument()
    expect(screen.getByText(/2 回合/)).toBeInTheDocument()
    expect(screen.getByText(/3 步/)).toBeInTheDocument()
    expect(screen.getByText('TURN 1')).toBeInTheDocument()
    expect(screen.getByText('FINAL TURN')).toBeInTheDocument()
  })

  it('shows unconfirmed notice in unconfirmed-text state', () => {
    const entry = createEntry({
      content: '分析正在进行中...',
      attempt: {
        attemptId: 'run-1',
        runId: 'run-1',
        status: 'running',
        startedAt: '2026-07-21T00:00:00.000Z',
        completedAt: null
      },
      turns: [
        createTurn({
          steps: [
            createThinkingStep({ status: 'completed', completedAt: '2026-07-21T00:00:01.000Z' })
          ],
          status: 'running'
        })
      ]
    })

    render(<AssistantMessage entry={entry} isStreaming />)

    expect(screen.getByText('仍在执行')).toBeInTheDocument()
    expect(screen.getByText(/尚未确认/)).toBeInTheDocument()
  })

  it('shows completed disclosure when run is done', () => {
    const entry = createEntry({
      attempt: {
        attemptId: 'run-1',
        runId: 'run-1',
        status: 'completed',
        startedAt: '2026-07-21T00:00:00.000Z',
        completedAt: '2026-07-21T00:00:05.000Z'
      },
      turns: [
        createTurn({
          steps: [
            createThinkingStep({ status: 'completed', completedAt: '2026-07-21T00:00:01.000Z' })
          ],
          status: 'completed',
          completedAt: '2026-07-21T00:00:02.000Z'
        })
      ]
    })

    render(<AssistantMessage entry={entry} isStreaming={false} />)

    expect(screen.getByText('已完成执行过程')).toBeInTheDocument()
    expect(screen.queryByText(/1 步/)).toBeInTheDocument()
  })

  it('expands timeline after clicking disclosure when completed', () => {
    const entry = createEntry({
      attempt: {
        attemptId: 'run-1',
        runId: 'run-1',
        status: 'completed',
        startedAt: '2026-07-21T00:00:00.000Z',
        completedAt: '2026-07-21T00:00:05.000Z'
      },
      turns: [
        createTurn({
          steps: [
            createThinkingStep({
              content: '分析完成',
              status: 'completed',
              completedAt: '2026-07-21T00:00:01.000Z'
            })
          ],
          status: 'completed',
          completedAt: '2026-07-21T00:00:01.000Z'
        })
      ]
    })

    render(<AssistantMessage entry={entry} isStreaming={false} />)

    // Timeline should be hidden initially (collapsed)
    expect(screen.queryByText(/TURN/)).not.toBeInTheDocument()

    // Click the disclosure to expand
    const disclosure = screen.getByText('已完成执行过程').closest('button')!
    fireEvent.click(disclosure)

    // Timeline should now be visible
    expect(screen.getByText(/TURN/)).toBeInTheDocument()
    expect(screen.getByText('分析完成')).toBeInTheDocument()
  })

  it('shows cancelled state with preserved content', () => {
    const entry = createEntry({
      content: '部分分析结果...',
      attempt: {
        attemptId: 'run-1',
        runId: 'run-1',
        status: 'cancelled',
        startedAt: '2026-07-21T00:00:00.000Z',
        completedAt: '2026-07-21T00:00:03.000Z'
      },
      turns: [
        createTurn({
          steps: [
            createThinkingStep({ status: 'completed', completedAt: '2026-07-21T00:00:01.000Z' })
          ],
          status: 'cancelled',
          completedAt: '2026-07-21T00:00:03.000Z'
        })
      ]
    })

    render(<AssistantMessage entry={entry} isStreaming={false} />)

    expect(screen.getByText('已中断执行过程')).toBeInTheDocument()
    expect(screen.getByText(/被用户中断/)).toBeInTheDocument()
    expect(screen.getByText('部分分析结果...')).toBeInTheDocument()
  })

  it('shows failed state', () => {
    const entry = createEntry({
      attempt: {
        attemptId: 'run-1',
        runId: 'run-1',
        status: 'failed',
        startedAt: '2026-07-21T00:00:00.000Z',
        completedAt: '2026-07-21T00:00:01.000Z'
      },
      turns: [
        createTurn({
          steps: [createToolStep({ status: 'failed', completedAt: '2026-07-21T00:00:01.000Z' })],
          status: 'failed',
          completedAt: '2026-07-21T00:00:01.000Z'
        })
      ]
    })

    render(<AssistantMessage entry={entry} isStreaming={false} />)

    expect(screen.getAllByText('执行失败').length).toBeGreaterThan(0)
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
      attempt: {
        attemptId: 'run-1',
        runId: 'run-1',
        status: 'running',
        startedAt: '2026-07-21T00:00:00.000Z',
        completedAt: null
      },
      turns: [
        createTurn({
          steps: [
            createThinkingStep({
              content: '正在分析数据库 schema...',
              status: 'completed',
              completedAt: '2026-07-21T00:00:01.000Z'
            })
          ],
          status: 'completed',
          completedAt: '2026-07-21T00:00:01.000Z'
        })
      ]
    })

    render(<AssistantMessage entry={entry} isStreaming />)

    expect(screen.getByText('正在分析数据库 schema...')).toBeInTheDocument()
  })

  it('shows running indicator for empty running turn', () => {
    const entry = createEntry({
      attempt: {
        attemptId: 'run-1',
        runId: 'run-1',
        status: 'running',
        startedAt: '2026-07-21T00:00:00.000Z',
        completedAt: null
      },
      turns: [createTurn({ steps: [], status: 'running' })]
    })

    render(<AssistantMessage entry={entry} isStreaming />)

    expect(screen.getByText('等待中…')).toBeInTheDocument()
  })

  it('shows tool name and safe summary in tool steps', () => {
    const entry = createEntry({
      attempt: {
        attemptId: 'run-1',
        runId: 'run-1',
        status: 'running',
        startedAt: '2026-07-21T00:00:00.000Z',
        completedAt: null
      },
      turns: [
        createTurn({
          steps: [
            {
              index: 0,
              kind: 'tool-call',
              content: '读取文件',
              toolName: 'read',
              status: 'completed' as const,
              startedAt: '2026-07-21T00:00:00.000Z',
              completedAt: '2026-07-21T00:00:01.000Z'
            }
          ],
          status: 'completed',
          completedAt: '2026-07-21T00:00:01.000Z'
        })
      ]
    })

    render(<AssistantMessage entry={entry} isStreaming />)

    // Should show tool name and safe summary
    expect(screen.getByText(/read/)).toBeInTheDocument()
    expect(screen.getByText(/读取文件/)).toBeInTheDocument()
  })

  it('shows duration label for completed steps', () => {
    const entry = createEntry({
      attempt: {
        attemptId: 'run-1',
        runId: 'run-1',
        status: 'running',
        startedAt: '2026-07-21T00:00:00.000Z',
        completedAt: null
      },
      turns: [
        createTurn({
          steps: [
            {
              index: 0,
              kind: 'tool-call',
              content: '执行命令',
              toolName: 'bash',
              status: 'completed' as const,
              startedAt: '2026-07-21T00:00:00.000Z',
              completedAt: '2026-07-21T00:00:02.000Z'
            }
          ],
          status: 'completed',
          completedAt: '2026-07-21T00:00:02.000Z'
        })
      ]
    })

    render(<AssistantMessage entry={entry} isStreaming />)

    // Should show duration (2 seconds)
    expect(screen.getByText('2s')).toBeInTheDocument()
  })

  it('shows minutes duration for long running steps', () => {
    const entry = createEntry({
      attempt: {
        attemptId: 'run-1',
        runId: 'run-1',
        status: 'running',
        startedAt: '2026-07-21T00:00:00.000Z',
        completedAt: null
      },
      turns: [
        createTurn({
          steps: [
            {
              index: 0,
              kind: 'tool-call',
              content: '执行命令',
              toolName: 'bash',
              status: 'completed' as const,
              startedAt: '2026-07-21T00:00:00.000Z',
              completedAt: '2026-07-21T00:01:30.000Z'
            }
          ],
          status: 'completed',
          completedAt: '2026-07-21T00:01:30.000Z'
        })
      ]
    })

    render(<AssistantMessage entry={entry} isStreaming />)

    // Should show duration in minutes and seconds
    expect(screen.getByText('1m 30s')).toBeInTheDocument()
  })

  it('shows failed tool step with distinct background', () => {
    const entry = createEntry({
      attempt: {
        attemptId: 'run-1',
        runId: 'run-1',
        status: 'running',
        startedAt: '2026-07-21T00:00:00.000Z',
        completedAt: null
      },
      turns: [
        createTurn({
          steps: [
            {
              index: 0,
              kind: 'tool-call',
              content: '执行命令失败',
              toolName: 'bash',
              status: 'failed' as const,
              startedAt: '2026-07-21T00:00:00.000Z',
              completedAt: '2026-07-21T00:00:01.000Z'
            }
          ],
          status: 'completed',
          completedAt: '2026-07-21T00:00:01.000Z'
        })
      ]
    })

    render(<AssistantMessage entry={entry} isStreaming />)

    expect(screen.getByText(/执行命令失败/)).toBeInTheDocument()
    // Should show failure icon
    expect(screen.getByLabelText('失败')).toBeInTheDocument()
  })

  it('displays custom tool with name and status fallback', () => {
    const entry = createEntry({
      attempt: {
        attemptId: 'run-1',
        runId: 'run-1',
        status: 'running',
        startedAt: '2026-07-21T00:00:00.000Z',
        completedAt: null
      },
      turns: [
        createTurn({
          steps: [
            {
              index: 0,
              kind: 'tool-call',
              content: 'my_tool（已完成）',
              toolName: 'my_tool',
              status: 'completed' as const,
              startedAt: '2026-07-21T00:00:00.000Z',
              completedAt: '2026-07-21T00:00:01.000Z'
            }
          ],
          status: 'completed',
          completedAt: '2026-07-21T00:00:01.000Z'
        })
      ]
    })

    render(<AssistantMessage entry={entry} isStreaming />)

    // Should show tool name and fallback summary
    expect(screen.getAllByText(/my_tool/).length).toBeGreaterThan(0)
  })

  it('shows multi-turn separation correctly', () => {
    const entry = createEntry({
      attempt: {
        attemptId: 'run-1',
        runId: 'run-1',
        status: 'running',
        startedAt: '2026-07-21T00:00:00.000Z',
        completedAt: null
      },
      turns: [
        createTurn({
          index: 0,
          steps: [
            {
              index: 0,
              kind: 'tool-call' as const,
              content: '读取文件',
              toolName: 'read',
              status: 'completed' as const,
              startedAt: '2026-07-21T00:00:00.000Z',
              completedAt: '2026-07-21T00:00:01.000Z'
            }
          ],
          status: 'completed' as const,
          completedAt: '2026-07-21T00:00:01.000Z'
        }),
        createTurn({
          index: 1,
          steps: [
            {
              index: 0,
              kind: 'tool-call' as const,
              content: '执行命令',
              toolName: 'bash',
              status: 'running' as const,
              startedAt: '2026-07-21T00:00:02.000Z',
              completedAt: null
            }
          ],
          status: 'running' as const
        })
      ]
    })

    render(<AssistantMessage entry={entry} isStreaming />)

    // Should show turn labels
    expect(screen.getByText('TURN 1')).toBeInTheDocument()
    expect(screen.getByText('FINAL TURN')).toBeInTheDocument()
  })

  it('does not auto-collapse when turns contain tool calls during streaming', () => {
    const entry = createEntry({
      content: 'final text',
      attempt: {
        attemptId: 'run-1',
        runId: 'run-1',
        status: 'running',
        startedAt: '2026-07-21T00:00:00.000Z',
        completedAt: null
      },
      turns: [
        createTurn({
          steps: [createToolStep({ content: '执行命令', toolName: 'bash', status: 'running' })],
          status: 'running'
        })
      ]
    })

    render(<AssistantMessage entry={entry} isStreaming />)

    // Should be expanded (active-tool-loop state)
    expect(screen.getByText('仍在执行')).toBeInTheDocument()
    // Timeline should be visible
    expect(screen.getByText(/执行命令/)).toBeInTheDocument()
  })

  it('collapses when final confirmed without tool calls', () => {
    const entry = createEntry({
      content: 'final reply text',
      attempt: {
        attemptId: 'run-1',
        runId: 'run-1',
        status: 'completed',
        startedAt: '2026-07-21T00:00:00.000Z',
        completedAt: '2026-07-21T00:00:05.000Z'
      },
      turns: [
        createTurn({
          steps: [
            createThinkingStep({ status: 'completed', completedAt: '2026-07-21T00:00:01.000Z' })
          ],
          status: 'completed',
          completedAt: '2026-07-21T00:00:05.000Z'
        })
      ]
    })

    render(<AssistantMessage entry={entry} isStreaming={false} />)

    // Should show final content (collapsed state with text visible)
    expect(screen.getByText('final reply text')).toBeInTheDocument()
    // Timeline should be hidden
    expect(screen.queryByText(/TURN/)).not.toBeInTheDocument()
  })

  describe('FailedFooter', () => {
    it('shows retry button for failed attempts', () => {
      const onRetry = vi.fn()
      const entry = createEntry({
        attempt: {
          attemptId: 'run-1',
          runId: 'run-1',
          status: 'failed',
          startedAt: '2026-07-21T00:00:00.000Z',
          completedAt: '2026-07-21T00:00:01.000Z',
          error: { code: 'unknown', message: '连接超时', recoverable: true },
        },
        turns: [
          createTurn({
            steps: [
              createToolStep({
                content: '执行命令失败',
                toolName: 'bash',
                status: 'failed',
                completedAt: '2026-07-21T00:00:01.000Z',
              }),
            ],
            status: 'failed',
            completedAt: '2026-07-21T00:00:01.000Z',
          }),
        ],
      })

      render(<AssistantMessage entry={entry} isStreaming={false} onRetry={onRetry} />)

      // Should show retry button
      expect(screen.getByText('重试')).toBeInTheDocument()
      // Should show failure detail
      expect(
        screen.getByText(/Agent 在产生最终回复前失败/),
      ).toBeInTheDocument()
    })

    it('does not show retry button for cancelled attempts', () => {
      const entry = createEntry({
        content: '部分结果...',
        attempt: {
          attemptId: 'run-1',
          runId: 'run-1',
          status: 'cancelled',
          startedAt: '2026-07-21T00:00:00.000Z',
          completedAt: '2026-07-21T00:00:03.000Z',
        },
        turns: [
          createTurn({
            steps: [createThinkingStep({ status: 'completed' })],
            status: 'cancelled',
            completedAt: '2026-07-21T00:00:03.000Z',
          }),
        ],
      })

      render(<AssistantMessage entry={entry} isStreaming={false} />)

      // Should not show retry button
      expect(screen.queryByText('重试')).not.toBeInTheDocument()
      // Should show cancelled message
      expect(screen.getByText(/被用户中断/)).toBeInTheDocument()
    })

    it('calls onRetry when retry button is clicked', () => {
      const onRetry = vi.fn()
      const entry = createEntry({
        attempt: {
          attemptId: 'run-1',
          runId: 'run-1',
          status: 'failed',
          startedAt: '2026-07-21T00:00:00.000Z',
          completedAt: '2026-07-21T00:00:01.000Z',
        },
        turns: [
          createTurn({
            steps: [
              createToolStep({
                status: 'failed',
                completedAt: '2026-07-21T00:00:01.000Z',
              }),
            ],
            status: 'failed',
            completedAt: '2026-07-21T00:00:01.000Z',
          }),
        ],
      })

      render(<AssistantMessage entry={entry} isStreaming={false} onRetry={onRetry} />)

      fireEvent.click(screen.getByText('重试'))
      expect(onRetry).toHaveBeenCalled()
    })

    it('shows expandable failure steps', () => {
      const entry = createEntry({
        attempt: {
          attemptId: 'run-1',
          runId: 'run-1',
          status: 'failed',
          startedAt: '2026-07-21T00:00:00.000Z',
          completedAt: '2026-07-21T00:00:01.000Z',
          error: { code: 'unknown', message: '工具执行失败', recoverable: true },
        },
        turns: [
          createTurn({
            steps: [
              createToolStep({
                content: '执行命令失败',
                toolName: 'bash',
                status: 'failed',
                completedAt: '2026-07-21T00:00:01.000Z',
              }),
            ],
            status: 'failed',
            completedAt: '2026-07-21T00:00:01.000Z',
          }),
        ],
      })

      render(<AssistantMessage entry={entry} isStreaming={false} />)

      // Should show failure step toggle with count
      expect(screen.getByText(/失败步骤（1）/)).toBeInTheDocument()

      // Click to expand
      fireEvent.click(screen.getByText(/失败步骤（1）/))
      // After expand, StepRow with the tool content appears in the expandable section
      // (in addition to the timeline - getAllByText is fine)
      const stepElements = screen.getAllByText(/执行命令失败/)
      expect(stepElements.length).toBeGreaterThanOrEqual(1)
    })

    it('shows error message from attempt.error when available', () => {
      const entry = createEntry({
        attempt: {
          attemptId: 'run-1',
          runId: 'run-1',
          status: 'failed',
          startedAt: '2026-07-21T00:00:00.000Z',
          completedAt: '2026-07-21T00:00:01.000Z',
          error: { code: 'unknown', message: 'API 调用超时，请重试', recoverable: true },
        },
        turns: [
          createTurn({
            steps: [
              createToolStep({
                status: 'failed',
                completedAt: '2026-07-21T00:00:01.000Z',
              }),
            ],
            status: 'failed',
            completedAt: '2026-07-21T00:00:01.000Z',
          }),
        ],
      })

      render(<AssistantMessage entry={entry} isStreaming={false} />)

      expect(screen.getByText('API 调用超时，请重试')).toBeInTheDocument()
    })
  })
})
