import {
  TANGYUAN_DEFAULT_AGENT_ID,
  type AgentSessionSummary,
  type ListSessionsRequest,
} from '@tangyuan/contracts'
import { describe, expect, it, vi } from 'vitest'
import { createTangyuanRuntimeForTesting } from './tangyuan-runtime'
import {
  createDeferred,
  createRuntimeDriver,
  createSessionDriver,
  createSessionSummary,
  createSnapshot,
} from './tangyuan-runtime.test-helpers'

function createSession(
  sessionId: string,
  forkedFrom?: { sessionId: string; entryId: string },
): AgentSessionSummary {
  return {
    ...createSessionSummary(sessionId),
    title: sessionId,
    ...(forkedFrom ? { forkedFrom } : {}),
  }
}

function createArchiveDriver(sessions: AgentSessionSummary[]) {
  let currentSessions = sessions
  const driver = createSessionDriver(sessions)

  driver.listSessions = vi.fn(async (request: ListSessionsRequest) =>
    currentSessions.filter(
      (session) =>
        session.agentId === request.agentId &&
        (request.includeArchived || session.archivedAt === undefined),
    ),
  )
  const setSessionsArchived = vi.fn(
    async (sessionIds: readonly string[], archivedAt: string | null) => {
      currentSessions = currentSessions.map((session) => {
        if (!sessionIds.includes(session.sessionId)) return session
        if (archivedAt === null) {
          const activeSession = { ...session }
          delete activeSession.archivedAt
          return activeSession
        }
        return { ...session, archivedAt }
      })

      return currentSessions.filter((session) =>
        sessionIds.includes(session.sessionId),
      )
    },
  )

  const addSession = (session: AgentSessionSummary): void => {
    currentSessions = [...currentSessions, session]
  }

  return Object.assign(driver, { setSessionsArchived, addSession })
}

