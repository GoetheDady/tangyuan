import '@testing-library/jest-dom/vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  createDefaultSessionSummary,
  type AgentSessionSummary,
  type ArchiveSessionRequest,
  type DeleteSessionRequest,
} from '@yuanxiao/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'
import {
  createReadyRuntimeSnapshot,
  createDeferred,
  installDefaultAppApi,
  resetAppTestEnvironment,
} from './app.test-helpers'

function createSession(
  sessionId: string,
  title: string,
  forkedFrom?: { sessionId: string; entryId: string },
  archivedAt?: string,
): AgentSessionSummary {
  return {
    ...createDefaultSessionSummary({
      sessionId,
      title,
      updatedAt: '2026-07-28T00:00:00.000Z',
    }),
    ...(forkedFrom ? { forkedFrom } : {}),
    ...(archivedAt ? { archivedAt } : {}),
  }
}

const PARENT = createSession('parent-session', '父会话')
const CHILD = createSession('child-session', '子会话', {
  sessionId: PARENT.sessionId,
  entryId: 'source-user',
})
const SIBLING = createSession('sibling-session', '兄弟会话')

function installReadyArchiveApi(
  listSessions: (includeArchived: boolean) => AgentSessionSummary[],
): void {
  const readyRuntime = createReadyRuntimeSnapshot({
    providerId: 'anthropic',
    modelId: 'claude-sonnet-4-5',
    maskedValue: 'sk-t...7890',
    profileInitialized: true,
  })
  vi.mocked(window.api.getRuntimeSnapshot).mockResolvedValue(readyRuntime)
  vi.mocked(window.api.refreshRuntime).mockResolvedValue(readyRuntime)
  vi.mocked(window.api.listSessions).mockImplementation(async (request) =>
    listSessions(request?.includeArchived === true),
  )
  vi.mocked(window.api.getTranscript).mockImplementation(async (request) => ({
    agentId: request.agentId,
    sessionId: request.sessionId,
    entries: [],
    updatedAt: '2026-07-28T00:00:00.000Z',
  }))
}

/** hover 会话卡片，点击 ⋯ 按钮，点击下拉菜单项。 */
async function openSessionMenu(
  user: ReturnType<typeof userEvent.setup>,
  sessionTitle: string,
): Promise<void> {
  // 用 findByRole 等待会话列表异步加载完成后再查询
  const item = await screen.findByRole('treeitem', { name: sessionTitle })
  await user.hover(item)
  const menuButton = screen.getByRole('button', {
    name: `${sessionTitle}的操作菜单`,
  })
  await user.click(menuButton)
}

