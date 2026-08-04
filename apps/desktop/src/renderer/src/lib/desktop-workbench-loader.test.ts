import {
  createDefaultSessionSummary,
  type DesktopPreloadApi,
} from '@yuanxiao/contracts'
import { describe, expect, it, vi } from 'vitest'
import { createReadyRuntimeSnapshot } from '../app.test-helpers'
import {
  loadDesktopWorkbench,
} from './desktop-workbench-loader'

function createApi(overrides: Partial<DesktopPreloadApi>): DesktopPreloadApi {
  return overrides as DesktopPreloadApi
}

describe('desktop workbench loader', () => {
  it('通过单一续接调用加载会话，不在 Renderer 重做恢复策略', async () => {
    const activeSession = createDefaultSessionSummary({
      sessionId: 'active-session',
      title: '活跃会话',
      updatedAt: '2026-08-03T08:00:00.000Z',
    })
    const transcript = {
      agentId: 'yuanxiao',
      sessionId: activeSession.sessionId,
      entries: [],
      updatedAt: '2026-08-03T09:00:00.000Z',
    }
    const resumeSession = vi.fn().mockResolvedValue({
      sessions: [activeSession],
      archivedSessions: [],
      activeSession,
      transcript,
    })
    const runtime = createReadyRuntimeSnapshot({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      maskedValue: 'sk-t...7890',
      profileInitialized: true,
    })
    const api = createApi({
      getRuntimeSnapshot: vi.fn().mockResolvedValue(runtime),
      resumeSession,
    })

    await expect(loadDesktopWorkbench(api)).resolves.toMatchObject({
      sessions: [activeSession],
      archivedSessions: [],
      activeSession,
      transcript,
    })
    expect(resumeSession).toHaveBeenCalledOnce()
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
      resumeSession: vi.fn().mockRejectedValue(new Error('会话索引不可读')),
    })

    await expect(loadDesktopWorkbench(api)).resolves.toMatchObject({
      runtime,
      sessions: [],
      activeSession: null,
      transcript: null,
      sessionLoadError: '会话索引不可读',
    })
  })

})
