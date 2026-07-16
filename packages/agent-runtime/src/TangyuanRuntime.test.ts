import type {
  AgentEvent,
  AgentEventListener,
  AgentSessionDriver,
  RuntimeResourceDriver,
} from './index'
import {
  TANGYUAN_DEFAULT_AGENT_ID,
  type AgentSessionSummary,
  type AgentMessage,
  type RuntimeConfiguration,
  type RuntimeSnapshot,
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
    sessionDriver.getMessages = vi.fn().mockResolvedValue([
      {
        messageId: 'message-1',
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
        role: 'user',
        content: '你好',
        createdAt: '2026-07-08T00:00:00.000Z',
      },
    ])
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
    ).resolves.toEqual([
      expect.objectContaining({
        role: 'user',
        content: '你好',
      }),
    ])

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
    ).resolves.toEqual([
      expect.objectContaining({
        role: 'agent',
        content: '你好',
      }),
    ])
    await expect(runtime.listSessions()).resolves.toEqual([
      expect.objectContaining({
        sessionId: session.sessionId,
        state: 'completed',
      }),
    ])
  })

  it('records sanitized activity and error events as system messages', async () => {
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
      runtime.getMessages({
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
      }),
    ).resolves.toEqual([
      expect.objectContaining({ role: 'system', content: '思考中' }),
      expect.objectContaining({ role: 'system', content: '工具失败' }),
      expect.objectContaining({
        role: 'system',
        content: '模型服务暂时不可用',
      }),
    ])
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
      runtime.getMessages({
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        role: 'agent',
        content: '已生成片段',
      }),
    ])
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
    ).resolves.toEqual([])

    releaseSessionOne.resolve()
    await expect(firstRun).resolves.toEqual([])
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
  emit(event: AgentEvent): void
  messages: Map<string, AgentMessage[]>
} {
  const [firstSession] = sessions
  let currentSessions = [...sessions]
  let currentListener: AgentEventListener | null = null
  const messages = new Map<string, AgentMessage[]>()

  return {
    listSessions: vi.fn(async () => currentSessions),
    createSession: vi.fn().mockResolvedValue(firstSession),
    getMessages: vi.fn(
      async (request) => messages.get(request.sessionId) ?? [],
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
    emit: (event: AgentEvent) => {
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

      currentListener?.(event)
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
