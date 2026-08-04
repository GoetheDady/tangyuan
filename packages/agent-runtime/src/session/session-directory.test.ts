import type { AgentSessionSummary } from '@yuanxiao/contracts'
import { describe, expect, it, vi } from 'vitest'
import { SessionDirectory } from './session-directory'

function makeSession(
  overrides: Partial<AgentSessionSummary> = {},
): AgentSessionSummary {
  return {
    agentId: 'yuanxiao',
    sessionId: 'session-1',
    title: '会话',
    state: 'idle',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function createDirectory(options?: {
  sessions?: AgentSessionSummary[]
  activeRunSessionIds?: readonly string[]
  queuedSessionIds?: readonly string[]
  unreadableSessionIds?: readonly string[]
}) {
  const sessions = options?.sessions ?? []
  const activeRunSessionIds = new Set(options?.activeRunSessionIds)
  const queuedSessionIds = new Set(options?.queuedSessionIds)
  const unreadableSessionIds = new Set(options?.unreadableSessionIds)
  const module = {
    listSessions: vi.fn(async ({ agentId }: { agentId: string }) =>
      sessions.filter((session) => session.agentId === agentId),
    ),
    getActiveRunId: vi.fn((sessionId: string) =>
      activeRunSessionIds.has(sessionId) ? `run-${sessionId}` : undefined,
    ),
    getTranscript: vi.fn(
      async ({
        agentId,
        sessionId,
      }: {
        agentId: string
        sessionId: string
      }) => {
        if (unreadableSessionIds.has(sessionId)) {
          throw new Error('Pi session JSONL 不可读')
        }

        return {
          agentId,
          sessionId,
          entries: [],
          updatedAt: '2024-01-01T00:00:00.000Z',
        }
      },
    ),
  }

  return {
    directory: new SessionDirectory({
      sessions: module,
      isQueued: (sessionId) => queuedSessionIds.has(sessionId),
    }),
    module,
  }
}

describe('SessionDirectory', () => {
  it('按 Agent 分片刷新，并合并 running 与 queued 投影', async () => {
    const sessions = [
      makeSession({ agentId: 'agent-a', sessionId: 'running-session' }),
      makeSession({ agentId: 'agent-a', sessionId: 'queued-session' }),
      makeSession({ agentId: 'agent-b', sessionId: 'idle-session' }),
    ]
    const { directory } = createDirectory({
      sessions,
      activeRunSessionIds: ['running-session'],
      queuedSessionIds: ['queued-session'],
    })

    await expect(directory.refresh('agent-a')).resolves.toMatchObject([
      { sessionId: 'running-session', state: 'running' },
      { sessionId: 'queued-session', state: 'queued' },
    ])
    await directory.refresh('agent-b')

    expect(directory.listAll()).toMatchObject([
      { agentId: 'agent-a', sessionId: 'running-session' },
      { agentId: 'agent-a', sessionId: 'queued-session' },
      { agentId: 'agent-b', sessionId: 'idle-session' },
    ])
  })

  it('父会话缺失或不可读时标记谱系不可用', async () => {
    const sessions = [
      makeSession({ sessionId: 'unreadable-parent' }),
      makeSession({
        sessionId: 'unreadable-child',
        forkedFrom: { sessionId: 'unreadable-parent', entryId: 'message-1' },
      }),
      makeSession({
        sessionId: 'missing-child',
        forkedFrom: { sessionId: 'missing-parent', entryId: 'message-2' },
      }),
    ]
    const { directory } = createDirectory({
      sessions,
      unreadableSessionIds: ['unreadable-parent'],
    })

    const result = await directory.refresh('yuanxiao')

    expect(result).toEqual([
      expect.objectContaining({ sessionId: 'unreadable-parent' }),
      expect.objectContaining({
        sessionId: 'unreadable-child',
        lineageUnavailable: true,
      }),
      expect.objectContaining({
        sessionId: 'missing-child',
        lineageUnavailable: true,
      }),
    ])
    expect(result[0]).not.toHaveProperty('lineageUnavailable')
  })

  it('includeArchived 刷新仍保留活跃会话的谱系不可用标记', async () => {
    const parent = makeSession({ sessionId: 'parent' })
    const child = makeSession({
      sessionId: 'child',
      forkedFrom: { sessionId: 'parent', entryId: 'message-1' },
    })
    const archived = makeSession({
      sessionId: 'archived',
      archivedAt: '2024-02-01T00:00:00.000Z',
    })
    const { directory } = createDirectory({
      sessions: [parent, child, archived],
      unreadableSessionIds: ['parent'],
    })

    await directory.refresh('yuanxiao', true)

    expect(directory.find('child')).toMatchObject({
      lineageUnavailable: true,
    })
    expect(directory.find('archived')).toBeUndefined()
  })

  it('isRestorable 同时校验会话自身与完整父链', async () => {
    const parent = makeSession({ sessionId: 'parent' })
    const child = makeSession({
      sessionId: 'child',
      forkedFrom: { sessionId: 'parent', entryId: 'message-1' },
    })
    const { directory, module } = createDirectory({
      sessions: [parent, child],
      unreadableSessionIds: ['child'],
    })

    await expect(directory.isRestorable(child, [parent, child])).resolves.toBe(
      false,
    )
    expect(module.getTranscript).toHaveBeenCalledWith({
      agentId: 'yuanxiao',
      sessionId: 'child',
    })
    expect(module.getTranscript).not.toHaveBeenCalledWith({
      agentId: 'yuanxiao',
      sessionId: 'parent',
    })
  })

  it('upsert、updateState 与 remove 保持 Agent 分片', async () => {
    const { directory } = createDirectory({
      sessions: [
        makeSession({ agentId: 'agent-a', sessionId: 'a-1' }),
        makeSession({ agentId: 'agent-b', sessionId: 'b-1' }),
      ],
    })
    await directory.refresh('agent-a')
    await directory.refresh('agent-b')

    directory.upsert(
      makeSession({ agentId: 'agent-a', sessionId: 'a-2', title: '新会话' }),
    )
    directory.updateState('a-1', 'running', '2024-02-02T00:00:00.000Z')
    directory.remove('b-1')

    expect(directory.listAll()).toEqual([
      expect.objectContaining({ agentId: 'agent-a', sessionId: 'a-2' }),
      expect.objectContaining({
        agentId: 'agent-a',
        sessionId: 'a-1',
        state: 'running',
        updatedAt: '2024-02-02T00:00:00.000Z',
      }),
    ])
  })
})
