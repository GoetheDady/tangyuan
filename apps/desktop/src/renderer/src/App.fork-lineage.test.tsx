import '@testing-library/jest-dom/vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
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

/** 创建带分叉来源的会话摘要。 */
function createSession(
  sessionId: string,
  title: string,
  forkedFrom?: { sessionId: string; entryId: string },
): AgentSessionSummary {
  return {
    ...createDefaultSessionSummary({
      sessionId,
      title,
      updatedAt: '2026-07-28T00:00:00.000Z',
    }),
    ...(forkedFrom ? { forkedFrom } : {}),
  }
}

const PARENT = createSession('parent-session', '父会话')
const CHILD = createSession('child-session', '子会话', {
  sessionId: 'parent-session',
  entryId: 'source-user',
})
const GRANDCHILD = createSession('grandchild-session', '孙会话', {
  sessionId: 'child-session',
  entryId: 'child-source-user',
})

/**
 * 安装三层谱系的会话与 transcript mock。
 */
function installLineageApi(): void {
  const readyRuntime = createReadyRuntimeSnapshot({
    providerId: 'anthropic',
    modelId: 'claude-sonnet-4-5',
    maskedValue: 'sk-t...7890',
    profileInitialized: true,
  })
  vi.mocked(window.api.getRuntimeSnapshot).mockResolvedValue(readyRuntime)
  vi.mocked(window.api.refreshRuntime).mockResolvedValue(readyRuntime)
  vi.mocked(window.api.getLastActiveSession).mockResolvedValue({
    agentId: 'yuanxiao',
    sessionId: 'parent-session',
    updatedAt: '2026-07-28T00:02:00.000Z',
  })
  vi.mocked(window.api.listSessions).mockResolvedValue([
    PARENT,
    CHILD,
    GRANDCHILD,
  ])
  vi.mocked(window.api.getTranscript).mockImplementation(async (request) => {
    const entriesBySession: Record<string, unknown[]> = {
      'parent-session': [
        {
          kind: 'user-message',
          index: 0,
          messageId: 'first-user',
          content: '父会话第一条',
          createdAt: '2026-07-28T00:00:00.000Z',
        },
        {
          kind: 'agent-reply',
          index: 1,
          messageId: 'first-agent',
          content: '父会话回答',
          createdAt: '2026-07-28T00:00:10.000Z',
          attempt: null,
          turns: [],
        },
        {
          kind: 'user-message',
          index: 2,
          messageId: 'source-user',
          content: '父会话的来源消息',
          createdAt: '2026-07-28T00:00:20.000Z',
        },
      ],
      'child-session': [
        {
          kind: 'user-message',
          index: 0,
          messageId: 'child-source-user',
          content: '子会话的来源消息',
          createdAt: '2026-07-28T00:01:00.000Z',
        },
      ],
      'grandchild-session': [
        {
          kind: 'user-message',
          index: 0,
          messageId: 'grandchild-user',
          content: '孙会话的消息',
          createdAt: '2026-07-28T00:02:00.000Z',
        },
      ],
    }

    return {
      sessionId: request.sessionId,
      agentId: 'yuanxiao',
      entries: entriesBySession[request.sessionId] ?? [],
      updatedAt: '2026-07-28T00:02:00.000Z',
    } as never
  })
}

