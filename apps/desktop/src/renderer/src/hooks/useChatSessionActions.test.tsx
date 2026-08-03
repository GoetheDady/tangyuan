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
    store.getState().replaceAgentSessions('yuanxiao', [createSession('old-1')])
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
    store.getState().replaceAgentSessions('yuanxiao', sessions)
    store.getState().updateComposerDraft('你好')
    const nextTranscript = createTranscript('session-1')
    vi.mocked(window.api.sendMessage).mockResolvedValue(nextTranscript)
    vi.mocked(window.api.listSessions).mockResolvedValue(sessions)

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
    })
  })

  it('retryMessage 复用原始用户消息创建新尝试并刷新', async () => {
    const store = createWorkbenchStore()
    const sessions = [createSession('session-1')]
    store.getState().replaceAgentSessions('yuanxiao', sessions)
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
    store.getState().replaceAgentSessions('yuanxiao', sessions)
    store.getState().openTranscript({
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
    store.getState().replaceAgentSessions('yuanxiao', sessions)
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
    })
  })

  it('handleSessionModelChange 切换模型并更新模型信息', async () => {
    const store = createWorkbenchStore()
    store
      .getState()
      .replaceAgentSessions('yuanxiao', [createSession('session-1')])

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
})
