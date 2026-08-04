import {
  YUANXIAO_DEFAULT_AGENT_ID,
  type RuntimeConfiguration,
} from '@yuanxiao/contracts'
import { describe, expect, it, vi } from 'vitest'
import { createYuanxiaoRuntimeForTesting } from './yuanxiao-runtime'
import {
  createDeferred,
  createRuntimeDriver,
  createSessionDriver,
  createSessionSummary,
  createSnapshot,
} from './yuanxiao-runtime.test-helpers'

describe('YuanxiaoRuntime', () => {
  it('coordinates runtime snapshot requests through the runtime driver', async () => {
    const snapshot = createSnapshot()
    const runtimeDriver = createRuntimeDriver(snapshot)
    const sessionDriver = createSessionDriver([])
    const runtime = createYuanxiaoRuntimeForTesting({
      configuration: runtimeDriver,
      sessions: sessionDriver,
      agents: sessionDriver,
      profiles: sessionDriver,
      skills: sessionDriver,
    })

    await expect(runtime.getRuntimeSnapshot()).resolves.toEqual(snapshot)
    expect(runtimeDriver.getSnapshot).toHaveBeenCalledOnce()
  })
  it('creates sessions through the session driver and refreshes the cached list', async () => {
    const session = createSessionSummary('session-1')
    const runtimeDriver = createRuntimeDriver(
      createSnapshot({
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        maskedValue: 'sk-t...7890',
      }),
    )
    const sessionDriver = createSessionDriver([session])
    const runtime = createYuanxiaoRuntimeForTesting({
      configuration: runtimeDriver,
      sessions: sessionDriver,
      agents: sessionDriver,
      profiles: sessionDriver,
      skills: sessionDriver,
    })

    await expect(
      runtime.createSession({
        agentId: YUANXIAO_DEFAULT_AGENT_ID,
        title: '新会话',
      }),
    ).resolves.toEqual(session)
    await expect(runtime.listSessions()).resolves.toEqual([session])
    expect(sessionDriver.createSession).toHaveBeenCalledWith({
      agentId: YUANXIAO_DEFAULT_AGENT_ID,
      title: '新会话',
    })
    expect(sessionDriver.listSessions).toHaveBeenCalledWith({
      agentId: YUANXIAO_DEFAULT_AGENT_ID,
    })
  })
  it('切换 Agent 列表后仍能取消其他 Agent 的活动会话', async () => {
    const runningSession = createSessionSummary('agent-a-session', {
      agentId: 'agent-a',
      state: 'running',
    })
    const idleSession = createSessionSummary('agent-b-session', {
      agentId: 'agent-b',
      state: 'idle',
    })
    const runtimeDriver = createRuntimeDriver(createSnapshot())
    const sessionDriver = createSessionDriver([])
    sessionDriver.listSessions = vi.fn(async ({ agentId }) =>
      agentId === 'agent-a' ? [runningSession] : [idleSession],
    )
    const runtime = createYuanxiaoRuntimeForTesting({
      configuration: runtimeDriver,
      sessions: sessionDriver,
      agents: sessionDriver,
      profiles: sessionDriver,
      skills: sessionDriver,
    })

    await runtime.listSessions('agent-a')
    await runtime.listSessions('agent-b')
    await runtime.cancelAllActiveRuns()

    expect(sessionDriver.cancelRun).toHaveBeenCalledWith({
      agentId: 'agent-a',
      sessionId: 'agent-a-session',
    })
  })
  it('sends messages through the session driver only when runtime is ready', async () => {
    const session = createSessionSummary('session-1')
    const runtimeDriver = createRuntimeDriver(
      createSnapshot({
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        maskedValue: 'sk-t...7890',
      }),
    )
    const sessionDriver = createSessionDriver([session])
    sessionDriver.messages.set(session.sessionId, {
      sessionId: session.sessionId,
      agentId: YUANXIAO_DEFAULT_AGENT_ID,
      entries: [
        {
          kind: 'user-message',
          index: 0,
          messageId: 'message-1',
          content: '你好',
          createdAt: '2026-07-08T00:00:00.000Z',
        },
      ],
      updatedAt: '2026-07-08T00:00:00.000Z',
    })
    const runtime = createYuanxiaoRuntimeForTesting({
      configuration: runtimeDriver,
      sessions: sessionDriver,
      agents: sessionDriver,
      profiles: sessionDriver,
      skills: sessionDriver,
    })

    await expect(
      runtime.sendMessage({
        agentId: YUANXIAO_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
        content: '你好',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        entries: [
          expect.objectContaining({ kind: 'user-message', content: '你好' }),
        ],
      }),
    )

    expect(sessionDriver.sendMessage).toHaveBeenCalledWith({
      agentId: YUANXIAO_DEFAULT_AGENT_ID,
      sessionId: session.sessionId,
      content: '你好',
    })
  })
  it('updates conversation messages from streaming success events', async () => {
    const session = createSessionSummary('session-1')
    const runtimeDriver = createRuntimeDriver(
      createSnapshot({
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        maskedValue: 'sk-t...7890',
      }),
    )
    const sessionDriver = createSessionDriver([session])
    sessionDriver.sendMessage = vi.fn(async () => {
      sessionDriver.emit({
        type: 'message-appended',
        agentId: YUANXIAO_DEFAULT_AGENT_ID,
        message: {
          messageId: 'message-agent-1',
          agentId: YUANXIAO_DEFAULT_AGENT_ID,
          sessionId: session.sessionId,
          role: 'agent',
          content: '',
          createdAt: '2026-07-08T00:00:01.000Z',
        },
        occurredAt: '2026-07-08T00:00:01.000Z',
      })
      sessionDriver.emit({
        type: 'attempt-started',
        agentId: YUANXIAO_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
        runId: 'run-1',
        occurredAt: '2026-07-08T00:00:01.000Z',
      })
      sessionDriver.emit({
        type: 'message-delta',
        agentId: YUANXIAO_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
        runId: 'run-1',
        messageId: 'message-agent-1',
        delta: '你',
        occurredAt: '2026-07-08T00:00:02.000Z',
      })
      sessionDriver.emit({
        type: 'message-delta',
        agentId: YUANXIAO_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
        runId: 'run-1',
        messageId: 'message-agent-1',
        delta: '好',
        occurredAt: '2026-07-08T00:00:03.000Z',
      })
      sessionDriver.emit({
        type: 'message-completed',
        agentId: YUANXIAO_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
        runId: 'run-1',
        message: {
          messageId: 'message-agent-1',
          agentId: YUANXIAO_DEFAULT_AGENT_ID,
          sessionId: session.sessionId,
          role: 'agent',
          content: '你好',
          createdAt: '2026-07-08T00:00:02.000Z',
        },
        occurredAt: '2026-07-08T00:00:04.000Z',
      })
      sessionDriver.emit({
        type: 'run-state-changed',
        agentId: YUANXIAO_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
        state: 'completed',
        occurredAt: '2026-07-08T00:00:05.000Z',
      })
    })
    const runtime = createYuanxiaoRuntimeForTesting({
      configuration: runtimeDriver,
      sessions: sessionDriver,
      agents: sessionDriver,
      profiles: sessionDriver,
      skills: sessionDriver,
    })

    await expect(
      runtime.sendMessage({
        agentId: YUANXIAO_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
        content: '你好',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        entries: [
          expect.objectContaining({ kind: 'agent-reply', content: '你好' }),
        ],
      }),
    )
    await expect(runtime.listSessions()).resolves.toEqual([
      expect.objectContaining({
        sessionId: session.sessionId,
        state: 'completed',
      }),
    ])
  })
  it('does not expose activity and error events as system messages', async () => {
    const session = createSessionSummary('session-1')
    const runtimeDriver = createRuntimeDriver(
      createSnapshot({
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        maskedValue: 'sk-t...7890',
      }),
    )
    const sessionDriver = createSessionDriver([session])
    sessionDriver.sendMessage = vi.fn(async () => {
      sessionDriver.emit({
        type: 'attempt-started',
        agentId: YUANXIAO_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
        runId: 'run-1',
        occurredAt: '2026-07-08T00:00:01.000Z',
      })
      sessionDriver.emit({
        type: 'activity-updated',
        agentId: YUANXIAO_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
        runId: 'run-1',
        activity: {
          kind: 'thinking',
          state: 'running',
          label: '思考中',
        },
        occurredAt: '2026-07-08T00:00:02.000Z',
      })
      sessionDriver.emit({
        type: 'activity-updated',
        agentId: YUANXIAO_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
        runId: 'run-1',
        activity: {
          kind: 'tool',
          state: 'failed',
          label: '工具失败',
        },
        occurredAt: '2026-07-08T00:00:03.000Z',
      })
      sessionDriver.emit({
        type: 'turn-failed',
        agentId: YUANXIAO_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
        runId: 'run-1',
        error: {
          code: 'unknown',
          message: '模型服务暂时不可用',
          recoverable: true,
        },
        occurredAt: '2026-07-08T00:00:04.000Z',
      })
      throw new Error('模型服务暂时不可用')
    })
    const runtime = createYuanxiaoRuntimeForTesting({
      configuration: runtimeDriver,
      sessions: sessionDriver,
      agents: sessionDriver,
      profiles: sessionDriver,
      skills: sessionDriver,
    })

    await expect(
      runtime.sendMessage({
        agentId: YUANXIAO_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
        content: '你好',
      }),
    ).rejects.toThrow('模型服务暂时不可用')
    await expect(
      runtime.getTranscript({
        agentId: YUANXIAO_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
      }),
    ).resolves.toEqual(expect.objectContaining({ entries: [] }))
  })
  it('keeps partial content and marks the session cancelled after cancellation', async () => {
    const session = createSessionSummary('session-1')
    const runtimeDriver = createRuntimeDriver(
      createSnapshot({
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        maskedValue: 'sk-t...7890',
      }),
    )
    const sessionDriver = createSessionDriver([session])
    const runtime = createYuanxiaoRuntimeForTesting({
      configuration: runtimeDriver,
      sessions: sessionDriver,
      agents: sessionDriver,
      profiles: sessionDriver,
      skills: sessionDriver,
    })
    sessionDriver.emit({
      type: 'message-appended',
      agentId: YUANXIAO_DEFAULT_AGENT_ID,
      message: {
        messageId: 'message-agent-1',
        agentId: YUANXIAO_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
        role: 'agent',
        content: '',
        createdAt: '2026-07-08T00:00:01.000Z',
      },
      occurredAt: '2026-07-08T00:00:01.000Z',
    })
    sessionDriver.emit({
      type: 'attempt-started',
      agentId: YUANXIAO_DEFAULT_AGENT_ID,
      sessionId: session.sessionId,
      runId: 'run-1',
      occurredAt: '2026-07-08T00:00:01.000Z',
    })
    sessionDriver.emit({
      type: 'message-delta',
      agentId: YUANXIAO_DEFAULT_AGENT_ID,
      sessionId: session.sessionId,
      runId: 'run-1',
      messageId: 'message-agent-1',
      delta: '已生成片段',
      occurredAt: '2026-07-08T00:00:02.000Z',
    })
    sessionDriver.cancelRun = vi.fn(async () => {
      sessionDriver.emit({
        type: 'turn-cancelled',
        agentId: YUANXIAO_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
        runId: 'run-1',
        occurredAt: '2026-07-08T00:00:03.000Z',
      })
    })

    await expect(
      runtime.cancelRun({
        agentId: YUANXIAO_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
      }),
    ).resolves.toEqual(expect.objectContaining({ state: 'cancelled' }))
    await expect(
      runtime.getTranscript({
        agentId: YUANXIAO_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        entries: [
          expect.objectContaining({
            kind: 'agent-reply',
            content: '已生成片段',
          }),
        ],
      }),
    )
  })
  it('blocks duplicate sends in one session while allowing another session to run', async () => {
    const sessionOne = createSessionSummary('session-1')
    const sessionTwo = createSessionSummary('session-2')
    const runtimeDriver = createRuntimeDriver(
      createSnapshot({
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        maskedValue: 'sk-t...7890',
      }),
    )
    const sessionDriver = createSessionDriver([sessionOne, sessionTwo])
    const releaseSessionOne = createDeferred<void>()
    const sessionOneStarted = createDeferred<void>()
    sessionDriver.sendMessage = vi.fn(async (request) => {
      sessionDriver.emit({
        type: 'attempt-started',
        agentId: YUANXIAO_DEFAULT_AGENT_ID,
        sessionId: request.sessionId,
        runId: `${request.sessionId}-run-1`,
        occurredAt: '2026-07-08T00:00:01.000Z',
      })

      if (request.sessionId === sessionOne.sessionId) {
        sessionOneStarted.resolve()
        await releaseSessionOne.promise
      }

      sessionDriver.emit({
        type: 'run-state-changed',
        agentId: YUANXIAO_DEFAULT_AGENT_ID,
        sessionId: request.sessionId,
        state: 'completed',
        occurredAt: '2026-07-08T00:00:05.000Z',
      })
    })
    const runtime = createYuanxiaoRuntimeForTesting({
      configuration: runtimeDriver,
      sessions: sessionDriver,
      agents: sessionDriver,
      profiles: sessionDriver,
      skills: sessionDriver,
    })
    await runtime.listSessions()
    const firstRun = runtime.sendMessage({
      agentId: YUANXIAO_DEFAULT_AGENT_ID,
      sessionId: sessionOne.sessionId,
      content: '第一条',
    })
    await sessionOneStarted.promise

    await expect(
      runtime.sendMessage({
        agentId: YUANXIAO_DEFAULT_AGENT_ID,
        sessionId: sessionOne.sessionId,
        content: '重复发送',
      }),
    ).rejects.toThrow('当前会话正在运行')
    await expect(
      runtime.sendMessage({
        agentId: YUANXIAO_DEFAULT_AGENT_ID,
        sessionId: sessionTwo.sessionId,
        content: '另一个会话',
      }),
    ).resolves.toEqual(
      expect.objectContaining({ sessionId: sessionTwo.sessionId, entries: [] }),
    )

    releaseSessionOne.resolve()
    await expect(firstRun).resolves.toEqual(
      expect.objectContaining({ sessionId: sessionOne.sessionId, entries: [] }),
    )
  })
  it('blocks sending messages when runtime configuration is missing', async () => {
    const runtimeDriver = createRuntimeDriver(createSnapshot())
    const sessionDriver = createSessionDriver([])
    const runtime = createYuanxiaoRuntimeForTesting({
      configuration: runtimeDriver,
      sessions: sessionDriver,
      agents: sessionDriver,
      profiles: sessionDriver,
      skills: sessionDriver,
    })

    await expect(
      runtime.sendMessage({
        agentId: YUANXIAO_DEFAULT_AGENT_ID,
        sessionId: 'session-1',
        content: '你好',
      }),
    ).rejects.toThrow('发送消息前，请先配置 Provider')
    expect(sessionDriver.sendMessage).not.toHaveBeenCalled()
  })
  it('saves runtime configuration through the runtime driver after verification', async () => {
    const savedSnapshot = createSnapshot({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      maskedValue: 'sk-...7890',
    })
    const runtimeDriver = createRuntimeDriver(savedSnapshot)
    const sessionDriver = createSessionDriver([])
    const runtime = createYuanxiaoRuntimeForTesting({
      configuration: runtimeDriver,
      sessions: sessionDriver,
      agents: sessionDriver,
      profiles: sessionDriver,
      skills: sessionDriver,
    })
    const configuration: RuntimeConfiguration = {
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    }

    await expect(
      runtime.saveRuntimeConfiguration(configuration),
    ).resolves.toEqual(savedSnapshot)

    expect(runtimeDriver.saveConfiguration).toHaveBeenCalledWith(configuration)
  })
  it('rejects configuration saves when the runtime driver cannot verify settings', async () => {
    const runtimeDriver = createRuntimeDriver(createSnapshot())
    runtimeDriver.saveConfiguration = vi
      .fn()
      .mockRejectedValue(new Error('验证失败'))
    const sessionDriver = createSessionDriver([])
    const runtime = createYuanxiaoRuntimeForTesting({
      configuration: runtimeDriver,
      sessions: sessionDriver,
      agents: sessionDriver,
      profiles: sessionDriver,
      skills: sessionDriver,
    })

    await expect(
      runtime.saveRuntimeConfiguration({
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        apiKey: 'sk-test-secret-7890',
      }),
    ).rejects.toThrow('验证失败')
  })
  it('cancels runtime configuration verification through the runtime driver', async () => {
    const snapshot = createSnapshot()
    const runtimeDriver = createRuntimeDriver(snapshot)
    const sessionDriver = createSessionDriver([])
    const runtime = createYuanxiaoRuntimeForTesting({
      configuration: runtimeDriver,
      sessions: sessionDriver,
      agents: sessionDriver,
      profiles: sessionDriver,
      skills: sessionDriver,
    })

    await expect(
      runtime.cancelRuntimeConfigurationVerification({
        verificationId: 'verify-1',
      }),
    ).resolves.toEqual(snapshot)

    expect(runtimeDriver.cancelConfigurationVerification).toHaveBeenCalledWith({
      verificationId: 'verify-1',
    })
  })
  it('restores configuration from backup through the runtime driver', async () => {
    const restoredSnapshot = createSnapshot({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      maskedValue: 'sk-t...7890',
    })
    const runtimeDriver = createRuntimeDriver(restoredSnapshot)
    const sessionDriver = createSessionDriver([])
    const runtime = createYuanxiaoRuntimeForTesting({
      configuration: runtimeDriver,
      sessions: sessionDriver,
      agents: sessionDriver,
      profiles: sessionDriver,
      skills: sessionDriver,
    })

    await expect(runtime.restoreFromBackup()).resolves.toEqual(restoredSnapshot)
    expect(runtimeDriver.restoreFromBackup).toHaveBeenCalledOnce()
  })
  it('resets configuration through the runtime driver and refreshes the snapshot', async () => {
    const resetSnapshot = createSnapshot()
    const runtimeDriver = createRuntimeDriver(resetSnapshot)
    const sessionDriver = createSessionDriver([])
    const runtime = createYuanxiaoRuntimeForTesting({
      configuration: runtimeDriver,
      sessions: sessionDriver,
      agents: sessionDriver,
      profiles: sessionDriver,
      skills: sessionDriver,
    })

    await expect(runtime.resetConfiguration()).resolves.toEqual(resetSnapshot)
    expect(runtimeDriver.resetConfiguration).toHaveBeenCalledOnce()
    expect(runtimeDriver.getSnapshot).toHaveBeenCalled()
  })
  it('reads soul content through the session driver', async () => {
    const snapshot = createSnapshot()
    const runtimeDriver = createRuntimeDriver(snapshot)
    const sessionDriver = createSessionDriver([])
    sessionDriver.getSoul = vi.fn().mockResolvedValue({
      agentId: 'agent-1',
      content: '# Soul content',
      updatedAt: '2026-07-17T00:00:00.000Z',
    })
    const runtime = createYuanxiaoRuntimeForTesting({
      configuration: runtimeDriver,
      sessions: sessionDriver,
      agents: sessionDriver,
      profiles: sessionDriver,
      skills: sessionDriver,
    })

    await expect(runtime.getSoul('agent-1')).resolves.toEqual({
      agentId: 'agent-1',
      content: '# Soul content',
      updatedAt: '2026-07-17T00:00:00.000Z',
    })
    expect(sessionDriver.getSoul).toHaveBeenCalledWith('agent-1')
  })
  it('reads shared user profile through the session driver', async () => {
    const snapshot = createSnapshot()
    const runtimeDriver = createRuntimeDriver(snapshot)
    const sessionDriver = createSessionDriver([])
    sessionDriver.getUserProfile = vi.fn().mockResolvedValue({
      content: '# User profile',
      updatedAt: '2026-07-17T00:00:00.000Z',
    })
    const runtime = createYuanxiaoRuntimeForTesting({
      configuration: runtimeDriver,
      sessions: sessionDriver,
      agents: sessionDriver,
      profiles: sessionDriver,
      skills: sessionDriver,
    })

    await expect(runtime.getUserProfile()).resolves.toEqual({
      content: '# User profile',
      updatedAt: '2026-07-17T00:00:00.000Z',
    })
    expect(sessionDriver.getUserProfile).toHaveBeenCalledOnce()
  })
  it('updates soul through the session driver and refreshes snapshot on success', async () => {
    const snapshot = createSnapshot()
    const runtimeDriver = createRuntimeDriver(snapshot)
    const sessionDriver = createSessionDriver([])
    sessionDriver.updateSoul = vi.fn().mockResolvedValue({
      target: 'soul',
      status: 'updated',
      version: 'sha256:new',
    })
    const runtime = createYuanxiaoRuntimeForTesting({
      configuration: runtimeDriver,
      sessions: sessionDriver,
      agents: sessionDriver,
      profiles: sessionDriver,
      skills: sessionDriver,
    })

    await expect(
      runtime.updateSoul('agent-1', 'New soul content', 'sha256:old'),
    ).resolves.toEqual({
      target: 'soul',
      status: 'updated',
      version: 'sha256:new',
    })

    expect(sessionDriver.updateSoul).toHaveBeenCalledWith(
      'agent-1',
      'New soul content',
      'sha256:old',
    )
    // 成功后应刷新快照
    expect(runtimeDriver.getSnapshot).toHaveBeenCalled()
  })
  it('updates user profile through the session driver and refreshes snapshot on success', async () => {
    const snapshot = createSnapshot()
    const runtimeDriver = createRuntimeDriver(snapshot)
    const sessionDriver = createSessionDriver([])
    sessionDriver.updateUserProfile = vi.fn().mockResolvedValue({
      target: 'user',
      status: 'updated',
      version: 'sha256:new',
    })
    const runtime = createYuanxiaoRuntimeForTesting({
      configuration: runtimeDriver,
      sessions: sessionDriver,
      agents: sessionDriver,
      profiles: sessionDriver,
      skills: sessionDriver,
    })

    await expect(
      runtime.updateUserProfile('New user profile', 'sha256:old'),
    ).resolves.toEqual({
      target: 'user',
      status: 'updated',
      version: 'sha256:new',
    })

    expect(sessionDriver.updateUserProfile).toHaveBeenCalledWith(
      'New user profile',
      'sha256:old',
    )
    // 成功后应刷新快照
    expect(runtimeDriver.getSnapshot).toHaveBeenCalled()
  })
})