describe('TangyuanRuntime 会话谱系归档与恢复', () => {
  it('只归档目标及全部后代，并整棵恢复到原父子位置', async () => {
    const parent = createSession('parent')
    const child = createSession('child', {
      sessionId: 'parent',
      entryId: 'parent-source',
    })
    const grandchild = createSession('grandchild', {
      sessionId: 'child',
      entryId: 'child-source',
    })
    const sibling = createSession('sibling')
    const sessionDriver = createArchiveDriver([
      parent,
      child,
      grandchild,
      sibling,
    ])
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver: createRuntimeDriver(createSnapshot()),
      sessionDriver,
    })

    await expect(
      runtime.archiveSession({
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: parent.sessionId,
        confirmActivityStop: false,
      }),
    ).resolves.toMatchObject({
      status: 'archived',
      affectedSessionIds: ['parent', 'child', 'grandchild'],
      affectedActivities: [],
    })
    await expect(runtime.listSessions()).resolves.toEqual([sibling])
    await expect(
      runtime.listSessions(TANGYUAN_DEFAULT_AGENT_ID, true),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sessionId: 'parent',
          archivedAt: expect.any(String),
        }),
        expect.objectContaining({
          sessionId: 'child',
          archivedAt: expect.any(String),
        }),
        expect.objectContaining({
          sessionId: 'grandchild',
          archivedAt: expect.any(String),
        }),
        sibling,
      ]),
    )

    const recovered = await runtime.recoverSession({
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: parent.sessionId,
    })
    expect(recovered.map((session) => session.sessionId)).toEqual([
      'parent',
      'child',
      'grandchild',
    ])
    expect(recovered.every((session) => !('archivedAt' in session))).toBe(true)
    await expect(runtime.listSessions()).resolves.toHaveLength(4)
    expect(sessionDriver.setSessionsArchived).toHaveBeenLastCalledWith(
      ['parent', 'child', 'grandchild'],
      null,
    )
  })

  it('未确认时不改变活动子树，确认后等待停止完成再归档', async () => {
    const parent = createSession('parent')
    const child = {
      ...createSession('child', {
        sessionId: 'parent',
        entryId: 'parent-source',
      }),
      state: 'running' as const,
    }
    const grandchild = {
      ...createSession('grandchild', {
        sessionId: 'child',
        entryId: 'child-source',
      }),
      state: 'queued' as const,
    }
    const sessionDriver = createArchiveDriver([parent, child, grandchild])
    const cancelDeferred = createDeferred<void>()
    sessionDriver.cancelRun = vi.fn(async (request) => {
      if (request.sessionId === child.sessionId) {
        await cancelDeferred.promise
      }
    })
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver: createRuntimeDriver(createSnapshot()),
      sessionDriver,
    })
    await runtime.listSessions()
    const gateway = runtime.createToolApprovalGateway()
    const approval = gateway.requestBashApproval({
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: child.sessionId,
      runId: 'run-child',
      command: 'bun run test',
      cwd: '/tmp',
      riskDescription: '测试审批',
    })
    const clarification = gateway.requestClarification({
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: child.sessionId,
      runId: 'run-child',
      question: '继续吗？',
      options: ['继续', '停止'],
      allowCustomAnswer: false,
    })

    await expect(
      runtime.archiveSession({
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: parent.sessionId,
        confirmActivityStop: false,
      }),
    ).resolves.toMatchObject({
      status: 'confirmation-required',
      affectedSessionIds: ['parent', 'child', 'grandchild'],
      affectedActivities: [
        {
          sessionId: 'child',
          kinds: ['running', 'pending-approval', 'pending-clarification'],
        },
        { sessionId: 'grandchild', kinds: ['queued'] },
      ],
    })
    expect(sessionDriver.setSessionsArchived).not.toHaveBeenCalled()
    expect(runtime.getPendingApprovals()).toHaveLength(1)
    expect(runtime.getPendingClarifications()).toHaveLength(1)

    const archivePromise = runtime.archiveSession({
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: parent.sessionId,
      confirmActivityStop: true,
    })
    await vi.waitFor(() => {
      expect(sessionDriver.cancelRun).toHaveBeenCalledWith({
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: child.sessionId,
      })
    })
    expect(sessionDriver.setSessionsArchived).not.toHaveBeenCalled()

    cancelDeferred.resolve()
    await expect(archivePromise).resolves.toMatchObject({ status: 'archived' })
    expect(sessionDriver.setSessionsArchived).toHaveBeenCalledOnce()
    await expect(approval).resolves.toEqual({ approved: false })
    await expect(clarification).resolves.toEqual({ answer: '' })
  })

  it('停止并归档自定义 Agent 的活动会话', async () => {
    const session = {
      ...createSession('custom-session'),
      agentId: 'custom-agent',
      state: 'running' as const,
    }
    const sessionDriver = createArchiveDriver([session])
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver: createRuntimeDriver(createSnapshot()),
      sessionDriver,
    })

    await expect(
      runtime.archiveSession({
        agentId: session.agentId,
        sessionId: session.sessionId,
        confirmActivityStop: true,
      }),
    ).resolves.toMatchObject({
      status: 'archived',
      affectedSessionIds: [session.sessionId],
    })
    expect(sessionDriver.cancelRun).toHaveBeenCalledWith({
      agentId: session.agentId,
      sessionId: session.sessionId,
    })
  })

  it('等待正在启动的运行进入可取消状态后再归档', async () => {
    const session = createSession('session')
    const sessionDriver = createArchiveDriver([session])
    const allowRunStart = createDeferred<void>()
    const allowRunFinish = createDeferred<void>()
    sessionDriver.sendMessage = vi.fn(async () => {
      await allowRunStart.promise
      sessionDriver.emit({
        type: 'attempt-started',
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
        runId: 'run-1',
        occurredAt: '2026-07-29T00:00:00.000Z',
      })
      await allowRunFinish.promise
    })
    sessionDriver.cancelRun = vi.fn(async () => {
      sessionDriver.emit({
        type: 'turn-cancelled',
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
        runId: 'run-1',
        occurredAt: '2026-07-29T00:00:01.000Z',
      })
      allowRunFinish.resolve()
    })
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver: createRuntimeDriver(
        createSnapshot({
          providerId: 'anthropic',
          modelId: 'claude-sonnet-4-5',
          maskedValue: 'sk-t...7890',
        }),
      ),
      sessionDriver,
    })

    const sendPromise = runtime.sendMessage({
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: session.sessionId,
      content: '开始运行',
    })
    await vi.waitFor(() => {
      expect(sessionDriver.sendMessage).toHaveBeenCalledOnce()
    })

    const archivePromise = runtime.archiveSession({
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: session.sessionId,
      confirmActivityStop: true,
    })
    await Promise.resolve()
    expect(sessionDriver.setSessionsArchived).not.toHaveBeenCalled()

    allowRunStart.resolve()
    await expect(archivePromise).resolves.toMatchObject({ status: 'archived' })
    await sendPromise
    expect(sessionDriver.cancelRun).toHaveBeenCalledWith({
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: session.sessionId,
    })
  })

  it('归档后不允许通过运行时 transcript 缓存打开会话', async () => {
    const session = createSession('session')
    const sessionDriver = createArchiveDriver([session])
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver: createRuntimeDriver(createSnapshot()),
      sessionDriver,
    })
    sessionDriver.emit({
      type: 'message-appended',
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      message: {
        messageId: 'message-1',
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
        role: 'user',
        content: '缓存内容',
        createdAt: '2026-07-29T00:00:00.000Z',
      },
      occurredAt: '2026-07-29T00:00:00.000Z',
    })
    await expect(
      runtime.getTranscript({
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
      }),
    ).resolves.toMatchObject({ sessionId: session.sessionId })

    await runtime.archiveSession({
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: session.sessionId,
      confirmActivityStop: false,
    })

    await expect(
      runtime.getTranscript({
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
      }),
    ).rejects.toThrow(/找不到|已归档/)
  })

  it('等待并发分叉落地后归档新后代，同时允许兄弟会话继续运行', async () => {
    const parent = createSession('parent')
    const sibling = createSession('sibling')
    const child = createSession('child', {
      sessionId: parent.sessionId,
      entryId: 'parent-source',
    })
    const sessionDriver = createArchiveDriver([parent, sibling])
    const allowFork = createDeferred<void>()
    sessionDriver.forkSession = vi.fn(async () => {
      await allowFork.promise
      sessionDriver.addSession(child)
      return child
    })
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver: createRuntimeDriver(
        createSnapshot({
          providerId: 'anthropic',
          modelId: 'claude-sonnet-4-5',
          maskedValue: 'sk-t...7890',
        }),
      ),
      sessionDriver,
    })

    const forkPromise = runtime.forkSession({
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: parent.sessionId,
      entryId: 'parent-source',
    })
    await vi.waitFor(() => {
      expect(sessionDriver.forkSession).toHaveBeenCalledOnce()
    })
    const archivePromise = runtime.archiveSession({
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: parent.sessionId,
      confirmActivityStop: false,
    })

    await expect(
      runtime.sendMessage({
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: sibling.sessionId,
        content: '兄弟会话继续运行',
      }),
    ).resolves.toMatchObject({ sessionId: sibling.sessionId })
    expect(sessionDriver.setSessionsArchived).not.toHaveBeenCalled()

    allowFork.resolve()
    await forkPromise
    await expect(archivePromise).resolves.toMatchObject({
      status: 'archived',
      affectedSessionIds: [parent.sessionId, child.sessionId],
    })
    expect(sessionDriver.setSessionsArchived).toHaveBeenCalledWith(
      [parent.sessionId, child.sessionId],
      expect.any(String),
    )
  })

  it('归档排队会话后不会突破全局并发上限启动兄弟会话', async () => {
    const activeSessions = Array.from({ length: 4 }, (_, index) =>
      createSession(`active-${index + 1}`),
    )
    const target = createSession('target')
    const sibling = createSession('sibling')
    const sessionDriver = createArchiveDriver([
      ...activeSessions,
      target,
      sibling,
    ])
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver: createRuntimeDriver(
        createSnapshot({
          providerId: 'anthropic',
          modelId: 'claude-sonnet-4-5',
          maskedValue: 'sk-t...7890',
        }),
      ),
      sessionDriver,
    })
    await runtime.listSessions()
    for (const session of activeSessions) {
      sessionDriver.emit({
        type: 'attempt-started',
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
        runId: `run-${session.sessionId}`,
        occurredAt: '2026-07-29T00:00:00.000Z',
      })
    }

    void runtime.sendMessage({
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: target.sessionId,
      content: '目标排队消息',
    })
    void runtime.sendMessage({
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: sibling.sessionId,
      content: '兄弟排队消息',
    })
    await vi.waitFor(async () => {
      await expect(runtime.listSessions()).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sessionId: target.sessionId,
            state: 'queued',
          }),
          expect.objectContaining({
            sessionId: sibling.sessionId,
            state: 'queued',
          }),
        ]),
      )
    })

    await runtime.archiveSession({
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: target.sessionId,
      confirmActivityStop: true,
    })

    expect(sessionDriver.sendMessage).not.toHaveBeenCalled()
  })
})

