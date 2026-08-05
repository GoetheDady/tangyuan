import type { AgentSessionSummary } from '@yuanxiao/contracts'
import { createDefaultSessionSummary } from '@yuanxiao/contracts'
import { act, renderHook, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  installDefaultAppApi,
  resetAppTestEnvironment,
} from '../app.test-helpers'
import { createWorkbenchStore } from '../stores/workbench-store'
import { useChatSessionActions } from './useChatSessionActions'

const NOW = '2026-08-03T10:00:00.000Z'

function createSession(sessionId: string): AgentSessionSummary {
  return createDefaultSessionSummary({
    sessionId,
    title: sessionId,
    updatedAt: NOW,
  })
}

function createTranscript(sessionId: string) {
  return {
    agentId: 'yuanxiao',
    sessionId,
    entries: [],
    updatedAt: NOW,
  }
}

function renderActions(
  store = createWorkbenchStore(),
  sessionId = 'session-1',
) {
  return renderHook(
    () =>
      useChatSessionActions({
        store,
        activeAgentId: 'yuanxiao',
        sessionId,
      }),
    {
      wrapper: ({ children }) => (
        <MemoryRouter initialEntries={[`/chat/yuanxiao/${sessionId}`]}>
          {children}
        </MemoryRouter>
      ),
    },
  )
}

