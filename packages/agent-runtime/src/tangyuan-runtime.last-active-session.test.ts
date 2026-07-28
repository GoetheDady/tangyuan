import type { AgentSessionSummary, LastActiveSession } from '@tangyuan/contracts'
import { describe, expect, it, vi } from 'vitest'
import { createTangyuanRuntimeForTesting } from './TangyuanRuntime'
import {
  createRuntimeDriver,
  createSessionDriver,
  createSnapshot,
} from './tangyuan-runtime.test-helpers'

const savedRecord: LastActiveSession = {
  agentId: 'agent-2',
  sessionId: 'fork-session',
  updatedAt: '2026-07-28T10:00:00.000Z',
}

const sessions: AgentSessionSummary[] = [
  {
    agentId: 'tangyuan',
    sessionId: 'default-recent',
    title: '默认最近会话',
    state: 'idle',
    updatedAt: '2026-07-28T12:00:00.000Z',
  },
  {
    agentId: 'agent-2',
    sessionId: 'fork-session',
    title: '分叉会话',
    state: 'idle',
    updatedAt: '2026-07-28T09:00:00.000Z',
    forkedFrom: { sessionId: 'parent-session', entryId: 'message-1' },
  },
  {
    agentId: 'agent-2',
    sessionId: 'parent-session',
    title: '父会话',
    state: 'idle',
    updatedAt: '2026-07-28T08:00:00.000Z',
  },
]

