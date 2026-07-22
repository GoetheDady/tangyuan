import type {
  AgentEvent,
  DriverEvent,
  AgentEventListener,
  AgentSessionDriver,
  RuntimeResourceDriver,
} from './index'
import {
  TANGYUAN_DEFAULT_AGENT_ID,
  agentEventSchema,
  type AgentSessionSummary,
  type RuntimeConfiguration,
  type RuntimeSnapshot,
  type TranscriptSnapshot,
} from '@tangyuan/contracts'
import { describe, expect, it, vi } from 'vitest'
import { createTangyuanRuntimeForTesting } from './TangyuanRuntime'

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
        type: 'turn-started',
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
        type: 'turn-started',
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
      type: 'turn-started',
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
        type: 'turn-started',
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
      success: true,
    })
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
    })

    await expect(
      runtime.updateSoul('agent-1', 'New soul content'),
    ).resolves.toEqual({ target: 'soul', success: true })

    expect(sessionDriver.updateSoul).toHaveBeenCalledWith(
      'agent-1',
      'New soul content',
      snapshot.activeAgent.agentId,
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
      success: true,
    })
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
    })

    await expect(
      runtime.updateUserProfile('New user profile'),
    ).resolves.toEqual({ target: 'user', success: true })

    expect(sessionDriver.updateUserProfile).toHaveBeenCalledWith(
      'New user profile',
    )
    // 成功后应刷新快照
    expect(runtimeDriver.getSnapshot).toHaveBeenCalled()
  })

  it('rejects getSoul when the session driver does not support it', async () => {
    const snapshot = createSnapshot()
    const runtimeDriver = createRuntimeDriver(snapshot)
    const sessionDriver = createSessionDriver([])
    // 不设置 getSoul
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
    })

    await expect(runtime.getSoul('agent-1')).rejects.toThrow(
      '当前运行时不支持读取 Agent soul',
    )
  })

  it('rejects updateSoul when the session driver does not support it', async () => {
    const snapshot = createSnapshot()
    const runtimeDriver = createRuntimeDriver(snapshot)
    const sessionDriver = createSessionDriver([])
    // 不设置 updateSoul
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
    })

    await expect(runtime.updateSoul('agent-1', 'content')).rejects.toThrow(
      '当前运行时不支持更新 Agent soul',
    )
  })

  it('delegates listAgentSkills to session driver', async () => {
    const snapshot = createSnapshot()
    const runtimeDriver = createRuntimeDriver(snapshot)
    const sessionDriver = createSessionDriver([])
    sessionDriver.listAgentSkills = vi.fn().mockResolvedValue([
      {
        name: 'my-skill',
        description: 'A skill.',
        source: 'agent',
        path: '/path/SKILL.md',
        hasScripts: false,
      },
    ])
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
    })

    await expect(runtime.listAgentSkills('agent-1')).resolves.toEqual([
      {
        name: 'my-skill',
        description: 'A skill.',
        source: 'agent',
        path: '/path/SKILL.md',
        hasScripts: false,
      },
    ])
    expect(sessionDriver.listAgentSkills).toHaveBeenCalledWith('agent-1')
  })

  it('delegates listSharedSkills to session driver', async () => {
    const snapshot = createSnapshot()
    const runtimeDriver = createRuntimeDriver(snapshot)
    const sessionDriver = createSessionDriver([])
    sessionDriver.listSharedSkills = vi.fn().mockResolvedValue([
      {
        name: 'shared-skill',
        description: 'A shared skill.',
        source: 'shared',
        path: '/skills/shared/SKILL.md',
        hasScripts: false,
      },
    ])
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
    })

    await expect(runtime.listSharedSkills()).resolves.toEqual([
      {
        name: 'shared-skill',
        description: 'A shared skill.',
        source: 'shared',
        path: '/skills/shared/SKILL.md',
        hasScripts: false,
      },
    ])
    expect(sessionDriver.listSharedSkills).toHaveBeenCalledOnce()
  })

  it('rejects listAgentSkills when the session driver does not support it', async () => {
    const snapshot = createSnapshot()
    const runtimeDriver = createRuntimeDriver(snapshot)
    const sessionDriver = createSessionDriver([])
    // 不设置 listAgentSkills
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
    })

    await expect(runtime.listAgentSkills('agent-1')).rejects.toThrow(
      '当前运行时不支持读取 Agent Skills',
    )
  })

  it('rejects listSharedSkills when the session driver does not support it', async () => {
    const snapshot = createSnapshot()
    const runtimeDriver = createRuntimeDriver(snapshot)
    const sessionDriver = createSessionDriver([])
    // 不设置 listSharedSkills
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
    })

    await expect(runtime.listSharedSkills()).rejects.toThrow(
      '当前运行时不支持读取共享 Skills',
    )
  })

  it('delegates reloadAgentSessions to session driver', async () => {
    const snapshot = createSnapshot()
    const runtimeDriver = createRuntimeDriver(snapshot)
    const sessionDriver = createSessionDriver([])
    sessionDriver.reloadAgentSessions = vi.fn().mockResolvedValue(undefined)
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
    })

    await expect(
      runtime.reloadAgentSessions('agent-1'),
    ).resolves.toBeUndefined()
    expect(sessionDriver.reloadAgentSessions).toHaveBeenCalledWith('agent-1')
  })

  it('delegates reloadAllSessions to session driver', async () => {
    const snapshot = createSnapshot()
    const runtimeDriver = createRuntimeDriver(snapshot)
    const sessionDriver = createSessionDriver([])
    sessionDriver.reloadAllSessions = vi.fn().mockResolvedValue(undefined)
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
    })

    await expect(runtime.reloadAllSessions()).resolves.toBeUndefined()
    expect(sessionDriver.reloadAllSessions).toHaveBeenCalledOnce()
  })

  it('rejects reloadAgentSessions when the session driver does not support it', async () => {
    const snapshot = createSnapshot()
    const runtimeDriver = createRuntimeDriver(snapshot)
    const sessionDriver = createSessionDriver([])
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
    })

    await expect(runtime.reloadAgentSessions('agent-1')).rejects.toThrow(
      '当前运行时不支持重新加载 Agent session',
    )
  })

  describe('run scheduling', () => {
    it('allows up to four concurrent runs across different sessions', async () => {
      const sessions = [1, 2, 3, 4].map((n) =>
        createSessionSummary(`session-${n}`),
      )
      const runtimeDriver = createRuntimeDriver(
        createSnapshot({
          providerId: 'anthropic',
          modelId: 'claude-sonnet-4-5',
          maskedValue: 'sk-t...7890',
        }),
      )
      const sessionDriver = createSessionDriver(sessions)
      const sessionDeferreds = new Map<
        string,
        ReturnType<typeof createDeferred<void>>
      >()
      sessionDriver.sendMessage = vi.fn(async (request) => {
        sessionDriver.emit({
          type: 'turn-started',
          agentId: TANGYUAN_DEFAULT_AGENT_ID,
          sessionId: request.sessionId,
          runId: `${request.sessionId}-run-1`,
          occurredAt: '2026-07-17T00:00:01.000Z',
        })
        const deferred = createDeferred<void>()
        sessionDeferreds.set(request.sessionId, deferred)
        await deferred.promise
        sessionDriver.emit({
          type: 'run-state-changed',
          agentId: TANGYUAN_DEFAULT_AGENT_ID,
          sessionId: request.sessionId,
          state: 'completed',
          occurredAt: '2026-07-17T00:00:05.000Z',
        })
      })
      const runtime = createTangyuanRuntimeForTesting({
        runtimeDriver,
        sessionDriver,
      })
      await runtime.listSessions()

      // 同时发送 4 条消息
      const runs = sessions.map((s) =>
        runtime.sendMessage({
          agentId: TANGYUAN_DEFAULT_AGENT_ID,
          sessionId: s.sessionId,
          content: 'hello',
        }),
      )

      // 等待所有 4 个都进入 running 状态
      await vi.waitFor(() => {
        expect(sessionDeferreds.size).toBe(4)
      })
      // 确认 4 个都在运行中
      const sessionList = await runtime.listSessions()
      const runningCount = sessionList.filter(
        (s) => s.state === 'running',
      ).length
      expect(runningCount).toBe(4)

      // 完成所有 run
      for (const deferred of sessionDeferreds.values()) {
        deferred.resolve()
      }
      await Promise.all(runs)
    })

    it('enqueues a fifth request when all four slots are active', async () => {
      const sessions = [1, 2, 3, 4, 5].map((n) =>
        createSessionSummary(`session-${n}`),
      )
      const runtimeDriver = createRuntimeDriver(
        createSnapshot({
          providerId: 'anthropic',
          modelId: 'claude-sonnet-4-5',
          maskedValue: 'sk-t...7890',
        }),
      )
      const sessionDriver = createSessionDriver(sessions)
      const sessionDeferreds = new Map<
        string,
        ReturnType<typeof createDeferred<void>>
      >()
      sessionDriver.sendMessage = vi.fn(async (request) => {
        sessionDriver.emit({
          type: 'turn-started',
          agentId: TANGYUAN_DEFAULT_AGENT_ID,
          sessionId: request.sessionId,
          runId: `${request.sessionId}-run-1`,
          occurredAt: '2026-07-17T00:00:01.000Z',
        })
        // 只有前 4 个 session 的 run 会被 deferred 暂停
        const deferred = sessionDeferreds.get(request.sessionId)
        if (deferred) {
          await deferred.promise
        }
        sessionDriver.emit({
          type: 'run-state-changed',
          agentId: TANGYUAN_DEFAULT_AGENT_ID,
          sessionId: request.sessionId,
          state: 'completed',
          occurredAt: '2026-07-17T00:00:05.000Z',
        })
      })
      const runtime = createTangyuanRuntimeForTesting({
        runtimeDriver,
        sessionDriver,
      })
      await runtime.listSessions()

      const startedSessions: string[] = []
      const queuedSessions: string[] = []
      runtime.subscribe((event) => {
        if (event.type === 'turn-started') {
          startedSessions.push(event.sessionId)
        }
        if (event.type === 'run-state-changed' && event.state === 'queued') {
          queuedSessions.push(event.sessionId)
        }
      })

      // 前 4 个 session 的 run 会被暂停
      for (const s of sessions.slice(0, 4)) {
        sessionDeferreds.set(s.sessionId, createDeferred<void>())
      }

      // 同时发送 5 条消息
      const runs = sessions.map((s) =>
        runtime.sendMessage({
          agentId: TANGYUAN_DEFAULT_AGENT_ID,
          sessionId: s.sessionId,
          content: 'hello',
        }),
      )

      // 等待前 4 个进入 running
      await vi.waitFor(() => {
        expect(startedSessions.length).toBe(4)
      })

      // 第 5 个应进入 queued
      await vi.waitFor(() => {
        expect(queuedSessions.length).toBe(1)
      })
      expect(queuedSessions[0]).toBe('session-5')

      // 完成前 4 个 — 第 5 个应自动 dequeue 并启动
      for (const deferred of sessionDeferreds.values()) {
        deferred.resolve()
      }
      await vi.waitFor(() => {
        expect(startedSessions.length).toBe(5)
      })
      expect(startedSessions).toContain('session-5')
      await Promise.all(runs)
    })

    it('dequeues in FIFO order when slots are released', async () => {
      const sessions = [1, 2, 3, 4, 5, 6].map((n) =>
        createSessionSummary(`session-${n}`),
      )
      const runtimeDriver = createRuntimeDriver(
        createSnapshot({
          providerId: 'anthropic',
          modelId: 'claude-sonnet-4-5',
          maskedValue: 'sk-t...7890',
        }),
      )
      const sessionDriver = createSessionDriver(sessions)
      const sessionDeferreds = new Map<
        string,
        ReturnType<typeof createDeferred<void>>
      >()
      const startedSessions: string[] = []
      sessionDriver.sendMessage = vi.fn(async (request) => {
        startedSessions.push(request.sessionId)
        sessionDriver.emit({
          type: 'turn-started',
          agentId: TANGYUAN_DEFAULT_AGENT_ID,
          sessionId: request.sessionId,
          runId: `${request.sessionId}-run-1`,
          occurredAt: '2026-07-17T00:00:01.000Z',
        })
        const deferred = sessionDeferreds.get(request.sessionId)
        if (deferred) {
          await deferred.promise
        }
        sessionDriver.emit({
          type: 'run-state-changed',
          agentId: TANGYUAN_DEFAULT_AGENT_ID,
          sessionId: request.sessionId,
          state: 'completed',
          occurredAt: '2026-07-17T00:00:05.000Z',
        })
      })
      const runtime = createTangyuanRuntimeForTesting({
        runtimeDriver,
        sessionDriver,
      })
      await runtime.listSessions()

      // 所有 6 个都被暂停，防止级联 dequeue
      for (const s of sessions) {
        sessionDeferreds.set(s.sessionId, createDeferred<void>())
      }

      // 发送全部 6 条
      const runs = sessions.map((s) =>
        runtime.sendMessage({
          agentId: TANGYUAN_DEFAULT_AGENT_ID,
          sessionId: s.sessionId,
          content: 'hello',
        }),
      )

      // 等待前 4 个启动，后 2 个排队
      await vi.waitFor(() => {
        expect(startedSessions.length).toBe(4)
      })
      expect(startedSessions).toEqual([
        'session-1',
        'session-2',
        'session-3',
        'session-4',
      ])

      // 释放 session-1 → session-5 应启动
      sessionDeferreds.get('session-1')?.resolve()
      await vi.waitFor(() => {
        expect(startedSessions.length).toBe(5)
      })
      expect(startedSessions[4]).toBe('session-5')

      // 释放 session-2 → session-6 应启动
      sessionDeferreds.get('session-2')?.resolve()
      await vi.waitFor(() => {
        expect(startedSessions.length).toBe(6)
      })
      expect(startedSessions[5]).toBe('session-6')

      // 释放剩余
      for (const d of sessionDeferreds.values()) {
        d.resolve()
      }
      await Promise.all(runs)
    })

    it('rejects a send for a session that is already queued', async () => {
      const sessions = [1, 2, 3, 4, 5].map((n) =>
        createSessionSummary(`session-${n}`),
      )
      const runtimeDriver = createRuntimeDriver(
        createSnapshot({
          providerId: 'anthropic',
          modelId: 'claude-sonnet-4-5',
          maskedValue: 'sk-t...7890',
        }),
      )
      const sessionDriver = createSessionDriver(sessions)
      const sessionDeferreds = new Map<
        string,
        ReturnType<typeof createDeferred<void>>
      >()
      sessionDriver.sendMessage = vi.fn(async (request) => {
        sessionDriver.emit({
          type: 'turn-started',
          agentId: TANGYUAN_DEFAULT_AGENT_ID,
          sessionId: request.sessionId,
          runId: `${request.sessionId}-run-1`,
          occurredAt: '2026-07-17T00:00:01.000Z',
        })
        const deferred = sessionDeferreds.get(request.sessionId)
        if (deferred) {
          await deferred.promise
        }
        sessionDriver.emit({
          type: 'run-state-changed',
          agentId: TANGYUAN_DEFAULT_AGENT_ID,
          sessionId: request.sessionId,
          state: 'completed',
          occurredAt: '2026-07-17T00:00:05.000Z',
        })
      })
      const runtime = createTangyuanRuntimeForTesting({
        runtimeDriver,
        sessionDriver,
      })
      await runtime.listSessions()

      // 所有 5 个 session 都用 deferred 暂停，防止级联 dequeue
      for (const s of sessions) {
        sessionDeferreds.set(s.sessionId, createDeferred<void>())
      }

      // 同时发送 5 条
      const runs = sessions.map((s) =>
        runtime.sendMessage({
          agentId: TANGYUAN_DEFAULT_AGENT_ID,
          sessionId: s.sessionId,
          content: 'hello',
        }),
      )

      // 等待前 4 个进入 running
      await vi.waitFor(() => {
        const runningSessions = Array.from(sessionDeferreds.keys()).filter(
          (id) => {
            // session-5 should NOT be running (it's queued)
            return id !== 'session-5'
          },
        )
        expect(runningSessions.length).toBe(4)
      })

      // 等待 session-5 进入 queued 状态
      const queuedPromise = new Promise<void>((resolve) => {
        const unsubscribe = runtime.subscribe((event) => {
          if (
            event.type === 'run-state-changed' &&
            event.sessionId === 'session-5' &&
            event.state === 'queued'
          ) {
            unsubscribe.unsubscribe()
            resolve()
          }
        })
      })
      await queuedPromise

      // 对已在队列中的 session-5 再次发送会失败
      await expect(
        runtime.sendMessage({
          agentId: TANGYUAN_DEFAULT_AGENT_ID,
          sessionId: 'session-5',
          content: '重复发送',
        }),
      ).rejects.toThrow('当前会话已在排队中')

      // 清理
      for (const deferred of sessionDeferreds.values()) {
        deferred.resolve()
      }
      await Promise.all(runs)
    })

    it('cancels a queued run and prevents it from starting', async () => {
      const sessions = [1, 2, 3, 4, 5].map((n) =>
        createSessionSummary(`session-${n}`),
      )
      const runtimeDriver = createRuntimeDriver(
        createSnapshot({
          providerId: 'anthropic',
          modelId: 'claude-sonnet-4-5',
          maskedValue: 'sk-t...7890',
        }),
      )
      const sessionDriver = createSessionDriver(sessions)
      const sessionDeferreds = new Map<
        string,
        ReturnType<typeof createDeferred<void>>
      >()
      const startedSessions: string[] = []
      sessionDriver.sendMessage = vi.fn(async (request) => {
        startedSessions.push(request.sessionId)
        sessionDriver.emit({
          type: 'turn-started',
          agentId: TANGYUAN_DEFAULT_AGENT_ID,
          sessionId: request.sessionId,
          runId: `${request.sessionId}-run-1`,
          occurredAt: '2026-07-17T00:00:01.000Z',
        })
        const deferred = sessionDeferreds.get(request.sessionId)
        if (deferred) {
          await deferred.promise
        }
        sessionDriver.emit({
          type: 'run-state-changed',
          agentId: TANGYUAN_DEFAULT_AGENT_ID,
          sessionId: request.sessionId,
          state: 'completed',
          occurredAt: '2026-07-17T00:00:05.000Z',
        })
      })
      const runtime = createTangyuanRuntimeForTesting({
        runtimeDriver,
        sessionDriver,
      })
      await runtime.listSessions()

      // 前 4 个被暂停
      for (const s of sessions.slice(0, 4)) {
        sessionDeferreds.set(s.sessionId, createDeferred<void>())
      }

      // 发送所有 5 条
      const runs = sessions.map((s) =>
        runtime.sendMessage({
          agentId: TANGYUAN_DEFAULT_AGENT_ID,
          sessionId: s.sessionId,
          content: 'hello',
        }),
      )

      // 等待 session-5 排队
      await vi.waitFor(() => {
        expect(startedSessions.length).toBe(4)
      })

      // 取消排队的 session-5
      const cancelled = await runtime.cancelRun({
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: 'session-5',
      })
      expect(cancelled.state).toBe('cancelled')
      // session-5 的 sendMessage promise 应 resolve 为空数组
      await expect(runs[4]).resolves.toEqual(
        expect.objectContaining({ sessionId: 'session-5', entries: [] }),
      )

      // 释放所有 slots → session-5 不应启动（已被取消且移出队列）
      for (const deferred of sessionDeferreds.values()) {
        deferred.resolve()
      }
      await Promise.all(runs.slice(0, 4))

      // 确认 session-5 从未被启动
      expect(startedSessions).not.toContain('session-5')
    })

    it('cancels a running run and dequeues the next queued request', async () => {
      const sessions = [1, 2, 3, 4, 5].map((n) =>
        createSessionSummary(`session-${n}`),
      )
      const runtimeDriver = createRuntimeDriver(
        createSnapshot({
          providerId: 'anthropic',
          modelId: 'claude-sonnet-4-5',
          maskedValue: 'sk-t...7890',
        }),
      )
      const sessionDriver = createSessionDriver(sessions)
      const sessionDeferreds = new Map<
        string,
        ReturnType<typeof createDeferred<void>>
      >()
      const startedSessions: string[] = []
      const abortedSessions: string[] = []
      sessionDriver.sendMessage = vi.fn(async (request) => {
        startedSessions.push(request.sessionId)
        sessionDriver.emit({
          type: 'turn-started',
          agentId: TANGYUAN_DEFAULT_AGENT_ID,
          sessionId: request.sessionId,
          runId: `${request.sessionId}-run-1`,
          occurredAt: '2026-07-17T00:00:01.000Z',
        })
        const deferred = sessionDeferreds.get(request.sessionId)
        if (deferred) {
          await deferred.promise
        }
        // 除非已被中止，否则正常完成
        if (!abortedSessions.includes(request.sessionId)) {
          sessionDriver.emit({
            type: 'run-state-changed',
            agentId: TANGYUAN_DEFAULT_AGENT_ID,
            sessionId: request.sessionId,
            state: 'completed',
            occurredAt: '2026-07-17T00:00:05.000Z',
          })
        }
      })
      sessionDriver.cancelRun = vi.fn(async (request) => {
        abortedSessions.push(request.sessionId)
        const deferred = sessionDeferreds.get(request.sessionId)
        if (deferred) {
          deferred.resolve()
        }
        sessionDriver.emit({
          type: 'turn-cancelled',
          agentId: TANGYUAN_DEFAULT_AGENT_ID,
          sessionId: request.sessionId,
          runId: `${request.sessionId}-run-1`,
          occurredAt: '2026-07-17T00:00:03.000Z',
        })
      })
      const runtime = createTangyuanRuntimeForTesting({
        runtimeDriver,
        sessionDriver,
      })
      await runtime.listSessions()

      // 前 4 个被暂停
      for (const s of sessions.slice(0, 4)) {
        sessionDeferreds.set(s.sessionId, createDeferred<void>())
      }

      // 发送全部 5 条
      const runs = sessions.map((s) =>
        runtime.sendMessage({
          agentId: TANGYUAN_DEFAULT_AGENT_ID,
          sessionId: s.sessionId,
          content: 'hello',
        }),
      )

      // 等待前 4 启动 + session-5 排队
      await vi.waitFor(() => {
        expect(startedSessions.length).toBe(4)
      })

      // 取消 session-1（运行中）
      const cancelled = await runtime.cancelRun({
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: 'session-1',
      })
      expect(cancelled.state).toBe('cancelled')
      expect(abortedSessions).toContain('session-1')

      // session-5 应被 dequeue 并启动
      await vi.waitFor(() => {
        expect(startedSessions).toContain('session-5')
      })

      // 清理
      for (const deferred of sessionDeferreds.values()) {
        deferred.resolve()
      }
      await Promise.all(runs)
    })

    it('clears the queue and cancels active runs on cancelAllActiveRuns', async () => {
      const sessions = [1, 2, 3, 4, 5].map((n) =>
        createSessionSummary(`session-${n}`),
      )
      const runtimeDriver = createRuntimeDriver(
        createSnapshot({
          providerId: 'anthropic',
          modelId: 'claude-sonnet-4-5',
          maskedValue: 'sk-t...7890',
        }),
      )
      const sessionDriver = createSessionDriver(sessions)
      const sessionDeferreds = new Map<
        string,
        ReturnType<typeof createDeferred<void>>
      >()
      const startedSessions: string[] = []
      sessionDriver.sendMessage = vi.fn(async (request) => {
        startedSessions.push(request.sessionId)
        sessionDriver.emit({
          type: 'turn-started',
          agentId: TANGYUAN_DEFAULT_AGENT_ID,
          sessionId: request.sessionId,
          runId: `${request.sessionId}-run-1`,
          occurredAt: '2026-07-17T00:00:01.000Z',
        })
        const deferred = sessionDeferreds.get(request.sessionId)
        if (deferred) {
          await deferred.promise
        }
        sessionDriver.emit({
          type: 'run-state-changed',
          agentId: TANGYUAN_DEFAULT_AGENT_ID,
          sessionId: request.sessionId,
          state: 'completed',
          occurredAt: '2026-07-17T00:00:05.000Z',
        })
      })
      sessionDriver.cancelRun = vi.fn(async (request) => {
        sessionDeferreds.get(request.sessionId)?.resolve()
        sessionDriver.emit({
          type: 'turn-cancelled',
          agentId: TANGYUAN_DEFAULT_AGENT_ID,
          sessionId: request.sessionId,
          runId: `${request.sessionId}-run-1`,
          occurredAt: '2026-07-17T00:00:03.000Z',
        })
      })
      const runtime = createTangyuanRuntimeForTesting({
        runtimeDriver,
        sessionDriver,
      })
      await runtime.listSessions()

      // 所有 session 都被暂停
      for (const s of sessions) {
        sessionDeferreds.set(s.sessionId, createDeferred<void>())
      }

      // 发送全部 5 条
      const runs = sessions.map((s) =>
        runtime.sendMessage({
          agentId: TANGYUAN_DEFAULT_AGENT_ID,
          sessionId: s.sessionId,
          content: 'hello',
        }),
      )

      // 等待前 4 个启动
      await vi.waitFor(() => {
        expect(startedSessions.length).toBe(4)
      })

      // cancelAllActiveRuns 应同时取消运行中和排队中的请求
      await runtime.cancelAllActiveRuns()

      // 所有 run 都应该 resolve
      const results = await Promise.allSettled(runs)
      const resolved = results.filter((r) => r.status === 'fulfilled')
      expect(resolved.length).toBe(5)
    })
  })

  describe('skill management', () => {
    it('rejects shared skill install by non-tangyuan agent', async () => {
      const runtimeDriver = createRuntimeDriver(createSnapshot())
      const sessionDriver = createSessionDriver([])
      const runtime = createTangyuanRuntimeForTesting({
        runtimeDriver,
        sessionDriver,
      })

      await expect(
        runtime.installSkill({
          operation: 'install',
          source: 'shared',
          agentId: 'agent-1',
          skillName: 'test-skill',
        }),
      ).rejects.toThrow('只有默认 Agent「汤圆」可以管理共享 Skill')
    })

    it('rejects shared skill delete by non-tangyuan agent', async () => {
      const runtimeDriver = createRuntimeDriver(createSnapshot())
      const sessionDriver = createSessionDriver([])
      const runtime = createTangyuanRuntimeForTesting({
        runtimeDriver,
        sessionDriver,
      })

      await expect(
        runtime.deleteSkill({
          operation: 'delete',
          source: 'shared',
          agentId: 'agent-1',
          skillName: 'test-skill',
        }),
      ).rejects.toThrow('只有默认 Agent「汤圆」可以管理共享 Skill')
    })

    it('rejects agent skill operation by another agent', async () => {
      const runtimeDriver = createRuntimeDriver(createSnapshot())
      const sessionDriver = createSessionDriver([])
      const runtime = createTangyuanRuntimeForTesting({
        runtimeDriver,
        sessionDriver,
      })

      await expect(
        runtime.installSkill({
          operation: 'install',
          source: 'agent',
          agentId: 'agent-2',
          targetAgentId: 'agent-1',
          skillName: 'test-skill',
          skillDirPath: '/tmp/test-skill',
        }),
      ).rejects.toThrow('无权管理')
    })

    it('rejects install when session driver does not support it', async () => {
      const runtimeDriver = createRuntimeDriver(createSnapshot())
      const sessionDriver = createSessionDriver([])
      const runtime = createTangyuanRuntimeForTesting({
        runtimeDriver,
        sessionDriver,
      })

      await expect(
        runtime.installSkill({
          operation: 'install',
          source: 'shared',
          agentId: 'tangyuan',
          skillName: 'test-skill',
        }),
      ).rejects.toThrow('当前运行时不支持安装 Skill')
    })

    it('rejects delete when session driver does not support it', async () => {
      const runtimeDriver = createRuntimeDriver(createSnapshot())
      const sessionDriver = createSessionDriver([])
      const runtime = createTangyuanRuntimeForTesting({
        runtimeDriver,
        sessionDriver,
      })

      await expect(
        runtime.deleteSkill({
          operation: 'delete',
          source: 'agent',
          agentId: 'agent-1',
          targetAgentId: 'agent-1',
          skillName: 'test-skill',
        }),
      ).rejects.toThrow('当前运行时不支持删除 Skill')
    })

    it('returns empty pending skill approvals initially', () => {
      const runtimeDriver = createRuntimeDriver(createSnapshot())
      const sessionDriver = createSessionDriver([])
      const runtime = createTangyuanRuntimeForTesting({
        runtimeDriver,
        sessionDriver,
      })

      expect(runtime.getPendingSkillApprovals()).toEqual([])
    })
  })
})

