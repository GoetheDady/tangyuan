import {
  createDefaultSessionSummary,
  createRuntimeSnapshot,
  type DesktopPreloadApi,
  type RuntimeSnapshot,
} from '@yuanxiao/contracts'
import { vi } from 'vitest'
import { resetDesktopWorkbenchLoadForTest } from './lib/desktop-workbench-loader'

/** 为非启动行为测试从现有 preload 替身生成一个完整续接结果。 */
export function createResumeSessionFromApi(
  target?: { agentId: string; sessionId?: string },
): DesktopPreloadApi['resumeSession'] {
  return vi.fn(async () => {
    const runtime = await window.api.getRuntimeSnapshot()
    const agentId = target?.agentId ?? runtime.activeAgent.agentId
    const allSessions = await window.api.listSessions({
      agentId,
      includeArchived: true,
    })
    let sessions = allSessions.filter(
      (session) => session.archivedAt === undefined,
    )
    const archivedSessions = allSessions.filter(
      (session) => session.archivedAt !== undefined,
    )
    let activeSession =
      sessions.find(
        (session) =>
          session.sessionId === target?.sessionId &&
          !session.lineageUnavailable,
      ) ?? sessions.find((session) => !session.lineageUnavailable)

    if (!activeSession) {
      activeSession = await window.api.createSession({
        agentId,
        title: runtime.activeAgent.profile.bootstrapRequired
          ? 'Bootstrap 初始化'
          : '新会话',
      })
      sessions = [activeSession]
    }

    const transcript = await window.api.getTranscript({
      agentId: activeSession.agentId,
      sessionId: activeSession.sessionId,
    })
    return { sessions, archivedSessions, activeSession, transcript }
  })
}

export function installDefaultAppApi(): void {
  window.location.hash = '#/'
  const runtime = createMissingConfigurationSnapshot()
  const api: DesktopPreloadApi = {
    getRuntimeSnapshot: vi.fn().mockResolvedValue(runtime),
    refreshRuntime: vi.fn().mockResolvedValue(runtime),
    saveRuntimeConfiguration: vi.fn().mockResolvedValue(
      createReadyRuntimeSnapshot({
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        maskedValue: 'sk-t...7890',
      }),
    ),
    saveProvider: vi.fn().mockResolvedValue(runtime),
    deleteProvider: vi.fn().mockResolvedValue(runtime),
    cancelRuntimeConfigurationVerification: vi.fn().mockResolvedValue(runtime),
    listSessions: vi.fn().mockResolvedValue([
      createDefaultSessionSummary({
        sessionId: 'welcome',
        title: '新会话',
        updatedAt: '2026-07-08T00:00:00.000Z',
      }),
    ]),
    resumeSession: createResumeSessionFromApi({
      agentId: 'yuanxiao',
      sessionId: 'welcome',
    }),
    setLastActiveSession: vi.fn().mockResolvedValue(null),
    createSession: vi.fn().mockResolvedValue(
      createDefaultSessionSummary({
        sessionId: 'session-1',
        title: '新会话',
        updatedAt: '2026-07-08T00:00:00.000Z',
      }),
    ),
    getTranscript: vi.fn().mockResolvedValue({
      sessionId: '',
      agentId: 'yuanxiao',
      entries: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    }),
    sendMessage: vi.fn().mockResolvedValue([
      {
        messageId: 'message-1',
        agentId: 'yuanxiao',
        sessionId: 'welcome',
        role: 'user',
        content: '你好',
        createdAt: '2026-07-08T00:00:00.000Z',
      },
      {
        messageId: 'message-2',
        agentId: 'yuanxiao',
        sessionId: 'welcome',
        role: 'agent',
        content: '收到：你好',
        createdAt: '2026-07-08T00:00:00.000Z',
      },
    ]),
    retryMessage: vi.fn().mockResolvedValue([]),
    forkSession: vi.fn().mockResolvedValue(
      createDefaultSessionSummary({
        sessionId: 'welcome',
        title: '新会话',
        updatedAt: '2026-07-08T00:00:00.000Z',
      }),
    ),
    archiveSession: vi.fn().mockResolvedValue({
      status: 'archived',
      affectedSessionIds: [],
      affectedActivities: [],
    }),
    recoverSession: vi.fn().mockResolvedValue([]),
    deleteSession: vi.fn(),
    renameSession: vi.fn(),
    cancelRun: vi.fn().mockResolvedValue(
      createDefaultSessionSummary({
        sessionId: 'welcome',
        title: '新会话',
        updatedAt: '2026-07-08T00:00:00.000Z',
      }),
    ),
    subscribeToAgentEvents: vi.fn(() => () => undefined),
    openExternalLink: vi.fn(),
    restoreFromBackup: vi.fn(),
    resetConfiguration: vi.fn(),
    listAgents: vi.fn().mockResolvedValue([
      {
        agentId: 'yuanxiao',
        displayName: '元宵',
        status: 'active' as const,
        defaultProviderId: null,
        defaultModelId: null,
        homePath: '~/.yuanxiao/agents/yuanxiao',
        archivedAt: null,
      },
    ]),
    updateAgentConfig: vi.fn().mockResolvedValue({
      agentId: 'yuanxiao',
      displayName: '元宵',
      status: 'active' as const,
      defaultProviderId: 'anthropic',
      defaultModelId: 'claude-sonnet-4-5',
      homePath: '~/.yuanxiao/agents/yuanxiao',
      archivedAt: null,
    }),
    getSessionModelInfo: vi.fn().mockResolvedValue({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      displayName: 'Claude Sonnet 4.5',
      thinkingLevel: null,
      supportedThinkingLevels: [],
      supportsThinking: false,
    }),
    setSessionModel: vi.fn().mockResolvedValue({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      displayName: 'Claude Sonnet 4.5',
      thinkingLevel: null,
      supportedThinkingLevels: [],
      supportsThinking: false,
    }),
    setSessionThinkingLevel: vi.fn().mockResolvedValue({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      displayName: 'Claude Sonnet 4.5',
      thinkingLevel: 'medium',
      supportedThinkingLevels: ['low', 'medium', 'high'],
      supportsThinking: true,
    }),
    archiveAgent: vi.fn(),
    recoverAgent: vi.fn(),
    reconcileAgentDirectories: vi.fn().mockResolvedValue({
      agents: [],
      unclaimedDirectories: [],
    }),
    claimAgentDirectory: vi.fn(),
    rebuildYuanxiaoHome: vi.fn(),
    getSoul: vi.fn().mockResolvedValue({
      agentId: 'yuanxiao',
      content: '',
      updatedAt: '',
      version: 'sha256:empty',
    }),
    getUserProfile: vi.fn().mockResolvedValue({
      content: '',
      updatedAt: '',
      version: 'sha256:empty',
    }),
    updateSoul: vi.fn().mockResolvedValue({
      target: 'soul' as const,
      status: 'updated' as const,
      version: 'sha256:new-soul',
    }),
    updateUserProfile: vi.fn().mockResolvedValue({
      target: 'user' as const,
      status: 'updated' as const,
      version: 'sha256:new-user',
    }),
    listAgentSkills: vi.fn().mockResolvedValue([]),
    listSharedSkills: vi.fn().mockResolvedValue([]),
    installSkill: vi.fn().mockResolvedValue([]),
    deleteSkill: vi.fn().mockResolvedValue([]),
    approveSkillOperation: vi.fn().mockResolvedValue(undefined),
    rejectSkillOperation: vi.fn().mockResolvedValue(undefined),
    getPendingSkillApprovals: vi.fn().mockResolvedValue([]),
    getSkillInstallRecords: vi.fn().mockResolvedValue([]),
    sendNotification: vi.fn().mockResolvedValue(undefined),
  }

  Object.defineProperty(window, 'api', {
    configurable: true,
    value: api,
  })
}

