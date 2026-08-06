import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  createDefaultSessionSummary,
  type AgentSessionSummary,
} from '@yuanxiao/contracts'
import { describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ConversationArea } from './ConversationArea'

const session: AgentSessionSummary = createDefaultSessionSummary({
  sessionId: 'session-1',
  title: '架构讨论',
  updatedAt: '2026-07-28T00:00:00.000Z',
})

function renderConversationArea(
  overrides: Partial<Parameters<typeof ConversationArea>[0]> = {},
): ReturnType<typeof render> {
  return render(
    <TooltipProvider>
      <ConversationArea
        selectedSession={session}
        parentSession={null}
        forkSource={null}
        transcript={null}
        isLoadingTranscript={false}
        isStreaming={false}
        isAwaitingResponse={false}
        pendingApprovals={[]}
        pendingClarifications={[]}
        activeAgentDisplayName="元宵"
        composer={{
          value: '',
          onChange: vi.fn(),
          onSubmit: vi.fn(),
          onCancel: vi.fn(),
          isRunning: false,
          disabled: false,
          sessionModelInfo: null,
          isLoadingModelInfo: false,
          isSwitchingModel: false,
          providers: [],
          selectableModels: [],
          onModelChange: vi.fn(),
          onThinkingLevelChange: vi.fn(),
        }}
        actions={{
          onRetry: vi.fn(),
          onFork: vi.fn(),
          onViewForkSource: vi.fn(),
        }}
        approvals={{
          onApproveOnce: vi.fn(),
          onApproveAlways: vi.fn(),
          onReject: vi.fn(),
        }}
        clarifications={{
          onAnswer: vi.fn(),
          onCancel: vi.fn(),
        }}
        {...overrides}
      />
    </TooltipProvider>,
  )
}

describe('ConversationArea', () => {
  it('渲染会话标题与输入区，提交时触发 onSubmit', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    renderConversationArea({
      composer: {
        value: '你好',
        onChange: vi.fn(),
        onSubmit,
        onCancel: vi.fn(),
        isRunning: false,
        disabled: false,
        sessionModelInfo: {
          providerId: 'anthropic',
          modelId: 'claude-sonnet-4-5',
          displayName: 'Claude Sonnet 4.5',
          thinkingLevel: null,
          supportedThinkingLevels: [],
          supportsThinking: false,
        },
        isLoadingModelInfo: false,
        isSwitchingModel: false,
        providers: [],
        selectableModels: [],
        onModelChange: vi.fn(),
        onThinkingLevelChange: vi.fn(),
      },
    })

    expect(screen.getByTestId('chat-header')).toHaveTextContent('架构讨论')
    const input = screen.getByPlaceholderText('继续输入...')
    await user.type(input, '！')
    await user.keyboard('{Enter}')
    expect(onSubmit).toHaveBeenCalled()
  })

  it('只展示当前会话的待审批请求', () => {
    const onApproveOnce = vi.fn()
    renderConversationArea({
      pendingApprovals: [
        {
          approvalId: 'approval-1',
          sessionId: 'session-1',
          agentId: 'yuanxiao',
          command: 'ls',
          cwd: '/tmp',
          runId: 'run-1',
          riskDescription: '低风险',
          riskLevel: 'normal',
          status: 'pending',
          createdAt: '2026-07-28T00:00:00.000Z',
        },
        {
          approvalId: 'approval-2',
          sessionId: 'other-session',
          agentId: 'yuanxiao',
          command: 'rm -rf /',
          cwd: '/',
          runId: 'run-2',
          riskDescription: '高风险',
          riskLevel: 'high',
          status: 'pending',
          createdAt: '2026-07-28T00:00:00.000Z',
        },
      ],
      approvals: { onApproveOnce, onApproveAlways: vi.fn(), onReject: vi.fn() },
    })

    expect(screen.getByText('ls')).toBeInTheDocument()
    expect(screen.queryByText('rm -rf /')).not.toBeInTheDocument()
  })

  it('transcript 读取中显示会话读取提示，不渲染消息流', () => {
    renderConversationArea({ isLoadingTranscript: true })

    expect(screen.getByTestId('session-loading-hint')).toBeInTheDocument()
    expect(screen.queryByTestId('message-scroll-area')).not.toBeInTheDocument()
  })

  it('transcript 就绪后读取提示消失，消息流以进入动画容器渲染', () => {
    renderConversationArea({
      isLoadingTranscript: false,
      transcript: {
        sessionId: 'session-1',
        agentId: 'yuanxiao',
        entries: [],
        updatedAt: '2026-07-28T00:00:00.000Z',
      },
    })

    expect(screen.queryByTestId('session-loading-hint')).not.toBeInTheDocument()
    expect(screen.getByTestId('message-scroll-area')).toBeInTheDocument()
    expect(screen.getByTestId('message-stream')).toHaveClass(
      'animate-session-content-enter',
    )
  })

  it('transcript 读取失败后不显示读取提示，回到消息流空态', () => {
    renderConversationArea({ isLoadingTranscript: false })

    expect(screen.queryByTestId('session-loading-hint')).not.toBeInTheDocument()
    expect(screen.getByTestId('message-stream')).toBeInTheDocument()
  })
})