describe('App 递归会话谱系与分叉来源提示', () => {
  afterEach(resetAppTestEnvironment)
  beforeEach(() => {
    installDefaultAppApi()
    installLineageApi()
  })

  it('侧边栏按任意深度展示分叉谱系', async () => {
    window.location.hash = '#/chat/yuanxiao/parent-session'

    render(<App />)

    expect(
      await screen.findByRole('treeitem', { name: /父会话/ }),
    ).toHaveAttribute('aria-level', '1')
    expect(screen.getByRole('treeitem', { name: /子会话/ })).toHaveAttribute(
      'aria-level',
      '2',
    )
    expect(screen.getByRole('treeitem', { name: /孙会话/ })).toHaveAttribute(
      'aria-level',
      '3',
    )
  })

  it('分叉会话顶部展示来源提示，点击后跳回父会话的来源消息', async () => {
    const user = userEvent.setup()
    window.location.hash = '#/chat/yuanxiao/child-session'

    render(<App />)

    expect(await screen.findByText('分叉自「父会话」')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '查看来源消息' }))

    await waitFor(() => {
      expect(window.location.hash).toBe('#/chat/yuanxiao/parent-session')
    })
    expect(
      await screen.findByRole('heading', { name: '父会话' }),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByTestId('fork-source-message')).toHaveTextContent(
        '父会话的来源消息',
      )
    })
    expect(window.api.setLastActiveSession).toHaveBeenCalledWith({
      agentId: 'yuanxiao',
      sessionId: 'parent-session',
    })
  })

  it('从孙会话可逐级跳回上一层的来源消息', async () => {
    const user = userEvent.setup()
    window.location.hash = '#/chat/yuanxiao/grandchild-session'

    render(<App />)

    expect(await screen.findByText('分叉自「子会话」')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '查看来源消息' }))

    await waitFor(() => {
      expect(window.location.hash).toBe('#/chat/yuanxiao/child-session')
    })
    await waitFor(() => {
      expect(screen.getByTestId('fork-source-message')).toHaveTextContent(
        '子会话的来源消息',
      )
    })
    expect(await screen.findByText('分叉自「父会话」')).toBeInTheDocument()
  })

  it('父会话已不可用时来源提示降级且不提供跳转', async () => {
    const orphan = createSession('orphan-session', '孤立分叉', {
      sessionId: 'missing-session',
      entryId: 'missing-entry',
    })
    vi.mocked(window.api.listSessions).mockResolvedValue([orphan])
    window.location.hash = '#/chat/yuanxiao/orphan-session'

    render(<App />)

    expect(await screen.findByText('分叉自已不可用的会话')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '查看来源消息' }),
    ).not.toBeInTheDocument()
    // 父会话缺失的分叉仍要在侧边栏可见，作为根节点展示。
    expect(screen.getByRole('treeitem', { name: /孤立分叉/ })).toHaveAttribute(
      'aria-level',
      '1',
    )
  })

  it('快速切换父会话与分叉时只保留最后一次选择', async () => {
    const user = userEvent.setup()
    window.location.hash = '#/chat/yuanxiao/parent-session'

    render(<App />)

    expect(
      await screen.findByRole('heading', { name: '父会话' }),
    ).toBeInTheDocument()
    const parentTranscript = createDeferred<TranscriptSnapshot>()
    vi.mocked(window.api.getTranscript).mockImplementation(async (request) => {
      if (request.sessionId === PARENT.sessionId) {
        return parentTranscript.promise
      }

      return {
        agentId: request.agentId,
        sessionId: request.sessionId,
        entries: [
          {
            kind: 'user-message',
            index: 0,
            messageId: 'latest-child-message',
            content: '最后选择的子会话内容',
            createdAt: '2026-07-28T00:03:00.000Z',
          },
        ],
        updatedAt: '2026-07-28T00:03:00.000Z',
      }
    })
    vi.mocked(window.api.setLastActiveSession).mockClear()

    await user.click(screen.getByRole('treeitem', { name: /父会话/ }))
    await user.click(screen.getByRole('treeitem', { name: /子会话/ }))

    await waitFor(() => {
      expect(window.api.setLastActiveSession).toHaveBeenLastCalledWith({
        agentId: 'yuanxiao',
        sessionId: 'child-session',
      })
    })
    expect(await screen.findByText('最后选择的子会话内容')).toBeInTheDocument()

    await act(async () => {
      parentTranscript.resolve({
        agentId: 'yuanxiao',
        sessionId: 'parent-session',
        entries: [
          {
            kind: 'user-message',
            index: 0,
            messageId: 'stale-parent-message',
            content: '过期返回的父会话内容',
            createdAt: '2026-07-28T00:04:00.000Z',
          },
        ],
        updatedAt: '2026-07-28T00:04:00.000Z',
      })
      await parentTranscript.promise
    })

    expect(screen.getByText('最后选择的子会话内容')).toBeInTheDocument()
    expect(screen.queryByText('过期返回的父会话内容')).not.toBeInTheDocument()
    expect(window.api.setLastActiveSession).toHaveBeenLastCalledWith({
      agentId: 'yuanxiao',
      sessionId: 'child-session',
    })
    expect(window.location.hash).toBe('#/chat/yuanxiao/child-session')
  })

  it('较早会话的持久化延迟时最后激活记录仍以最后选择为准', async () => {
    const user = userEvent.setup()
    const releaseParentWrite = createDeferred<void>()
    let persistedSessionId: string | null = null
    window.location.hash = '#/chat/yuanxiao/parent-session'

    render(<App />)

    expect(
      await screen.findByRole('heading', { name: '父会话' }),
    ).toBeInTheDocument()
    vi.mocked(window.api.setLastActiveSession).mockImplementation(
      async (request) => {
        if (request.sessionId === PARENT.sessionId) {
          await releaseParentWrite.promise
        }
        persistedSessionId = request.sessionId
        return {
          ...request,
          updatedAt: '2026-07-28T00:05:00.000Z',
        }
      },
    )

    await user.click(screen.getByRole('treeitem', { name: /父会话/ }))
    await waitFor(() => {
      expect(window.api.setLastActiveSession).toHaveBeenCalledWith({
        agentId: 'yuanxiao',
        sessionId: 'parent-session',
      })
    })
    await user.click(screen.getByRole('treeitem', { name: /子会话/ }))
    expect(
      await screen.findByRole('heading', { name: '子会话' }),
    ).toBeInTheDocument()

    releaseParentWrite.resolve()

    await waitFor(() => {
      expect(window.api.setLastActiveSession).toHaveBeenCalledTimes(2)
      expect(persistedSessionId).toBe('child-session')
    })
  })
})