export function resetAppTestEnvironment(): void {
  vi.restoreAllMocks()
  resetDesktopWorkbenchLoadForTest()
  window.location.hash = '#/'
}

/**
 * 创建 Renderer 测试使用的缺配置运行时快照。
 *
 * @returns 一个默认 Agent 下缺少 Provider、Model 和 API Key 的 RuntimeSnapshot。
 * @throws 此测试辅助方法不会主动抛出错误。
 */
export function createMissingConfigurationSnapshot(
  resources: Pick<RuntimeSnapshot, 'providers' | 'models'> = {
    providers: [{ providerId: 'anthropic', displayName: 'Anthropic' }],
    models: [
      {
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        displayName: 'Claude Sonnet 4.5',
      },
    ],
  },
): RuntimeSnapshot {
  return createRuntimeSnapshot({
    activeAgent: {
      agentId: 'yuanxiao',
      displayName: '元宵',
      homePath: '~/.yuanxiao/agents/yuanxiao',
      profile: {
        initialized: false,
        bootstrapRequired: true,
        soulUpdatedAt: null,
        userUpdatedAt: null,
      },
    },
    providers: resources.providers,
    models: resources.models,
    settings: {
      selectedProviderId: null,
      selectedModelId: null,
    },
    configuredProviders: {},
    auth: {
      apiKey: {
        configured: false,
        maskedValue: null,
      },
    },
  })
}

/**
 * 创建 Renderer 测试使用的已就绪运行时快照。
 *
 * @param input - 已保存的 Provider、Model 和 API Key 脱敏值。
 * @returns 一个默认 Agent 下配置完整的 RuntimeSnapshot。
 * @throws 此测试辅助方法不会主动抛出错误。
 */
export function createReadyRuntimeSnapshot(input: {
  providerId: string
  modelId: string
  maskedValue: string
  profileInitialized?: boolean
}): RuntimeSnapshot {
  return createRuntimeSnapshot({
    activeAgent: {
      agentId: 'yuanxiao',
      displayName: '元宵',
      homePath: '~/.yuanxiao/agents/yuanxiao',
      profile: {
        initialized: input.profileInitialized ?? false,
        bootstrapRequired: !(input.profileInitialized ?? false),
        soulUpdatedAt: null,
        userUpdatedAt: null,
      },
    },
    providers: [{ providerId: input.providerId, displayName: 'Anthropic' }],
    models: [
      {
        providerId: input.providerId,
        modelId: input.modelId,
        displayName: 'Claude Sonnet 4.5',
      },
    ],
    settings: {
      selectedProviderId: input.providerId,
      selectedModelId: input.modelId,
    },
    configuredProviders: {
      [input.providerId]: {
        configured: true,
        maskedValue: input.maskedValue,
      },
    },
    auth: {
      apiKey: {
        configured: true,
        maskedValue: input.maskedValue,
      },
    },
  })
}

/**
 * 创建可手动 resolve 的 Promise，用于控制 Renderer 测试里的异步发送。
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