describe('TangyuanRuntime 会话谱系永久删除', () => {
  it('确认后级联删除目标及全部后代，不影响兄弟', async () => {
    const parent = createSession('parent')
    const child = createSession('child', {
      sessionId: 'parent',
      entryId: 'parent-source',
    })
    const grandchild = createSession('grandchild', {
      sessionId: 'child',
      entryId: 'child-source',
    })
    const sibling = createSession('sibling')
    const sessionDriver = createArchiveDriver([
      parent,
      child,
      grandchild,
      sibling,
    ])
    sessionDriver.deleteSessions = vi.fn(async () => {
      // 模拟删除后会话不再出现在列表中
    })
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver: createRuntimeDriver(createSnapshot()),
      sessionDriver,
    })

    await expect(
      runtime.deleteSession({
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: parent.sessionId,
        confirmActivityStop: false,
      }),
    ).resolves.toMatchObject({
      status: 'deleted',
      affectedSessionIds: ['parent', 'child', 'grandchild'],
      affectedActivities: [],
    })
    expect(sessionDriver.deleteSessions).toHaveBeenCalledWith([
      'parent',
      'child',
      'grandchild',
    ])
  })

  it('未确认时返回 confirmation-required', async () => {
    const parent = createSession('parent')
    const child = {
      ...createSession('child', {
        sessionId: 'parent',
        entryId: 'parent-source',
      }),
      state: 'running' as const,
    }
    const sessionDriver = createArchiveDriver([parent, child])
    sessionDriver.deleteSessions = vi.fn()
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver: createRuntimeDriver(createSnapshot()),
      sessionDriver,
    })

    await expect(
      runtime.deleteSession({
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: parent.sessionId,
        confirmActivityStop: false,
      }),
    ).resolves.toMatchObject({
      status: 'confirmation-required',
      affectedSessionIds: ['parent', 'child'],
      affectedActivities: [{ sessionId: 'child', kinds: ['running'] }],
    })
    expect(sessionDriver.deleteSessions).not.toHaveBeenCalled()
  })

  it('确认后停止活动再删除', async () => {
    const session = {
      ...createSession('session'),
      state: 'running' as const,
    }
    const sessionDriver = createArchiveDriver([session])
    sessionDriver.deleteSessions = vi.fn()
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver: createRuntimeDriver(createSnapshot()),
      sessionDriver,
    })

    await expect(
      runtime.deleteSession({
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
        confirmActivityStop: true,
      }),
    ).resolves.toMatchObject({ status: 'deleted' })
    expect(sessionDriver.cancelRun).toHaveBeenCalledWith({
      agentId: session.agentId,
      sessionId: session.sessionId,
    })
    expect(sessionDriver.deleteSessions).toHaveBeenCalled()
  })

  it('删除后不会留下可打开的后代', async () => {
    const parent = createSession('parent')
    const child = createSession('child', {
      sessionId: 'parent',
      entryId: 'parent-source',
    })
    const sessionDriver = createArchiveDriver([parent, child])
    let deleted = false
    sessionDriver.deleteSessions = vi.fn(async () => {
      deleted = true
    })
    sessionDriver.listSessions = vi.fn(async (request) => {
      if (deleted) return []
      return [parent, child].filter(
        (s) =>
          s.agentId === request.agentId &&
          (request.includeArchived || s.archivedAt === undefined),
      )
    })
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver: createRuntimeDriver(createSnapshot()),
      sessionDriver,
    })

    await runtime.deleteSession({
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: parent.sessionId,
      confirmActivityStop: false,
    })

    await expect(
      runtime.getTranscript({
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: child.sessionId,
      }),
    ).rejects.toThrow(/找不到会话/)
  })
})

