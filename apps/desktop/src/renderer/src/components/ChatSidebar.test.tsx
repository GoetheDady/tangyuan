import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  createDefaultSessionSummary,
  type AgentSessionSummary,
  type AgentSummary,
} from '@yuanxiao/contracts'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { ChatSidebar } from './ChatSidebar'

const agents: AgentSummary[] = [
  {
    agentId: 'yuanxiao',
    displayName: '元宵',
    status: 'active',
    defaultProviderId: 'anthropic',
    defaultModelId: 'claude-sonnet-4-5',
    homePath: '/tmp/agents/yuanxiao',
    archivedAt: null,
    directoryStatus: 'healthy',
  },
]

function createSession(sessionId: string, title: string): AgentSessionSummary {
  return createDefaultSessionSummary({
    sessionId,
    title,
    updatedAt: '2026-07-28T00:00:00.000Z',
  })
}

describe('ChatSidebar', () => {
  it('渲染 Agent 导航与会话分组，并透传选择与新建回调', async () => {
    const user = userEvent.setup()
    const onSelectSession = vi.fn()
    const onCreateSession = vi.fn()
    render(
      <MemoryRouter>
        <ChatSidebar
          agents={agents}
          activeAgentId="yuanxiao"
          sessions={[
            createSession('session-1', '今天会话'),
            createSession('session-2', '较早会话'),
          ]}
          selectedSessionId="session-1"
          pendingApprovalSessionIds={[]}
          archivedSessions={[]}
          recoveringSessionId={null}
          onAgentChange={vi.fn()}
          onCreateSession={onCreateSession}
          onSelectSession={onSelectSession}
          onRecoverSession={vi.fn()}
          onArchiveSession={vi.fn()}
          onDeleteSession={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('chat-agent-rail')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: '切换到 Agent 元宵' }),
    ).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('今天会话')).toBeInTheDocument()

    await user.click(screen.getByText('今天会话'))
    expect(onSelectSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-1' }),
    )

    await user.click(screen.getByRole('button', { name: '新建会话' }))
    expect(onCreateSession).toHaveBeenCalledOnce()
  })

  it('没有会话时展示空态', () => {
    render(
      <MemoryRouter>
        <ChatSidebar
          agents={agents}
          activeAgentId="yuanxiao"
          sessions={[]}
          selectedSessionId={null}
          pendingApprovalSessionIds={[]}
          archivedSessions={[]}
          recoveringSessionId={null}
          onAgentChange={vi.fn()}
          onCreateSession={vi.fn()}
          onSelectSession={vi.fn()}
          onRecoverSession={vi.fn()}
          onArchiveSession={vi.fn()}
          onDeleteSession={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('暂无会话')).toBeInTheDocument()
  })
})