describe('TangyuanRuntime · 最后激活会话', () => {
  it('优先恢复仍可用的自定义 Agent 分叉会话', async () => {
    const snapshot = createSnapshot()
    snapshot.agents.push({
      agentId: 'agent-2',
      displayName: '研究助手',
      status: 'active',
      defaultProviderId: null,
      defaultModelId: null,
      homePath: '~/.tangyuan/agents/agent-2',
      archivedAt: null,
      directoryStatus: 'healthy',
    })
    const sessionDriver = createSessionDriver(sessions)
    sessionDriver.listSessions = vi.fn(async ({ agentId }) =>
      sessions.filter((session) => session.agentId === agentId),
    )
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver: createRuntimeDriver(snapshot),
      sessionDriver,
      lastActiveSessionStore: {
        read: vi.fn().mockResolvedValue(savedRecord),
        write: vi.fn(),
        clear: vi.fn(),
      },
    })

    await expect(runtime.getLastActiveSession()).resolves.toEqual(savedRecord)
  })

  it('记录指向已归档 Agent 时回退到默认 Agent 的最近会话', async () => {
    const snapshot = createSnapshot()
    snapshot.agents.push({
      agentId: 'agent-2',
      displayName: '研究助手',
      status: 'archived',
      defaultProviderId: null,
      defaultModelId: null,
      homePath: '~/.tangyuan/agents/agent-2',
      archivedAt: '2026-07-28T11:00:00.000Z',
      directoryStatus: 'healthy',
    })
    const sessionDriver = createSessionDriver(sessions)
    sessionDriver.listSessions = vi.fn(async ({ agentId }) =>
      sessions.filter((session) => session.agentId === agentId),
    )
    const fallbackRecord: LastActiveSession = {
      agentId: 'tangyuan',
      sessionId: 'default-recent',
      updatedAt: '2026-07-28T13:00:00.000Z',
    }
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver: createRuntimeDriver(snapshot),
      sessionDriver,
      lastActiveSessionStore: {
        read: vi.fn().mockResolvedValue(savedRecord),
        write: vi.fn().mockResolvedValue(fallbackRecord),
        clear: vi.fn(),
      },
    })

    await expect(runtime.getLastActiveSession()).resolves.toEqual(fallbackRecord)
  })

  it('记录指向损坏会话时回退到默认 Agent 的最近可读会话', async () => {
    const snapshot = createSnapshot()
    snapshot.agents.push({
      agentId: 'agent-2',
      displayName: '研究助手',
      status: 'active',
      defaultProviderId: null,
      defaultModelId: null,
      homePath: '~/.tangyuan/agents/agent-2',
      archivedAt: null,
      directoryStatus: 'healthy',
    })
    const sessionsWithOlderFallback: AgentSessionSummary[] = [
      ...sessions,
      {
        agentId: 'tangyuan',
        sessionId: 'default-older',
        title: '默认较旧会话',
        state: 'idle',
        updatedAt: '2026-07-28T11:00:00.000Z',
      },
    ]
    const sessionDriver = createSessionDriver(sessionsWithOlderFallback)
    sessionDriver.listSessions = vi.fn(async ({ agentId }) =>
      sessionsWithOlderFallback.filter((session) => session.agentId === agentId),
    )
    sessionDriver.getTranscript = vi.fn(async ({ agentId, sessionId }) => {
      if (sessionId === 'fork-session' || sessionId === 'default-recent') {
        throw new Error('Pi session JSONL 损坏')
      }

      return {
        agentId,
        sessionId,
        entries: [],
        updatedAt: '2026-07-28T12:00:00.000Z',
      }
    })
    const fallbackRecord: LastActiveSession = {
      agentId: 'tangyuan',
      sessionId: 'default-older',
      updatedAt: '2026-07-28T13:00:00.000Z',
    }
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver: createRuntimeDriver(snapshot),
      sessionDriver,
      lastActiveSessionStore: {
        read: vi.fn().mockResolvedValue(savedRecord),
        write: vi.fn().mockResolvedValue(fallbackRecord),
        clear: vi.fn(),
      },
    })

    await expect(runtime.getLastActiveSession()).resolves.toEqual(fallbackRecord)
    expect(sessionDriver.getTranscript).toHaveBeenCalledWith({
      agentId: 'tangyuan',
      sessionId: 'default-older',
    })
  })

  it('记录指向父会话缺失的分叉时回退到默认 Agent 会话', async () => {
    const snapshot = createSnapshot()
    snapshot.agents.push({
      agentId: 'agent-2',
      displayName: '研究助手',
      status: 'active',
      defaultProviderId: null,
      defaultModelId: null,
      homePath: '~/.tangyuan/agents/agent-2',
      archivedAt: null,
      directoryStatus: 'healthy',
    })
    const sessionsWithoutParent = sessions.filter(
      (session) => session.sessionId !== 'parent-session',
    )
    const sessionDriver = createSessionDriver(sessionsWithoutParent)
    sessionDriver.listSessions = vi.fn(async ({ agentId }) =>
      sessionsWithoutParent.filter((session) => session.agentId === agentId),
    )
    const fallbackRecord: LastActiveSession = {
      agentId: 'tangyuan',
      sessionId: 'default-recent',
      updatedAt: '2026-07-28T13:00:00.000Z',
    }
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver: createRuntimeDriver(snapshot),
      sessionDriver,
      lastActiveSessionStore: {
        read: vi.fn().mockResolvedValue(savedRecord),
        write: vi.fn().mockResolvedValue(fallbackRecord),
        clear: vi.fn(),
      },
    })

    await expect(runtime.getLastActiveSession()).resolves.toEqual(fallbackRecord)
  })

  it('目标分叉会话可用时更新最后激活记录', async () => {
    const snapshot = createSnapshot()
    snapshot.agents.push({
      agentId: 'agent-2',
      displayName: '研究助手',
      status: 'active',
      defaultProviderId: null,
      defaultModelId: null,
      homePath: '~/.tangyuan/agents/agent-2',
      archivedAt: null,
      directoryStatus: 'healthy',
    })
    const sessionDriver = createSessionDriver(sessions)
    sessionDriver.listSessions = vi.fn(async ({ agentId }) =>
      sessions.filter((session) => session.agentId === agentId),
    )
    const nextRecord: LastActiveSession = {
      ...savedRecord,
      updatedAt: '2026-07-28T14:00:00.000Z',
    }
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver: createRuntimeDriver(snapshot),
      sessionDriver,
      lastActiveSessionStore: {
        read: vi.fn().mockResolvedValue(null),
        write: vi.fn().mockResolvedValue(nextRecord),
        clear: vi.fn(),
      },
    })

    await expect(
      runtime.setLastActiveSession({
        agentId: 'agent-2',
        sessionId: 'fork-session',
      }),
    ).resolves.toEqual(nextRecord)
  })
})