/**
 * 创建用于 Runtime 单元测试的运行时快照。
 *
 * @returns 一个缺少配置但包含默认 Agent profile 的 RuntimeSnapshot。
 * @throws 此测试辅助方法不会抛出错误。
 */
function createSnapshot(
  overrides: {
    providerId?: string | null
    modelId?: string | null
    maskedValue?: string | null
  } = {},
): RuntimeSnapshot {
  const configured = Boolean(
    overrides.providerId && overrides.modelId && overrides.maskedValue,
  )

  const configuredProviders: Record<
    string,
    { configured: boolean; maskedValue: string | null }
  > = {}
  if (configured && overrides.providerId) {
    configuredProviders[overrides.providerId] = {
      configured: true,
      maskedValue: overrides.maskedValue ?? null,
    }
  }

  return {
    activeAgent: {
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      displayName: '汤圆',
      homePath: '~/.tangyuan/agents/tangyuan',
      profile: {
        initialized: false,
        bootstrapRequired: true,
        soulUpdatedAt: null,
        userUpdatedAt: null,
      },
    },
    agents: [
      {
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        displayName: '汤圆',
        status: 'active' as const,
        defaultProviderId: overrides.providerId ?? null,
        defaultModelId: overrides.modelId ?? null,
        homePath: '~/.tangyuan/agents/tangyuan',
        archivedAt: null,
        directoryStatus: 'healthy' as const,
      },
    ],
    providers: [],
    models: [],
    settings: {
      selectedProviderId: overrides.providerId ?? null,
      selectedModelId: overrides.modelId ?? null,
    },
    auth: {
      state: configured ? 'api-key-configured' : 'missing-api-key',
      apiKey: {
        configured,
        maskedValue: overrides.maskedValue ?? null,
      },
    },
    configuredProviders,
    status: configured ? 'ready' : 'missing-config',
    configRecovery: { state: 'ok', hasBackup: false },
  }
}

