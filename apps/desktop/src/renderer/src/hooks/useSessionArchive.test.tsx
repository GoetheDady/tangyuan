import {
  createDefaultSessionSummary,
  type AgentSessionSummary,
} from '@yuanxiao/contracts'
import { act, renderHook } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  installDefaultAppApi,
  resetAppTestEnvironment,
} from '../app.test-helpers'
import { createWorkbenchStore } from '../stores/workbench-store'
import { useSessionArchive } from './useSessionArchive'

const NOW = '2026-08-04T10:00:00.000Z'

describe('useSessionArchive', () => {
  beforeEach(installDefaultAppApi)
  afterEach(resetAppTestEnvironment)

  it('操作期间切换 Agent 仍提交原 Agent 的完整目录，但不改写当前路由', async () => {
    const store = createWorkbenchStore()
    const target = createDefaultSessionSummary({
      sessionId: 'session-1',
      title: '待归档',
      updatedAt: NOW,
    })
    const archived = { ...target, archivedAt: NOW }
    store.getState().replaceSessionCatalog('yuanxiao', [target])

    let resolveArchive!: (
      value: Awaited<ReturnType<typeof window.api.archiveSession>>,
    ) => void
    vi.mocked(window.api.archiveSession).mockImplementation(
      () => new Promise((resolve) => (resolveArchive = resolve)),
    )
    vi.mocked(window.api.listSessions).mockResolvedValue([archived])

    const { result, rerender } = renderHook(
      ({
        agentId,
        selectedSessionId,
      }: {
        agentId: string
        selectedSessionId: string | null
      }) => useSessionArchive({ agentId, selectedSessionId, store }),
      {
        initialProps: {
          agentId: 'yuanxiao',
          selectedSessionId: target.sessionId as string | null,
        },
        wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter>,
      },
    )

    let operation!: Promise<void>
    act(() => {
      operation = result.current.archiveSession(target as AgentSessionSummary)
    })
    rerender({ agentId: 'researcher', selectedSessionId: null })
    resolveArchive({
      status: 'archived',
      affectedSessionIds: ['session-1'],
      affectedActivities: [],
    })
    await act(async () => {
      await operation
    })

    expect(window.api.listSessions).toHaveBeenCalledWith({
      agentId: 'yuanxiao',
      includeArchived: true,
    })
    expect(store.getState().sessionsByAgentId.yuanxiao).toEqual([])
    expect(store.getState().archivedSessionsByAgentId.yuanxiao).toEqual([
      archived,
    ])
  })
})
