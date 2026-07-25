import {
  TANGYUAN_DEFAULT_AGENT_ID,
  type RuntimeConfiguration,
} from '@tangyuan/contracts'
import { describe, expect, it, vi } from 'vitest'
import { createTangyuanRuntimeForTesting } from './TangyuanRuntime'
import {
  createDeferred,
  createRuntimeDriver,
  createSessionDriver,
  createSessionSummary,
  createSnapshot,
} from './tangyuan-runtime.test-helpers'

describe('TangyuanRuntime', () => {
  it('coordinates runtime snapshot requests through the runtime driver', async () => {
    const snapshot = createSnapshot()
    const runtimeDriver = createRuntimeDriver(snapshot)
    const sessionDriver = createSessionDriver([])
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
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
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
    })

    await expect(
      runtime.createSession({
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        title: '新会话',
      }),
    ).resolves.toEqual(session)
    await expect(runtime.listSessions()).resolves.toEqual([session])
    expect(sessionDriver.createSession).toHaveBeenCalledWith({
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      title: '新会话',
    })
    expect(sessionDriver.listSessions).toHaveBeenCalledWith({
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
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
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
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
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
    })

    await expect(
      runtime.sendMessage({
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
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
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
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
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        message: {
          messageId: 'message-agent-1',
          agentId: TANGYUAN_DEFAULT_AGENT_ID,
          sessionId: session.sessionId,
          role: 'agent',
          content: '',
          createdAt: '2026-07-08T00:00:01.000Z',
        },
        occurredAt: '2026-07-08T00:00:01.000Z',
      })
      sessionDriver.emit({
        type: 'attempt-started',
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
        runId: 'run-1',
        occurredAt: '2026-07-08T00:00:01.000Z',
      })
      sessionDriver.emit({
        type: 'message-delta',
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
        runId: 'run-1',
        messageId: 'message-agent-1',
        delta: '你',
        occurredAt: '2026-07-08T00:00:02.000Z',
      })
      sessionDriver.emit({
        type: 'message-delta',
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
        runId: 'run-1',
        messageId: 'message-agent-1',
        delta: '好',
        occurredAt: '2026-07-08T00:00:03.000Z',
      })
      sessionDriver.emit({
        type: 'message-completed',
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
        runId: 'run-1',
        message: {
          messageId: 'message-agent-1',
          agentId: TANGYUAN_DEFAULT_AGENT_ID,
          sessionId: session.sessionId,
          role: 'agent',
          content: '你好',
          createdAt: '2026-07-08T00:00:02.000Z',
        },
        occurredAt: '2026-07-08T00:00:04.000Z',
      })
      sessionDriver.emit({
        type: 'run-state-changed',
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
        state: 'completed',
        occurredAt: '2026-07-08T00:00:05.000Z',
      })
    })
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
    })

    await expect(
      runtime.sendMessage({
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
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
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
        runId: 'run-1',
        occurredAt: '2026-07-08T00:00:01.000Z',
      })
      sessionDriver.emit({
        type: 'activity-updated',
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
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
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
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
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
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
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
    })

    await expect(
      runtime.sendMessage({
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
        content: '你好',
      }),
    ).rejects.toThrow('模型服务暂时不可用')
    await expect(
      runtime.getTranscript({
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
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
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
    })
    sessionDriver.emit({
      type: 'message-appended',
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      message: {
        messageId: 'message-agent-1',
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
        role: 'agent',
        content: '',
        createdAt: '2026-07-08T00:00:01.000Z',
      },
      occurredAt: '2026-07-08T00:00:01.000Z',
    })
    sessionDriver.emit({
      type: 'attempt-started',
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: session.sessionId,
      runId: 'run-1',
      occurredAt: '2026-07-08T00:00:01.000Z',
    })
    sessionDriver.emit({
      type: 'message-delta',
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: session.sessionId,
      runId: 'run-1',
      messageId: 'message-agent-1',
      delta: '已生成片段',
      occurredAt: '2026-07-08T00:00:02.000Z',
    })
    sessionDriver.cancelRun = vi.fn(async () => {
      sessionDriver.emit({
        type: 'turn-cancelled',
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
        runId: 'run-1',
        occurredAt: '2026-07-08T00:00:03.000Z',
      })
    })

    await expect(
      runtime.cancelRun({
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
      }),
    ).resolves.toEqual(expect.objectContaining({ state: 'cancelled' }))
    await expect(
      runtime.getTranscript({
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
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
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
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
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: request.sessionId,
        state: 'completed',
        occurredAt: '2026-07-08T00:00:05.000Z',
      })
    })
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
    })
    await runtime.listSessions()
    const firstRun = runtime.sendMessage({
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: sessionOne.sessionId,
      content: '第一条',
    })
    await sessionOneStarted.promise

    await expect(
      runtime.sendMessage({
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: sessionOne.sessionId,
        content: '重复发送',
      }),
    ).rejects.toThrow('当前会话正在运行')
    await expect(
      runtime.sendMessage({
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
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
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
    })

    await expect(
      runtime.sendMessage({
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
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
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
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
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
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
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
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
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
    })

    await expect(runtime.restoreFromBackup()).resolves.toEqual(restoredSnapshot)
    expect(runtimeDriver.restoreFromBackup).toHaveBeenCalledOnce()
  })
  it('resets configuration through the runtime driver and refreshes the snapshot', async () => {
    const resetSnapshot = createSnapshot()
    const runtimeDriver = createRuntimeDriver(resetSnapshot)
    const sessionDriver = createSessionDriver([])
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
    })

    await expect(runtime.resetConfiguration()).resolves.toEqual(resetSnapshot)
    expect(runtimeDriver.resetConfiguration).toHaveBeenCalledOnce()
    expect(runtimeDriver.getSnapshot).toHaveBeenCalled()
  })
  it('rejects restoreFromBackup when the runtime driver does not support it', async () => {
    const snapshot = createSnapshot()
    const runtimeDriver = createRuntimeDriver(snapshot)
    delete runtimeDriver.restoreFromBackup
    const sessionDriver = createSessionDriver([])
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
    })

    await expect(runtime.restoreFromBackup()).rejects.toThrow(
      '当前运行时不支持配置恢复',
    )
  })
  it('rejects resetConfiguration when the runtime driver does not support it', async () => {
    const snapshot = createSnapshot()
    const runtimeDriver = createRuntimeDriver(snapshot)
    delete runtimeDriver.resetConfiguration
    const sessionDriver = createSessionDriver([])
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
    })

    await expect(runtime.resetConfiguration()).rejects.toThrow(
      '当前运行时不支持配置重置',
    )
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
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
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
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
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
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
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
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
    })

    await expect(
      runtime.updateUserProfile('New user profile'),
    ).resolves.toEqual({
      target: 'user',
      status: 'updated',
      version: 'sha256:new',
    })

    expect(sessionDriver.updateUserProfile).toHaveBeenCalledWith(
      'New user profile',
    )
    // 成功后应刷新快照
    expect(runtimeDriver.getSnapshot).toHaveBeenCalled()
  })
})