describe('useChatSessionActions', () => {
  beforeEach(() => {
    installDefaultAppApi()
  })

  afterEach(resetAppTestEnvironment)

  it('会话列表未加载时一次查询填充活跃与归档分片', async () => {
    const store = createWorkbenchStore()
    const archived = { ...createSession('archived-1'), archivedAt: NOW }
    const active = createSession('session-1')
    vi.mocked(window.api.listSessions).mockResolvedValue([archived, active])

    renderActions(store)

    await waitFor(() => {
      expect(store.getState().sessionsByAgentId.yuanxiao).toEqual([active])
      expect(store.getState().archivedSessionsByAgentId.yuanxiao).toEqual([
        archived,
      ])
    })
    expect(window.api.listSessions).toHaveBeenCalledWith({
      agentId: 'yuanxiao',
      includeArchived: true,
    })
  })

  it('createSession 创建后置顶会话并持久化最后激活会话', async () => {
    const store = createWorkbenchStore()
    store.getState().replaceSessionCatalog('yuanxiao', [createSession('old-1')])
    const created = createSession('new-1')
    vi.mocked(window.api.createSession).mockResolvedValue(created)

    const { result } = renderActions(store)

    await act(async () => {
      await result.current.createSession()
    })

    expect(window.api.createSession).toHaveBeenCalledWith({
      agentId: 'yuanxiao',
      title: '新会话',
    })
    expect(store.getState().sessionsByAgentId.yuanxiao[0].sessionId).toBe(
      'new-1',
    )
    expect(window.api.setLastActiveSession).toHaveBeenCalledWith({
      agentId: 'yuanxiao',
      sessionId: 'new-1',
    })
  })

  it('sendMessage 清空草稿、发送、打开 transcript 并刷新会话列表', async () => {
    const store = createWorkbenchStore()
    const sessions = [createSession('session-1')]
    const archived = { ...createSession('archived-1'), archivedAt: NOW }
    store.getState().replaceSessionCatalog('yuanxiao', [...sessions, archived])
    store.getState().updateComposerDraft('你好')
    const nextTranscript = createTranscript('session-1')
    vi.mocked(window.api.sendMessage).mockResolvedValue(nextTranscript)
    vi.mocked(window.api.listSessions).mockResolvedValue([...sessions, archived])

    const { result } = renderActions(store)

    await act(async () => {
      await result.current.sendMessage()
    })

    expect(window.api.sendMessage).toHaveBeenCalledWith({
      agentId: 'yuanxiao',
      sessionId: 'session-1',
      content: '你好',
    })
    expect(store.getState().composerDraft).toBe('')
    expect(store.getState().transcriptsBySessionId['session-1']).toEqual(
      nextTranscript,
    )
    expect(window.api.listSessions).toHaveBeenCalledWith({
      agentId: 'yuanxiao',
      includeArchived: true,
    })
    expect(store.getState().archivedSessionsByAgentId.yuanxiao).toEqual([
      archived,
    ])
  })

  it('retryMessage 复用原始用户消息创建新尝试并刷新', async () => {
    const store = createWorkbenchStore()
    const sessions = [createSession('session-1')]
    store.getState().replaceSessionCatalog('yuanxiao', sessions)
    const nextTranscript = createTranscript('session-1')
    vi.mocked(window.api.retryMessage).mockResolvedValue(nextTranscript)
    vi.mocked(window.api.listSessions).mockResolvedValue(sessions)

    const { result } = renderActions(store)

    await act(async () => {
      await result.current.retryMessage('user-1')
    })

    expect(window.api.retryMessage).toHaveBeenCalledWith({
      agentId: 'yuanxiao',
      sessionId: 'session-1',
      userMessageId: 'user-1',
    })
    expect(store.getState().transcriptsBySessionId['session-1']).toEqual(
      nextTranscript,
    )
  })

  it('forkSession 用源消息内容填充草稿并跳转到子会话', async () => {
    const store = createWorkbenchStore()
    const sessions = [createSession('session-1')]
    store.getState().replaceSessionCatalog('yuanxiao', sessions)
    store.getState().openSession({
      agentId: 'yuanxiao',
      sessionId: 'session-1',
      entries: [
        {
          kind: 'user-message',
          index: 0,
          messageId: 'user-1',
          content: '分叉我',
          createdAt: NOW,
        },
      ],
      updatedAt: NOW,
    })
    const child = createSession('child-1')
    vi.mocked(window.api.forkSession).mockResolvedValue(child)
    vi.mocked(window.api.listSessions).mockResolvedValue([child])
    vi.mocked(window.api.getTranscript).mockResolvedValue(
      createTranscript('child-1'),
    )

    const { result } = renderActions(store)

    await act(async () => {
      await result.current.forkSession('user-1')
    })

    expect(window.api.forkSession).toHaveBeenCalledWith({
      agentId: 'yuanxiao',
      sessionId: 'session-1',
      entryId: 'user-1',
    })
    expect(store.getState().composerDraft).toBe('分叉我')
    expect(store.getState().transcriptsBySessionId['child-1']).toEqual(
      createTranscript('child-1'),
    )
    expect(window.api.setLastActiveSession).toHaveBeenCalledWith({
      agentId: 'yuanxiao',
      sessionId: 'child-1',
    })
  })

  it('cancelRun 停止生成并刷新会话列表', async () => {
    const store = createWorkbenchStore()
    const sessions = [createSession('session-1')]
    store.getState().replaceSessionCatalog('yuanxiao', sessions)
    vi.mocked(window.api.listSessions).mockResolvedValue(sessions)

    const { result } = renderActions(store)

    await act(async () => {
      await result.current.cancelRun()
    })

    expect(window.api.cancelRun).toHaveBeenCalledWith({
      agentId: 'yuanxiao',
      sessionId: 'session-1',
    })
    expect(window.api.listSessions).toHaveBeenCalledWith({
      agentId: 'yuanxiao',
      includeArchived: true,
    })
  })

  it('handleSessionModelChange 切换模型并更新模型信息', async () => {
    const store = createWorkbenchStore()
    store
      .getState()
      .replaceSessionCatalog('yuanxiao', [createSession('session-1')])

    const { result } = renderActions(store)

    await act(async () => {
      await result.current.handleSessionModelChange(
        'anthropic',
        'claude-sonnet-4-5',
      )
    })

    expect(window.api.setSessionModel).toHaveBeenCalledWith({
      agentId: 'yuanxiao',
      sessionId: 'session-1',
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
    })
    expect(result.current.sessionModelInfo?.modelId).toBe('claude-sonnet-4-5')
  })

  it('连续切换模型时只接纳最后一次写入结果', async () => {
    const store = createWorkbenchStore()
    store
      .getState()
      .replaceSessionCatalog('yuanxiao', [createSession('session-1')])
    let resolveFirst!: (value: Awaited<
      ReturnType<typeof window.api.setSessionModel>
    >) => void
    let resolveSecond!: (value: Awaited<
      ReturnType<typeof window.api.setSessionModel>
    >) => void
    vi.mocked(window.api.setSessionModel)
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveFirst = resolve)),
      )
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveSecond = resolve)),
      )

    const { result } = renderActions(store)
    let firstPromise!: Promise<void>
    let secondPromise!: Promise<void>
    act(() => {
      firstPromise = result.current.handleSessionModelChange('openai', 'old')
      secondPromise = result.current.handleSessionModelChange('openai', 'new')
    })

    resolveSecond({
      providerId: 'openai',
      modelId: 'new',
      displayName: 'New',
      thinkingLevel: null,
      supportedThinkingLevels: [],
      supportsThinking: false,
    })
    await act(async () => {
      await secondPromise
    })
    resolveFirst({
      providerId: 'openai',
      modelId: 'old',
      displayName: 'Old',
      thinkingLevel: null,
      supportedThinkingLevels: [],
      supportsThinking: false,
    })
    await act(async () => {
      await firstPromise
    })

    expect(result.current.sessionModelInfo?.modelId).toBe('new')
    expect(result.current.isSwitchingModel).toBe(false)
  })

  it('快速切换会话时只接纳最后一次模型信息请求', async () => {
    const store = createWorkbenchStore()
    store.getState().replaceSessionCatalog('yuanxiao', [
      createSession('session-1'),
      createSession('session-2'),
    ])
    let resolveFirst!: (value: Awaited<
      ReturnType<typeof window.api.getSessionModelInfo>
    >) => void
    let resolveSecond!: (value: Awaited<
      ReturnType<typeof window.api.getSessionModelInfo>
    >) => void
    vi.mocked(window.api.getSessionModelInfo)
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveFirst = resolve)),
      )
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveSecond = resolve)),
      )

    const { result, rerender } = renderHook(
      ({ sessionId }) =>
        useChatSessionActions({
          store,
          activeAgentId: 'yuanxiao',
          sessionId,
        }),
      {
        initialProps: { sessionId: 'session-1' },
        wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter>,
      },
    )
    rerender({ sessionId: 'session-2' })

    resolveSecond({
      providerId: 'openai',
      modelId: 'new-model',
      displayName: 'New Model',
      thinkingLevel: null,
      supportedThinkingLevels: [],
      supportsThinking: false,
    })
    await waitFor(() => {
      expect(result.current.sessionModelInfo?.modelId).toBe('new-model')
    })

    resolveFirst({
      providerId: 'openai',
      modelId: 'stale-model',
      displayName: 'Stale Model',
      thinkingLevel: null,
      supportedThinkingLevels: [],
      supportsThinking: false,
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.sessionModelInfo?.modelId).toBe('new-model')
    expect(result.current.isLoadingModelInfo).toBe(false)
  })

  it('transcript 随路由会话变化按需读取并持久化最后激活会话', async () => {
    const store = createWorkbenchStore()
    const nextTranscript = createTranscript('session-1')
    vi.mocked(window.api.getTranscript).mockResolvedValue(nextTranscript)

    renderActions(store)

    await waitFor(() => {
      expect(store.getState().transcriptsBySessionId['session-1']).toEqual(
        nextTranscript,
      )
    })
    expect(window.api.setLastActiveSession).toHaveBeenCalledWith({
      agentId: 'yuanxiao',
      sessionId: 'session-1',
    })
  })

  it('transcript 读取挂起时 isLoadingTranscript 为 true，完成后回到 false', async () => {
    const store = createWorkbenchStore()
    let resolveTranscript: (value: ReturnType<typeof createTranscript>) => void =
      () => {}
    vi.mocked(window.api.getTranscript).mockReturnValue(
      new Promise((resolve) => {
        resolveTranscript = resolve
      }),
    )

    const { result } = renderActions(store)

    await waitFor(() => {
      expect(result.current.isLoadingTranscript).toBe(true)
    })

    await act(async () => {
      resolveTranscript(createTranscript('session-1'))
    })

    await waitFor(() => {
      expect(result.current.isLoadingTranscript).toBe(false)
    })
  })

  it('transcript 读取失败后 isLoadingTranscript 回到 false', async () => {
    const store = createWorkbenchStore()
    vi.mocked(window.api.getTranscript).mockRejectedValue(
      new Error('读取失败'),
    )

    const { result } = renderActions(store)

    await waitFor(() => {
      expect(result.current.isLoadingTranscript).toBe(false)
    })
  })
})
