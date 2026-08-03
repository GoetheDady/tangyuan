import {
  createDefaultSessionSummary,
  type DesktopPreloadApi,
} from '@yuanxiao/contracts'
import { describe, expect, it, vi } from 'vitest'
import { createReadyRuntimeSnapshot } from '../app.test-helpers'
import {
  loadDesktopWorkbench,
  loadSessionsForReadyRuntime,
} from './desktop-workbench-loader'

function createApi(overrides: Partial<DesktopPreloadApi>): DesktopPreloadApi {
  return overrides as DesktopPreloadApi
}

describe('desktop workbench loader', () => {
  it('最后激活会话不可读时回退到其他可读会话', async () => {
    const runtime = createReadyRuntimeSnapshot({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      maskedValue: 'sk-t...7890',
      profileInitialized: true,
    })
    const unreadableSession = createDefaultSessionSummary({
      sessionId: 'unreadable-session',
      title: '不可读会话',
      updatedAt: '2026-08-03T08:00:00.000Z',
    })
    const readableSession = createDefaultSessionSummary({
      sessionId: 'readable-session',
      title: '可读会话',
      updatedAt: '2026-08-03T07:00:00.000Z',
    })
    const getTranscript = vi.fn(async ({ sessionId }) => {
      if (sessionId === unreadableSession.sessionId) {
        throw new Error('会话文件不可读')
      }
      return {
        agentId: 'yuanxiao',
        sessionId,
        entries: [],
        updatedAt: '2026-08-03T09:00:00.000Z',
      }
    })
    const setLastActiveSession = vi.fn().mockResolvedValue(null)
    const api = createApi({
      getLastActiveSession: vi.fn().mockResolvedValue({
        agentId: 'yuanxiao',
        sessionId: unreadableSession.sessionId,
        updatedAt: '2026-08-03T08:30:00.000Z',
      }),
      listSessions: vi
        .fn()
        .mockResolvedValue([unreadableSession, readableSession]),
      getTranscript,
      setLastActiveSession,
    })

    const result = await loadSessionsForReadyRuntime(api, runtime)

    expect(result.activeSession).toEqual(readableSession)
    expect(result.transcript?.sessionId).toBe(readableSession.sessionId)
    expect(setLastActiveSession).toHaveBeenCalledWith({
      agentId: 'yuanxiao',
      sessionId: readableSession.sessionId,
    })
  })

  it('冷启动会话恢复失败时保留已就绪的 Runtime', async () => {
    const runtime = createReadyRuntimeSnapshot({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      maskedValue: 'sk-t...7890',
      profileInitialized: true,
    })
    const api = createApi({
      getRuntimeSnapshot: vi.fn().mockResolvedValue(runtime),
      getLastActiveSession: vi
        .fn()
        .mockRejectedValue(new Error('会话索引不可读')),
    })

    await expect(loadDesktopWorkbench(api)).resolves.toMatchObject({
      runtime,
      sessions: [],
      activeSession: null,
      transcript: null,
      sessionLoadError: '会话索引不可读',
    })
  })

  it('一次 includeArchived 查询按归档状态分片返回活跃与归档列表', async () => {
    const runtime = createReadyRuntimeSnapshot({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      maskedValue: 'sk-t...7890',
      profileInitialized: true,
    })
    const activeSession = createDefaultSessionSummary({
      sessionId: 'active-session',
      title: '活跃会话',
      updatedAt: '2026-08-03T08:00:00.000Z',
    })
    const archivedSession = {
      ...createDefaultSessionSummary({
        sessionId: 'archived-session',
        title: '归档会话',
        updatedAt: '2026-08-03T07:00:00.000Z',
      }),
      archivedAt: '2026-08-03T06:00:00.000Z',
    }
    const listSessions = vi
      .fn()
      .mockResolvedValue([archivedSession, activeSession])
    const api = createApi({
      getLastActiveSession: vi.fn().mockResolvedValue(null),
      listSessions,
      createSession: vi.fn().mockResolvedValue(activeSession),
      getTranscript: vi.fn().mockResolvedValue({
        agentId: 'yuanxiao',
        sessionId: activeSession.sessionId,
        entries: [],
        updatedAt: '2026-08-03T09:00:00.000Z',
      }),
      setLastActiveSession: vi.fn().mockResolvedValue(null),
    })

    const result = await loadSessionsForReadyRuntime(api, runtime)

    expect(listSessions).toHaveBeenCalledWith({
      agentId: 'yuanxiao',
      includeArchived: true,
    })
    expect(result.sessions).toEqual([activeSession])
    expect(result.archivedSessions).toEqual([archivedSession])
  })
})