/**
 * 创建可观察调用次数的 RuntimeResourceDriver 测试替身。
 *
 * @param snapshot - Driver 方法需要返回的运行时快照。
 * @returns 一个只用于单元测试的 RuntimeResourceDriver。
 * @throws 此测试辅助方法不会抛出错误。
 */
function createRuntimeDriver(snapshot: RuntimeSnapshot): RuntimeResourceDriver {
  return {
    getSnapshot: vi.fn().mockResolvedValue(snapshot),
    refresh: vi.fn().mockResolvedValue(snapshot),
    saveConfiguration: vi.fn().mockResolvedValue(snapshot),
    cancelConfigurationVerification: vi.fn().mockResolvedValue(snapshot),
    restoreFromBackup: vi.fn().mockResolvedValue(snapshot),
    resetConfiguration: vi.fn().mockResolvedValue(undefined),
  }
}

/**
 * 创建可观察调用参数的 AgentSessionDriver 测试替身。
 *
 * @param sessions - Driver 方法需要返回的会话摘要列表。
 * @returns 一个只用于单元测试的 AgentSessionDriver。
 * @throws 此测试辅助方法不会抛出错误。
 */
function createSessionDriver(
  sessions: AgentSessionSummary[],
): AgentSessionDriver & {
  emit(event: AgentEvent | DriverEvent): void
  messages: Map<string, TranscriptSnapshot>
} {
  const [firstSession] = sessions
  let currentSessions = [...sessions]
  let currentListener: AgentEventListener | null = null
  const messages = new Map<string, TranscriptSnapshot>()

  return {
    listSessions: vi.fn(async () => currentSessions),
    createSession: vi.fn().mockResolvedValue(firstSession),
    getTranscript: vi.fn(
      async (request) =>
        messages.get(request.sessionId) ?? {
          sessionId: request.sessionId,
          agentId: request.agentId,
          entries: [],
          updatedAt: '2026-07-08T00:00:00.000Z',
        },
    ),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    cancelRun: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn((listener: AgentEventListener) => {
      currentListener = listener

      return {
        unsubscribe: vi.fn(),
      }
    }),
    messages,
    emit: (event: AgentEvent | DriverEvent) => {
      if (event.type === 'session-created') {
        currentSessions = [
          event.session,
          ...currentSessions.filter(
            (session) => session.sessionId !== event.session.sessionId,
          ),
        ]
      }

      if (event.type === 'run-state-changed') {
        currentSessions = currentSessions.map((session) =>
          session.sessionId === event.sessionId
            ? { ...session, state: event.state, updatedAt: event.occurredAt }
            : session,
        )
      }

      if (event.type === 'turn-started') {
        currentSessions = currentSessions.map((session) =>
          session.sessionId === event.sessionId
            ? { ...session, state: 'running', updatedAt: event.occurredAt }
            : session,
        )
      }

      if (event.type === 'turn-cancelled') {
        currentSessions = currentSessions.map((session) =>
          session.sessionId === event.sessionId
            ? { ...session, state: 'cancelled', updatedAt: event.occurredAt }
            : session,
        )
      }

      if (event.type === 'turn-failed') {
        currentSessions = currentSessions.map((session) =>
          session.sessionId === event.sessionId
            ? { ...session, state: 'failed', updatedAt: event.occurredAt }
            : session,
        )
      }

      currentListener?.(event as AgentEvent)
    },
  }
}