describe('TangyuanRuntime 祖先谱系完整性检查', () => {
  it('祖先 transcript 不可读时后代标记为 lineageUnavailable', async () => {
    const grandparent = createSession('grandparent')
    const parent = createSession('parent', {
      sessionId: 'grandparent',
      entryId: 'gp-source',
    })
    const child = createSession('child', {
      sessionId: 'parent',
      entryId: 'parent-source',
    })
    const sibling = createSession('sibling')
    const sessionDriver = createArchiveDriver([
      grandparent,
      parent,
      child,
      sibling,
    ])
    // 让 grandparent 的 transcript 读取失败
    const originalGetTranscript = sessionDriver.getTranscript
    sessionDriver.getTranscript = vi.fn(async (request) => {
      if (request.sessionId === 'grandparent') {
        throw new Error('文件损坏')
      }
      return originalGetTranscript(request)
    })
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver: createRuntimeDriver(createSnapshot()),
      sessionDriver,
    })

    const sessions = await runtime.listSessions()
    const childResult = sessions.find((s) => s.sessionId === 'child')
    const parentResult = sessions.find((s) => s.sessionId === 'parent')
    const siblingResult = sessions.find((s) => s.sessionId === 'sibling')

    expect(childResult?.lineageUnavailable).toBe(true)
    expect(parentResult?.lineageUnavailable).toBe(true)
    // grandparent 和 sibling 不受影响
    expect(siblingResult?.lineageUnavailable).toBeUndefined()
    const gpResult = sessions.find((s) => s.sessionId === 'grandparent')
    expect(gpResult?.lineageUnavailable).toBeUndefined()
  })

  it('谱系不可用会话拒绝 sendMessage', async () => {
    const parent = createSession('parent')
    const child = createSession('child', {
      sessionId: 'parent',
      entryId: 'parent-source',
    })
    const sessionDriver = createArchiveDriver([parent, child])
    sessionDriver.getTranscript = vi.fn(async (request) => {
      if (request.sessionId === 'parent') {
        throw new Error('文件损坏')
      }
      return {
        sessionId: request.sessionId,
        agentId: request.agentId,
        entries: [],
        updatedAt: '2026-07-29T00:00:00.000Z',
      }
    })
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver: createRuntimeDriver(
        createSnapshot({
          providerId: 'anthropic',
          modelId: 'claude-sonnet-4-5',
          maskedValue: 'sk-t...7890',
        }),
      ),
      sessionDriver,
    })

    // 先列出会话以设置 lineageUnavailable
    await runtime.listSessions()

    await expect(
      runtime.sendMessage({
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: child.sessionId,
        content: 'test',
      }),
    ).rejects.toThrow(/祖先.*丢失或损坏/)
  })

  it('谱系不可用会话拒绝 getTranscript', async () => {
    const parent = createSession('parent')
    const child = createSession('child', {
      sessionId: 'parent',
      entryId: 'parent-source',
    })
    const sessionDriver = createArchiveDriver([parent, child])
    sessionDriver.getTranscript = vi.fn(async (request) => {
      if (request.sessionId === 'parent') {
        throw new Error('文件损坏')
      }
      return {
        sessionId: request.sessionId,
        agentId: request.agentId,
        entries: [],
        updatedAt: '2026-07-29T00:00:00.000Z',
      }
    })
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver: createRuntimeDriver(createSnapshot()),
      sessionDriver,
    })

    await runtime.listSessions()

    await expect(
      runtime.getTranscript({
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: child.sessionId,
      }),
    ).rejects.toThrow(/祖先.*丢失或损坏/)
  })

  it('父链恢复后后代恢复可用', async () => {
    const parent = createSession('parent')
    const child = createSession('child', {
      sessionId: 'parent',
      entryId: 'parent-source',
    })
    const sessionDriver = createArchiveDriver([parent, child])
    let parentBroken = true
    sessionDriver.getTranscript = vi.fn(async (request) => {
      if (request.sessionId === 'parent' && parentBroken) {
        throw new Error('文件损坏')
      }
      return {
        sessionId: request.sessionId,
        agentId: request.agentId,
        entries: [],
        updatedAt: '2026-07-29T00:00:00.000Z',
      }
    })
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver: createRuntimeDriver(createSnapshot()),
      sessionDriver,
    })

    // 第一次：父链损坏，后代不可用
    const brokenSessions = await runtime.listSessions()
    const brokenChild = brokenSessions.find((s) => s.sessionId === 'child')
    expect(brokenChild?.lineageUnavailable).toBe(true)

    // 恢复父链
    parentBroken = false

    // 第二次：父链恢复，后代可用
    const restoredSessions = await runtime.listSessions()
    const restoredChild = restoredSessions.find((s) => s.sessionId === 'child')
    expect(restoredChild?.lineageUnavailable).toBeUndefined()
  })

  it('无分叉来源的会话不检查谱系', async () => {
    const session = createSession('root')
    const sessionDriver = createArchiveDriver([session])
    // getTranscript 不应被调用（根会话无祖先）
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver: createRuntimeDriver(createSnapshot()),
      sessionDriver,
    })

    const sessions = await runtime.listSessions()
    const root = sessions.find((s) => s.sessionId === 'root')
    expect(root?.lineageUnavailable).toBeUndefined()
    // getTranscript 不应因 lineage 检查而被调用
    expect(sessionDriver.getTranscript).not.toHaveBeenCalled()
  })
})
