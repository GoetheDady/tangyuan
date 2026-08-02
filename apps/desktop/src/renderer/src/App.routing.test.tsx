import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  createDefaultSessionSummary,
  type AgentSessionSummary,
  type TranscriptSnapshot,
} from '@yuanxiao/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'
import {
  createDeferred,
  createReadyRuntimeSnapshot,
  installDefaultAppApi,
  resetAppTestEnvironment,
} from './app.test-helpers'

const NOW = '2026-07-31T09:00:00.000Z'

function createAgentSession(
  agentId: string,
  sessionId: string,
  title: string,
): AgentSessionSummary {
  return {
    ...createDefaultSessionSummary({ sessionId, title, updatedAt: NOW }),
    agentId,
  }
}

function createTranscript(
  agentId: string,
  sessionId: string,
  content: string,
): TranscriptSnapshot {
  return {
    agentId,
    sessionId,
    entries: [
      {
        kind: 'agent-reply',
        index: 0,
        messageId: `reply-${sessionId}`,
        content,
        createdAt: NOW,
        attempt: null,
        turns: [],
      },
    ],
    updatedAt: NOW,
  }
}

describe('聊天路由状态', () => {
  afterEach(resetAppTestEnvironment)
  beforeEach(installDefaultAppApi)

  it('直接访问另一 Agent 的深层 URL 时按 URL 加载会话和 transcript', async () => {
    const runtime = createReadyRuntimeSnapshot({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      maskedValue: 'sk-t...7890',
      profileInitialized: true,
    })
    runtime.agents.push({
      agentId: 'researcher',
      displayName: '研究助手',
      status: 'active',
      defaultProviderId: 'anthropic',
      defaultModelId: 'claude-sonnet-4-5',
      homePath: '~/.yuanxiao/agents/researcher',
      archivedAt: null,
      directoryStatus: 'healthy',
    })
    const defaultSession = createAgentSession(
      'yuanxiao',
      'default-session',
      '默认会话',
    )
    const deepSession = createAgentSession(
      'researcher',
      'deep-session',
      '深层会话',
    )
    window.api.getRuntimeSnapshot = vi.fn().mockResolvedValue(runtime)
    window.api.getLastActiveSession = vi.fn().mockResolvedValue({
      agentId: 'yuanxiao',
      sessionId: 'default-session',
      updatedAt: NOW,
    })
    window.api.listSessions = vi.fn(async ({ agentId }) =>
      agentId === 'researcher' ? [deepSession] : [defaultSession],
    )
    window.api.getTranscript = vi.fn(async ({ agentId, sessionId }) =>
      createTranscript(agentId, sessionId, `来自 ${sessionId}`),
    )
    window.location.hash = '#/chat/researcher/deep-session'

    render(<App />)

    expect(await screen.findByText('来自 deep-session')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: '研究助手' }),
    ).toBeInTheDocument()
    expect(window.api.listSessions).toHaveBeenCalledWith({
      agentId: 'researcher',
    })
    expect(window.api.getTranscript).toHaveBeenCalledWith({
      agentId: 'researcher',
      sessionId: 'deep-session',
    })
  })

  it('快速切换 session 时只接纳并持久化最后一个 transcript 请求', async () => {
    const user = userEvent.setup()
    const runtime = createReadyRuntimeSnapshot({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      maskedValue: 'sk-t...7890',
      profileInitialized: true,
    })
    runtime.agents.push({
      agentId: 'researcher',
      displayName: '研究助手',
      status: 'active',
      defaultProviderId: 'anthropic',
      defaultModelId: 'claude-sonnet-4-5',
      homePath: '~/.yuanxiao/agents/researcher',
      archivedAt: null,
      directoryStatus: 'healthy',
    })
    const defaultSession = createAgentSession(
      'yuanxiao',
      'default-session',
      '默认会话',
    )
    const firstSession = createAgentSession(
      'researcher',
      'first-session',
      '第一会话',
    )
    const lastSession = createAgentSession(
      'researcher',
      'last-session',
      '最后会话',
    )
    const firstTranscript = createDeferred<TranscriptSnapshot>()
    const lastTranscript = createDeferred<TranscriptSnapshot>()
    window.api.getRuntimeSnapshot = vi.fn().mockResolvedValue(runtime)
    window.api.getLastActiveSession = vi.fn().mockResolvedValue({
      agentId: 'yuanxiao',
      sessionId: 'default-session',
      updatedAt: NOW,
    })
    window.api.listSessions = vi.fn(async ({ agentId }) =>
      agentId === 'researcher' ? [firstSession, lastSession] : [defaultSession],
    )
    window.api.getTranscript = vi.fn(({ agentId, sessionId }) => {
      if (agentId === 'researcher' && sessionId === 'first-session') {
        return firstTranscript.promise
      }
      if (agentId === 'researcher' && sessionId === 'last-session') {
        return lastTranscript.promise
      }
      return Promise.resolve(createTranscript(agentId, sessionId, '默认内容'))
    })
    window.location.hash = '#/chat/researcher'

    render(<App />)

    await user.click(await screen.findByRole('treeitem', { name: '第一会话' }))
    await user.click(screen.getByRole('treeitem', { name: '最后会话' }))
    lastTranscript.resolve(
      createTranscript('researcher', 'last-session', '最后请求内容'),
    )

    expect(await screen.findByText('最后请求内容')).toBeInTheDocument()
    firstTranscript.resolve(
      createTranscript('researcher', 'first-session', '过期请求内容'),
    )

    await waitFor(() => {
      expect(window.api.setLastActiveSession).toHaveBeenLastCalledWith({
        agentId: 'researcher',
        sessionId: 'last-session',
      })
    })
    expect(screen.queryByText('过期请求内容')).not.toBeInTheDocument()
    expect(window.location.hash).toBe('#/chat/researcher/last-session')
  })
})