describe('App 会话谱系归档与恢复', () => {
  afterEach(resetAppTestEnvironment)

  beforeEach(() => {
    installDefaultAppApi()
  })

  it('无活动时直接归档目标子树并保留兄弟会话', async () => {
    const user = userEvent.setup()
    let isArchived = false
    installReadyArchiveApi((includeArchived) => {
      if (!isArchived) return [PARENT, CHILD, SIBLING]

      const archivedAt = '2026-07-29T00:00:00.000Z'
      const allSessions = [
        { ...PARENT, archivedAt },
        { ...CHILD, archivedAt },
        SIBLING,
      ]
      return includeArchived ? allSessions : [SIBLING]
    })
    vi.mocked(window.api.archiveSession).mockImplementation(async () => {
      isArchived = true
      return {
        status: 'archived',
        affectedSessionIds: [PARENT.sessionId, CHILD.sessionId],
        affectedActivities: [],
      }
    })
    window.location.hash = '#/chat/yuanxiao/parent-session'

    render(<App />)

    await openSessionMenu(user, '父会话')
    await user.click(await screen.findByRole('menuitem', { name: '归档' }))

    expect(window.api.archiveSession).toHaveBeenCalledWith({
      agentId: 'yuanxiao',
      sessionId: PARENT.sessionId,
      confirmActivityStop: false,
    })
    // 归档当前会话后导航到兄弟会话（sibling 优先级最高）
    await waitFor(() => {
      expect(window.location.hash).toBe('#/chat/yuanxiao/sibling-session')
    })
    expect(
      screen.queryByRole('treeitem', { name: /父会话/ }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('treeitem', { name: /子会话/ }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('treeitem', { name: /兄弟会话/ }),
    ).toBeInTheDocument()
    expect(screen.getByText('已归档')).toBeInTheDocument()
    expect(screen.getByText('父会话')).toBeInTheDocument()
  })

  it('API 竞态返回 confirmation-required 时显示 toast 错误而不弹对话框', async () => {
    // UI 会在谱系有活动任务时置灰按钮；若会话在点击后才开始运行（竞态），
    // API 返回 confirmation-required，此时展示 toast 而不是弹对话框。
    const user = userEvent.setup()
    installReadyArchiveApi(() => [PARENT, CHILD, SIBLING])
    vi.mocked(window.api.archiveSession).mockResolvedValue({
      status: 'confirmation-required',
      affectedSessionIds: [PARENT.sessionId, CHILD.sessionId],
      affectedActivities: [
        { sessionId: PARENT.sessionId, title: PARENT.title, kinds: ['running'] },
      ],
    })
    window.location.hash = '#/chat/yuanxiao/parent-session'

    render(<App />)

    await openSessionMenu(user, '父会话')
    await user.click(await screen.findByRole('menuitem', { name: '归档' }))

    expect(window.api.archiveSession).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(await screen.findByText('有活动任务，请先停止后再归档')).toBeInTheDocument()
    // 路由未跳转，当前会话仍可见
    expect(
      screen.getByRole('heading', { name: PARENT.title }),
    ).toBeInTheDocument()
  })

  it('从已归档区域恢复整棵子树及原有谱系位置', async () => {
    const user = userEvent.setup()
    let isArchived = true
    const archivedAt = '2026-07-29T00:00:00.000Z'
    installReadyArchiveApi((includeArchived) => {
      const allSessions = isArchived
        ? [{ ...PARENT, archivedAt }, { ...CHILD, archivedAt }, SIBLING]
        : [PARENT, CHILD, SIBLING]
      return includeArchived
        ? allSessions
        : allSessions.filter((session) => !session.archivedAt)
    })
    vi.mocked(window.api.recoverSession).mockImplementation(async () => {
      isArchived = false
      return [PARENT, CHILD]
    })
    window.location.hash = '#/chat/yuanxiao/sibling-session'

    render(<App />)

    await user.click(
      await screen.findByRole('button', { name: '恢复「父会话」会话谱系' }),
    )

    expect(window.api.recoverSession).toHaveBeenCalledWith({
      agentId: 'yuanxiao',
      sessionId: PARENT.sessionId,
    })
    expect(
      await screen.findByRole('treeitem', { name: /父会话/ }),
    ).toHaveAttribute('aria-level', '1')
    expect(screen.getByRole('treeitem', { name: /子会话/ })).toHaveAttribute(
      'aria-level',
      '2',
    )

    await user.click(screen.getByRole('treeitem', { name: /子会话/ }))
    expect(await screen.findByText('分叉自「父会话」')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: '查看来源消息' }),
    ).toBeInTheDocument()
  })

  it('归档请求期间切换 Agent 不会用旧 Agent 的结果覆盖当前页面', async () => {
    const user = userEvent.setup()
    const readyRuntime = createReadyRuntimeSnapshot({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      maskedValue: 'sk-t...7890',
      profileInitialized: true,
    })
    readyRuntime.agents.push({
      agentId: 'agent-2',
      displayName: '研究助手',
      status: 'active',
      defaultProviderId: 'anthropic',
      defaultModelId: 'claude-sonnet-4-5',
      homePath: '~/.yuanxiao/agents/agent-2',
      archivedAt: null,
      directoryStatus: 'healthy',
    })
    const agentSession = {
      ...createSession('agent-session', '研究会话'),
      agentId: 'agent-2',
    }
    const archiveResult = createDeferred<{
      status: 'archived'
      affectedSessionIds: string[]
      affectedActivities: []
    }>()
    let isArchived = false

    vi.mocked(window.api.getRuntimeSnapshot).mockResolvedValue(readyRuntime)
    vi.mocked(window.api.refreshRuntime).mockResolvedValue(readyRuntime)
    vi.mocked(window.api.listSessions).mockImplementation(async (request) => {
      if (request?.agentId === 'agent-2') return [agentSession]
      if (!isArchived) return [PARENT]
      return request?.includeArchived
        ? [{ ...PARENT, archivedAt: '2026-07-29T00:00:00.000Z' }]
        : []
    })
    vi.mocked(window.api.getTranscript).mockImplementation(async (request) => ({
      agentId: request.agentId,
      sessionId: request.sessionId,
      entries: [],
      updatedAt: '2026-07-28T00:00:00.000Z',
    }))
    vi.mocked(window.api.archiveSession).mockImplementation(
      async () => archiveResult.promise,
    )
    window.location.hash = '#/chat/yuanxiao/parent-session'

    render(<App />)

    await openSessionMenu(user, '父会话')
    await user.click(await screen.findByRole('menuitem', { name: '归档' }))
    await user.click(
      screen.getByRole('button', { name: '切换到 Agent 研究助手' }),
    )
    expect(
      await screen.findByRole('heading', { name: '研究助手' }),
    ).toBeInTheDocument()

    isArchived = true
    await act(async () => {
      archiveResult.resolve({
        status: 'archived',
        affectedSessionIds: [PARENT.sessionId],
        affectedActivities: [],
      })
      await archiveResult.promise
    })

    await waitFor(() => {
      expect(window.location.hash).toBe('#/chat/agent-2')
    })
    expect(
      screen.getByRole('heading', { name: '研究助手' }),
    ).toBeInTheDocument()
  })

  it('切换 Agent 后不会显示旧 Agent 的归档活动确认', async () => {
    const user = userEvent.setup()
    const readyRuntime = createReadyRuntimeSnapshot({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      maskedValue: 'sk-t...7890',
      profileInitialized: true,
    })
    readyRuntime.agents.push({
      agentId: 'agent-2',
      displayName: '研究助手',
      status: 'active',
      defaultProviderId: 'anthropic',
      defaultModelId: 'claude-sonnet-4-5',
      homePath: '~/.yuanxiao/agents/agent-2',
      archivedAt: null,
      directoryStatus: 'healthy',
    })
    const agentSession = {
      ...createSession('agent-session', '研究会话'),
      agentId: 'agent-2',
    }
    const archiveResult = createDeferred<{
      status: 'confirmation-required'
      affectedSessionIds: string[]
      affectedActivities: [
        {
          sessionId: string
          title: string
          kinds: ['running']
        },
      ]
    }>()

    vi.mocked(window.api.getRuntimeSnapshot).mockResolvedValue(readyRuntime)
    vi.mocked(window.api.refreshRuntime).mockResolvedValue(readyRuntime)
    vi.mocked(window.api.listSessions).mockImplementation(async (request) =>
      request?.agentId === 'agent-2' ? [agentSession] : [PARENT],
    )
    vi.mocked(window.api.getTranscript).mockImplementation(async (request) => ({
      agentId: request.agentId,
      sessionId: request.sessionId,
      entries: [],
      updatedAt: '2026-07-28T00:00:00.000Z',
    }))
    vi.mocked(window.api.archiveSession).mockImplementation(
      async () => archiveResult.promise,
    )
    window.location.hash = '#/chat/yuanxiao/parent-session'

    render(<App />)

    await openSessionMenu(user, '父会话')
    await user.click(await screen.findByRole('menuitem', { name: '归档' }))
    await user.click(
      screen.getByRole('button', { name: '切换到 Agent 研究助手' }),
    )
    expect(
      await screen.findByRole('heading', { name: '研究助手' }),
    ).toBeInTheDocument()

    await act(async () => {
      archiveResult.resolve({
        status: 'confirmation-required',
        affectedSessionIds: [PARENT.sessionId],
        affectedActivities: [
          {
            sessionId: PARENT.sessionId,
            title: PARENT.title,
            kinds: ['running'],
          },
        ],
      })
      await archiveResult.promise
    })

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    expect(window.location.hash).toBe('#/chat/agent-2')
    expect(
      screen.getByRole('heading', { name: '研究助手' }),
    ).toBeInTheDocument()
  })

  it('无活动时确认后永久删除目标子树并保留兄弟会话', async () => {
    const user = userEvent.setup()
    let isDeleted = false
    installReadyArchiveApi(() => {
      if (!isDeleted) return [PARENT, CHILD, SIBLING]
      return [SIBLING]
    })
    vi.mocked(window.api.deleteSession).mockImplementation(async () => {
      isDeleted = true
      return {
        status: 'deleted',
        affectedSessionIds: [PARENT.sessionId, CHILD.sessionId],
        affectedActivities: [],
      }
    })
    window.location.hash = '#/chat/yuanxiao/parent-session'

    render(<App />)

    await openSessionMenu(user, '父会话')
    await user.click(await screen.findByRole('menuitem', { name: '删除' }))

    expect(window.api.deleteSession).not.toHaveBeenCalled()
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(
      '此操作不可撤销',
    )
    await user.click(screen.getByRole('button', { name: '确认永久删除' }))

    expect(window.api.deleteSession).toHaveBeenCalledWith({
      agentId: 'yuanxiao',
      sessionId: PARENT.sessionId,
      confirmActivityStop: false,
    })
    // 删除当前会话后导航到兄弟会话
    await waitFor(() => {
      expect(window.location.hash).toBe('#/chat/yuanxiao/sibling-session')
    })
    expect(
      screen.queryByRole('treeitem', { name: /父会话/ }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('treeitem', { name: /子会话/ }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('treeitem', { name: /兄弟会话/ }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '恢复「父会话」会话谱系' }),
    ).not.toBeInTheDocument()
    expect(await screen.findByText('已永久删除会话谱系')).toBeInTheDocument()
  })

  it('有活动时先预览影响，确认后才永久删除', async () => {
    const user = userEvent.setup()
    let isDeleted = false
    installReadyArchiveApi(() => {
      if (!isDeleted) return [PARENT, CHILD, SIBLING]
      return [SIBLING]
    })
    vi.mocked(window.api.deleteSession).mockImplementation(
      async (request: DeleteSessionRequest) => {
        if (!request.confirmActivityStop) {
          return {
            status: 'confirmation-required',
            affectedSessionIds: [PARENT.sessionId, CHILD.sessionId],
            affectedActivities: [
              {
                sessionId: PARENT.sessionId,
                title: PARENT.title,
                kinds: ['running', 'pending-approval'],
              },
              {
                sessionId: CHILD.sessionId,
                title: CHILD.title,
                kinds: ['queued', 'pending-clarification'],
              },
            ],
          }
        }
        isDeleted = true
        return {
          status: 'deleted',
          affectedSessionIds: [PARENT.sessionId, CHILD.sessionId],
          affectedActivities: [],
        }
      },
    )
    window.location.hash = '#/chat/yuanxiao/parent-session'

    render(<App />)

    await openSessionMenu(user, '父会话')
    await user.click(await screen.findByRole('menuitem', { name: '删除' }))
    expect(window.api.deleteSession).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '确认永久删除' }))
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(
      '父会话：运行中、待审批',
    )
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      '子会话：排队中、待澄清',
    )

    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(window.api.deleteSession).toHaveBeenCalledTimes(1)
    expect(
      screen.getByRole('heading', { name: PARENT.title }),
    ).toBeInTheDocument()

    await openSessionMenu(user, '父会话')
    await user.click(await screen.findByRole('menuitem', { name: '删除' }))
    await user.click(screen.getByRole('button', { name: '确认永久删除' }))
    await user.click(
      await screen.findByRole('button', { name: '停止活动并永久删除' }),
    )

    expect(window.api.deleteSession).toHaveBeenLastCalledWith({
      agentId: 'yuanxiao',
      sessionId: PARENT.sessionId,
      confirmActivityStop: true,
    })
    await waitFor(() => {
      expect(window.location.hash).toBe('#/chat/yuanxiao/sibling-session')
    })
    expect(
      screen.queryByRole('treeitem', { name: /父会话/ }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('treeitem', { name: /子会话/ }),
    ).not.toBeInTheDocument()
  })
})