/**
 * 创建会话列表里展示的测试摘要。
 *
 * @param sessionId - 会话唯一标识。
 * @returns 默认 Agent 下的空闲会话摘要。
 * @throws 此测试辅助方法不会抛出错误。
 */
function createSessionSummary(sessionId: string): AgentSessionSummary {
  return {
    agentId: TANGYUAN_DEFAULT_AGENT_ID,
    sessionId,
    title: '新会话',
    state: 'idle',
    updatedAt: '2026-07-08T00:00:00.000Z',
  }
}

/**
 * 创建可手动 resolve 的 Promise，用于测试并发状态。
 *
 * @returns Promise 和对应 resolve 函数。
 * @throws 此测试辅助方法不会主动抛出错误。
 */
function createDeferred<T>(): {
  promise: Promise<T>
  resolve(value?: T): void
} {
  let resolve!: (value?: T) => void
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve as (value?: T) => void
  })

  return { promise, resolve }
}

describe('transcript turn/step tracking', () => {
  it('getTranscript returns cached snapshot with entries after message-appended', async () => {
    const session = createSessionSummary('session-1')
    const runtimeDriver = createRuntimeDriver(createReadySnapshot())
    const sessionDriver = createSessionDriver([session])
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
    })

    sessionDriver.emit({
      type: 'message-appended',
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      message: {
        messageId: 'user-msg',
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
        role: 'user',
        content: 'hello',
        createdAt: '2026-07-21T00:00:00.000Z',
      },
      occurredAt: '2026-07-21T00:00:00.000Z',
    })

    sessionDriver.emit({
      type: 'message-appended',
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      message: {
        messageId: 'agent-msg',
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
        role: 'agent',
        content: '',
        createdAt: '2026-07-21T00:00:00.000Z',
      },
      occurredAt: '2026-07-21T00:00:00.000Z',
    })

    const snapshot = await runtime.getTranscript({
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: session.sessionId,
    })

    expect(snapshot.entries.length).toBe(2)
    expect(snapshot.entries[0]?.kind).toBe('user-message')
    expect(snapshot.entries[1]?.kind).toBe('agent-reply')
  })

  it('loads the driver transcript when no cached snapshot exists', async () => {
    const session = createSessionSummary('session-1')
    const runtimeDriver = createRuntimeDriver(createReadySnapshot())
    const sessionDriver = createSessionDriver([session])
    sessionDriver.messages.set(session.sessionId, {
      sessionId: session.sessionId,
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      entries: [
        {
          kind: 'user-message',
          index: 0,
          messageId: 'm1',
          content: 'hello',
          createdAt: '2026-07-21T00:00:00.000Z',
        },
      ],
      updatedAt: '2026-07-21T00:00:00.000Z',
    })
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
    })

    const snapshot = await runtime.getTranscript({
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: session.sessionId,
    })

    // Driver fallback returns structured entries without turns
    expect(snapshot.entries.length).toBe(1)
    const replyEntry = snapshot.entries.find((e) => e.kind === 'user-message')
    expect(replyEntry).toBeDefined()
  })

  it('cached snapshot survives getTranscript call', async () => {
    const session = createSessionSummary('session-1')
    const runtimeDriver = createRuntimeDriver(createReadySnapshot())
    const sessionDriver = createSessionDriver([session])
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
    })

    // No events emitted → no cached snapshot
    const first = await runtime.getTranscript({
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: session.sessionId,
    })
    // Fallback from messages: no cached snapshot exists
    expect(first.entries.length).toBe(0)

    // Now emit message-appended → creates cached snapshot
    sessionDriver.emit({
      type: 'message-appended',
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      message: {
        messageId: 'u1',
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
        role: 'user',
        content: 'test',
        createdAt: '2026-07-21T00:00:00.000Z',
      },
      occurredAt: '2026-07-21T00:00:00.000Z',
    })

    const second = await runtime.getTranscript({
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: session.sessionId,
    })
    // Cached snapshot now available
    expect(second.entries.length).toBe(1)
  })

  it('thinking-started then thinking-delta creates a thinking step in transcript', async () => {
    const session = createSessionSummary('session-1')
    const runtimeDriver = createRuntimeDriver(createReadySnapshot())
    const sessionDriver = createSessionDriver([session])
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
    })

    // Emit message-appended events to create transcript entries (simulating PiSdkDriver)
    sessionDriver.emit({
      type: 'message-appended',
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      message: {
        messageId: 'user-msg',
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
        role: 'user',
        content: '分析一下',
        createdAt: '2026-07-21T00:00:00.000Z',
      },
      occurredAt: '2026-07-21T00:00:00.000Z',
    })

    sessionDriver.emit({
      type: 'message-appended',
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      message: {
        messageId: 'msg-1',
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
        role: 'agent',
        content: '',
        createdAt: '2026-07-21T00:00:00.000Z',
      },
      occurredAt: '2026-07-21T00:00:00.000Z',
    })

    sessionDriver.emit({
      type: 'turn-started',
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: session.sessionId,
      runId: 'run-1',
      occurredAt: '2026-07-21T00:00:01.000Z',
    })

    sessionDriver.emit({
      type: 'message-delta',
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: session.sessionId,
      runId: 'run-1',
      messageId: 'msg-1',
      delta: 'Let me think about this...',
      deltaKind: 'thinking',
      occurredAt: '2026-07-21T00:00:01.000Z',
    })

    sessionDriver.emit({
      type: 'message-delta',
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: session.sessionId,
      runId: 'run-1',
      messageId: 'msg-1',
      delta: '分析结果：没有问题。',
      occurredAt: '2026-07-21T00:00:02.000Z',
    })

    sessionDriver.emit({
      type: 'message-completed',
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: session.sessionId,
      runId: 'run-1',
      message: {
        messageId: 'msg-1',
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
        role: 'agent',
        content: '分析结果：没有问题。',
        createdAt: '2026-07-21T00:00:02.000Z',
      },
      occurredAt: '2026-07-21T00:00:02.000Z',
    })

    const snapshot = await runtime.getTranscript({
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: session.sessionId,
    })

    // Should have at least user + agent entries
    expect(snapshot.entries.length).toBeGreaterThanOrEqual(2)

    // Find agent-reply entry with turns
    const replyEntry = snapshot.entries.find((e) => e.kind === 'agent-reply')
    expect(replyEntry, 'agent-reply entry should exist').toBeDefined()

    // Debug: check what's actually in the snapshot
    if (!replyEntry || replyEntry.kind !== 'agent-reply') {
      return
    }
    expect(replyEntry.turns.length).toBeGreaterThan(0)
    const hasThinking = replyEntry.turns.some((t) =>
      t.steps.some((s) => s.kind === 'thinking'),
    )
    expect(hasThinking).toBe(true)
  })

  it('tool-started creates tool-call step', async () => {
    const session = createSessionSummary('session-1')
    const runtimeDriver = createRuntimeDriver(createReadySnapshot())
    const sessionDriver = createSessionDriver([session])
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
    })

    sessionDriver.emit({
      type: 'message-appended',
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      message: {
        messageId: 'user-msg',
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
        role: 'user',
        content: '搜索文件',
        createdAt: '2026-07-21T00:00:00.000Z',
      },
      occurredAt: '2026-07-21T00:00:00.000Z',
    })

    sessionDriver.emit({
      type: 'message-appended',
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      message: {
        messageId: 'msg-1',
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
        role: 'agent',
        content: '',
        createdAt: '2026-07-21T00:00:00.000Z',
      },
      occurredAt: '2026-07-21T00:00:00.000Z',
    })

    sessionDriver.emit({
      type: 'turn-started',
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: session.sessionId,
      runId: 'run-1',
      occurredAt: '2026-07-21T00:00:01.000Z',
    })

    sessionDriver.emit({
      type: 'activity-updated',
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: session.sessionId,
      runId: 'run-1',
      activity: { kind: 'tool', state: 'running', label: '正在搜索' },
      occurredAt: '2026-07-21T00:00:01.000Z',
    })

    sessionDriver.emit({
      type: 'activity-updated',
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: session.sessionId,
      runId: 'run-1',
      activity: { kind: 'tool', state: 'completed', label: '搜索完成' },
      occurredAt: '2026-07-21T00:00:02.000Z',
    })

    const snapshot = await runtime.getTranscript({
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: session.sessionId,
    })

    const replyEntry = snapshot.entries.find((e) => e.kind === 'agent-reply')
    expect(replyEntry).toBeDefined()
    if (replyEntry?.kind === 'agent-reply') {
      const hasToolCall = replyEntry.turns.some((t) =>
        t.steps.some((s) => s.kind === 'tool-call'),
      )
      expect(hasToolCall).toBe(true)
    }
  })

  it('cancelled run preserves existing steps in transcript', async () => {
    const session = createSessionSummary('session-1')
    const runtimeDriver = createRuntimeDriver(createReadySnapshot())
    const sessionDriver = createSessionDriver([session])
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
    })

    sessionDriver.emit({
      type: 'message-appended',
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      message: {
        messageId: 'user-msg',
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
        role: 'user',
        content: '搜索文件',
        createdAt: '2026-07-21T00:00:00.000Z',
      },
      occurredAt: '2026-07-21T00:00:00.000Z',
    })

    sessionDriver.emit({
      type: 'message-appended',
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      message: {
        messageId: 'msg-1',
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
        role: 'agent',
        content: '',
        createdAt: '2026-07-21T00:00:00.000Z',
      },
      occurredAt: '2026-07-21T00:00:00.000Z',
    })

    sessionDriver.emit({
      type: 'turn-started',
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: session.sessionId,
      runId: 'run-1',
      occurredAt: '2026-07-21T00:00:01.000Z',
    })

    sessionDriver.emit({
      type: 'message-delta',
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: session.sessionId,
      runId: 'run-1',
      messageId: 'msg-1',
      delta: 'Let me check...',
      deltaKind: 'thinking',
      occurredAt: '2026-07-21T00:00:01.000Z',
    })

    sessionDriver.emit({
      type: 'turn-cancelled',
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: session.sessionId,
      runId: 'run-1',
      occurredAt: '2026-07-21T00:00:02.000Z',
    })

    const snapshot = await runtime.getTranscript({
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: session.sessionId,
    })

    const replyEntry = snapshot.entries.find((e) => e.kind === 'agent-reply')
    expect(replyEntry).toBeDefined()
    if (replyEntry?.kind === 'agent-reply') {
      // Should have preserved the thinking step
      const hasThinking = replyEntry.turns.some((t) =>
        t.steps.some((s) => s.kind === 'thinking'),
      )
      expect(hasThinking).toBe(true)
    }
  })

  it('never emits internal driver events to public subscribers', async () => {
    const session = createSessionSummary('session-1')
    const runtimeDriver = createRuntimeDriver(createReadySnapshot())
    const sessionDriver = createSessionDriver([session])
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
    })

    // 复刻 ipc.ts 的行为：每条公开事件都会被 agentEventSchema 校验后广播给渲染层。
    // 内部驱动事件（message-appended 等）若泄漏到这里会导致 parse 抛错。
    const received: AgentEvent[] = []
    runtime.subscribe((event) => {
      agentEventSchema.parse(event)
      received.push(event)
    })

    // 模拟一次真实发送：driver 先追加用户消息，再追加 agent 占位消息。
    expect(() => {
      sessionDriver.emit({
        type: 'message-appended',
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        message: {
          messageId: 'user-msg',
          agentId: TANGYUAN_DEFAULT_AGENT_ID,
          sessionId: session.sessionId,
          role: 'user',
          content: '你好',
          createdAt: '2026-07-21T00:00:00.000Z',
        },
        occurredAt: '2026-07-21T00:00:00.000Z',
      })
    }).not.toThrow()

    // 公开订阅者只应收到 transcript-delta，不应收到 message-appended。
    expect(
      received.every(
        (event) => (event.type as string) !== 'message-appended',
      ),
    ).toBe(true)
    expect(received.some((event) => event.type === 'transcript-delta')).toBe(
      true,
    )
  })
})

function createReadySnapshot(): RuntimeSnapshot {
  return createSnapshot({
    providerId: 'anthropic',
    modelId: 'claude-sonnet-4-5',
    maskedValue: 'sk-t...7890',
  })
}
