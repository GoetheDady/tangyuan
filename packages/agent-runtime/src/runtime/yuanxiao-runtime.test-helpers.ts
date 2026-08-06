import type { AgentEvent, DriverEvent, AgentEventListener } from '../index'
import type {
  AgentLifecycleModule,
  ProfileModule,
  RuntimeConfigurationModule,
  SessionModule,
  SkillModule,
} from './runtime-modules'
import {
  YUANXIAO_DEFAULT_AGENT_ID,
  type AgentSessionSummary,
  type RuntimeSnapshot,
  type TranscriptSnapshot,
} from '@yuanxiao/contracts'
import { vi } from 'vitest'

export { createDeferred } from '../test-utils'

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
      agentId: YUANXIAO_DEFAULT_AGENT_ID,
      displayName: '元宵',
      homePath: '~/.yuanxiao/agents/yuanxiao',
      profile: {
        initialized: false,
        bootstrapRequired: true,
        soulUpdatedAt: null,
        userUpdatedAt: null,
      },
    },
    agents: [
      {
        agentId: YUANXIAO_DEFAULT_AGENT_ID,
        displayName: '元宵',
        status: 'active' as const,
        defaultProviderId: overrides.providerId ?? null,
        defaultModelId: overrides.modelId ?? null,
        homePath: '~/.yuanxiao/agents/yuanxiao',
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
 * 创建可观察调用次数的 RuntimeConfigurationModule 测试替身。
 *
 * @param snapshot - Driver 方法需要返回的运行时快照。
 * @returns 一个只用于单元测试的 RuntimeConfigurationModule。
 * @throws 此测试辅助方法不会抛出错误。
 */
export function createRuntimeDriver(
  snapshot: RuntimeSnapshot,
): RuntimeConfigurationModule {
  return {
    getSnapshot: vi.fn().mockResolvedValue(snapshot),
    refresh: vi.fn().mockResolvedValue(snapshot),
    saveConfiguration: vi.fn().mockResolvedValue(snapshot),
    cancelConfigurationVerification: vi.fn().mockResolvedValue(snapshot),
    restoreFromBackup: vi.fn().mockResolvedValue(snapshot),
    resetConfiguration: vi.fn().mockResolvedValue(undefined),
    saveProvider: vi.fn().mockResolvedValue(snapshot),
    deleteProvider: vi.fn().mockResolvedValue(snapshot),
  }
}

/**
 * 创建可观察调用参数的 Session/Agent/Profile/Skill 组合测试替身。
 *
 * @param sessions - Driver 方法需要返回的会话摘要列表。
 * @returns 一个只用于单元测试的窄模块组合替身。
 * @throws 此测试辅助方法不会抛出错误。
 */
export function createSessionDriver(
  sessions: AgentSessionSummary[],
): SessionModule &
  AgentLifecycleModule &
  ProfileModule &
  SkillModule & {
    emit(event: AgentEvent | DriverEvent): void
    messages: Map<string, TranscriptSnapshot>
  } {
  const [firstSession] = sessions
  let currentSessions = [...sessions]
  let currentListener: AgentEventListener | null = null
  const messages = new Map<string, TranscriptSnapshot>()
  const activeRunIds = new Map<string, string>()

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
    retryMessage: vi.fn().mockResolvedValue(undefined),
    forkSession: vi.fn(async () => {
      throw new Error('测试未配置 forkSession。')
    }),
    setSessionsArchived: vi.fn(async () => currentSessions),
    deleteSessions: vi.fn().mockResolvedValue(undefined),
    getSessionAttempts: vi.fn(async () => []),
    renameSession: vi.fn(async () => {
      throw new Error('测试未配置 renameSession。')
    }),
    getActiveRunId: vi.fn((sessionId: string) => activeRunIds.get(sessionId)),
    getActiveRunCount: vi.fn(() => activeRunIds.size),
    getSessionModelInfo: vi.fn(async () => {
      throw new Error('测试未配置 getSessionModelInfo。')
    }),
    setSessionModel: vi.fn(async () => {
      throw new Error('测试未配置 setSessionModel。')
    }),
    setSessionThinkingLevel: vi.fn(async () => {
      throw new Error('测试未配置 setSessionThinkingLevel。')
    }),
    reloadAgentSessions: vi.fn().mockResolvedValue(undefined),
    reloadAllSessions: vi.fn().mockResolvedValue(undefined),
    createAgent: vi.fn(async () => {
      throw new Error('测试未配置 createAgent。')
    }),
    updateAgentConfig: vi.fn(async () => {
      throw new Error('测试未配置 updateAgentConfig。')
    }),
    archiveAgent: vi.fn(async () => {
      throw new Error('测试未配置 archiveAgent。')
    }),
    recoverAgent: vi.fn(async () => {
      throw new Error('测试未配置 recoverAgent。')
    }),
    reconcileAgentDirectories: vi.fn(async () => ({
      agents: [],
      unclaimedDirectories: [],
    })),
    claimAgentDirectory: vi.fn(async () => {
      throw new Error('测试未配置 claimAgentDirectory。')
    }),
    rebuildYuanxiaoHome: vi.fn(async () => {
      throw new Error('测试未配置 rebuildYuanxiaoHome。')
    }),
    getSoul: vi.fn(async () => {
      throw new Error('测试未配置 getSoul。')
    }),
    getUserProfile: vi.fn(async () => {
      throw new Error('测试未配置 getUserProfile。')
    }),
    updateSoul: vi.fn(async () => {
      throw new Error('测试未配置 updateSoul。')
    }),
    updateUserProfile: vi.fn(async () => {
      throw new Error('测试未配置 updateUserProfile。')
    }),
    listAgentSkills: vi.fn().mockResolvedValue([]),
    listSharedSkills: vi.fn().mockResolvedValue([]),
    preflightSkillOperation: vi.fn().mockResolvedValue({
      description: '测试 Skill',
      hasScripts: false,
    }),
    installSkill: vi.fn().mockResolvedValue([]),
    deleteSkill: vi.fn().mockResolvedValue([]),
    getSkillInstallRecords: vi.fn().mockResolvedValue([]),
    subscribe: vi.fn((listener: AgentEventListener) => {
      currentListener = listener

      return {
        unsubscribe: vi.fn(),
      }
    }),
    messages,
    emit: (event: AgentEvent | DriverEvent) => {
      if (event.type === 'attempt-started') {
        activeRunIds.set(event.sessionId, event.runId)
      } else if (
        event.type === 'turn-cancelled' ||
        event.type === 'turn-failed'
      ) {
        activeRunIds.delete(event.sessionId)
      }
      if (event.type === 'session-created') {
        currentSessions = [
          event.session,
          ...currentSessions.filter(
            (session) => session.sessionId !== event.session.sessionId,
          ),
        ]
      }

      if (event.type === 'run-state-changed') {
        if (event.state !== 'running') {
          activeRunIds.delete(event.sessionId)
        }
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
 * @param overrides - 需要覆盖的会话摘要字段。
 * @returns 默认 Agent 下的空闲会话摘要。
 * @throws 此测试辅助方法不会抛出错误。
 */
export function createSessionSummary(
  sessionId: string,
  overrides: Partial<AgentSessionSummary> = {},
): AgentSessionSummary {
  return {
    agentId: YUANXIAO_DEFAULT_AGENT_ID,
    sessionId,
    title: '新会话',
    state: 'idle',
    updatedAt: '2026-07-08T00:00:00.000Z',
    ...overrides,
  }
}

export function createReadySnapshot(): RuntimeSnapshot {
  return createSnapshot({
    providerId: 'anthropic',
    modelId: 'claude-sonnet-4-5',
    maskedValue: 'sk-t...7890',
  })
}
