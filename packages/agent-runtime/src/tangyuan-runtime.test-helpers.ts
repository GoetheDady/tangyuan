import type {
  AgentEvent,
  DriverEvent,
  AgentEventListener,
  AgentSessionDriver,
  RuntimeResourceDriver,
} from './index'
import {
  TANGYUAN_DEFAULT_AGENT_ID,
  type AgentSessionSummary,
  type RuntimeSnapshot,
  type TranscriptSnapshot,
} from '@tangyuan/contracts'
import { vi } from 'vitest'

/**
 * 创建用于 Runtime 单元测试的运行时快照。
 *
 * @returns 一个缺少配置但包含默认 Agent profile 的 RuntimeSnapshot。
 * @throws 此测试辅助方法不会抛出错误。
 */
export function createSnapshot(
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
export function createRuntimeDriver(
  snapshot: RuntimeSnapshot,
): RuntimeResourceDriver {
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
export function createSessionDriver(
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

      if (event.type === 'attempt-started') {
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
export function createSessionSummary(sessionId: string): AgentSessionSummary {
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
export function createDeferred<T>(): {
  promise: Promise<T>
  resolve(value?: T): void
} {
  let resolve!: (value?: T) => void
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve as (value?: T) => void
  })

  return { promise, resolve }
}

export function createReadySnapshot(): RuntimeSnapshot {
  return createSnapshot({
    providerId: 'anthropic',
    modelId: 'claude-sonnet-4-5',
    maskedValue: 'sk-t...7890',
  })
}
