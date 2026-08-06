import {
  DESKTOP_IPC_CHANNELS,
  type AgentEvent,
  YUANXIAO_DEFAULT_AGENT_ID,
  createDefaultSessionSummary,
  createRuntimeSnapshot,
  type AgentSessionSummary,
  type DesktopIpcChannel,
  type DesktopIpcRequest,
  type DesktopIpcResponse,
  type RuntimeSnapshot,
} from '@yuanxiao/contracts'
import { describe, expect, it, vi } from 'vitest'
import type { YuanxiaoRuntime } from '@yuanxiao/agent-runtime'
import { registerDesktopAppIpc, type IpcMainLike } from './ipc'

type IpcHandler<Channel extends DesktopIpcChannel> = (
  event: unknown,
  payload: DesktopIpcRequest<Channel>,
) => Promise<DesktopIpcResponse<Channel>>

describe('registerDesktopAppIpc', () => {
  it('connects IPC channels to the YuanxiaoRuntime methods', async () => {
    const handlers = new Map<DesktopIpcChannel, IpcHandler<DesktopIpcChannel>>()
    const ipcMain: IpcMainLike = {
      handle: vi.fn((channel, handler) => {
        handlers.set(channel, handler as IpcHandler<DesktopIpcChannel>)
      }) as IpcMainLike['handle'],
    }
    const snapshot = createMissingConfigurationSnapshot()
    const session = createSessionSummary()
    const lastActiveSession = {
      agentId: 'yuanxiao',
      sessionId: 'session-1',
      updatedAt: '2026-07-28T14:00:00.000Z',
    }
    const runtime: YuanxiaoRuntime = {
      getRuntimeSnapshot: vi.fn().mockResolvedValue(snapshot),
      refreshRuntime: vi.fn().mockResolvedValue(snapshot),
      saveRuntimeConfiguration: vi.fn().mockResolvedValue(snapshot),
      saveProvider: vi.fn().mockResolvedValue(snapshot),
      deleteProvider: vi.fn().mockResolvedValue(snapshot),
      cancelRuntimeConfigurationVerification: vi
        .fn()
        .mockResolvedValue(snapshot),
      listSessions: vi.fn().mockResolvedValue([session]),
      resumeSession: vi.fn().mockResolvedValue({
        sessions: [session],
        archivedSessions: [],
        activeSession: session,
        transcript: {
          sessionId: 'session-1',
          agentId: 'yuanxiao',
          entries: [],
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      }),
      setLastActiveSession: vi.fn().mockResolvedValue(lastActiveSession),
      createSession: vi.fn().mockResolvedValue(session),
      getTranscript: vi.fn().mockResolvedValue({
        sessionId: 'session-1',
        agentId: 'yuanxiao',
        entries: [],
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
      sendMessage: vi.fn().mockResolvedValue({
        sessionId: 'session-1',
        agentId: 'yuanxiao',
        entries: [],
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
      retryMessage: vi.fn().mockResolvedValue({
        sessionId: 'session-1',
        agentId: 'yuanxiao',
        entries: [],
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
      forkSession: vi.fn().mockResolvedValue(session),
      archiveSession: vi.fn().mockResolvedValue({
        status: 'archived',
        affectedSessionIds: ['session-1'],
        affectedActivities: [],
      }),
      recoverSession: vi.fn().mockResolvedValue([session]),
      deleteSession: vi.fn(),
      renameSession: vi.fn().mockResolvedValue(session),
      cancelRun: vi.fn().mockResolvedValue(session),
      subscribe: vi.fn(),
      cancelAllActiveRuns: vi.fn().mockResolvedValue(undefined),
      restoreFromBackup: vi.fn().mockResolvedValue(snapshot),
      resetConfiguration: vi.fn().mockResolvedValue(snapshot),
      listAgents: vi.fn().mockResolvedValue(snapshot.agents),
      createAgent: vi.fn(),
      updateAgentConfig: vi.fn().mockResolvedValue(snapshot.agents[0]),
      archiveAgent: vi.fn().mockResolvedValue(snapshot.agents[0]),
      recoverAgent: vi.fn().mockResolvedValue(snapshot.agents[0]),
      reconcileAgentDirectories: vi.fn().mockResolvedValue({
        agents: snapshot.agents,
        unclaimedDirectories: [],
      }),
      claimAgentDirectory: vi.fn().mockResolvedValue(snapshot.agents[0]),
      rebuildYuanxiaoHome: vi.fn().mockResolvedValue(snapshot.agents[0]),
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
      getSoul: vi.fn().mockResolvedValue({
        agentId: 'yuanxiao',
        content: '# Soul content',
        updatedAt: '2026-07-08T00:00:00.000Z',
        version: 'sha256:soul',
      }),
      getUserProfile: vi.fn().mockResolvedValue({
        content: '# User profile',
        updatedAt: '2026-07-08T00:00:00.000Z',
        version: 'sha256:user',
      }),
      updateSoul: vi.fn().mockResolvedValue({
        target: 'soul',
        status: 'updated',
        version: 'sha256:new-soul',
      }),
      updateUserProfile: vi.fn().mockResolvedValue({
        target: 'user',
        status: 'updated',
        version: 'sha256:new-user',
      }),
      reloadAgentSessions: vi.fn().mockResolvedValue(undefined),
      reloadAllSessions: vi.fn().mockResolvedValue(undefined),
      listAgentSkills: vi.fn().mockResolvedValue([
        {
          name: 'skill-1',
          description: 'A skill.',
          source: 'agent',
          path: '/path/SKILL.md',
          hasScripts: false,
        },
      ]),
      listSharedSkills: vi.fn().mockResolvedValue([
        {
          name: 'shared-skill',
          description: 'A shared skill.',
          source: 'shared',
          path: '/skills/shared/SKILL.md',
          hasScripts: false,
        },
      ]),
      installSkill: vi.fn().mockResolvedValue([]),
      deleteSkill: vi.fn().mockResolvedValue([]),
      getSkillInstallRecords: vi.fn().mockResolvedValue([]),
    }
    const broadcastAgentEvent = vi.fn()
    const openExternalLink = vi.fn().mockResolvedValue(undefined)
    runtime.subscribe = vi.fn((listener) => {
      listener(createAttemptStartedEvent())

      return {
        unsubscribe: vi.fn(),
      }
    })

    registerDesktopAppIpc(
      ipcMain,
      runtime,
      broadcastAgentEvent,
      openExternalLink,
    )

    expect(ipcMain.handle).toHaveBeenCalledTimes(33)
    expect(broadcastAgentEvent).toHaveBeenCalledWith(
      createAttemptStartedEvent(),
    )
    await expect(
      getHandler(handlers, DESKTOP_IPC_CHANNELS.runtimeGetSnapshot)(
        null,
        undefined,
      ),
    ).resolves.toEqual(snapshot)
    await expect(
      getHandler(handlers, DESKTOP_IPC_CHANNELS.runtimeRefresh)(
        null,
        undefined,
      ),
    ).resolves.toEqual(snapshot)
    await expect(
      getHandler(handlers, DESKTOP_IPC_CHANNELS.runtimeSaveConfiguration)(
        null,
        {
          providerId: 'anthropic',
          modelId: 'claude-sonnet-4-5',
          apiKey: 'sk-test-secret-7890',
        },
      ),
    ).resolves.toEqual(snapshot)
    await expect(
      getHandler(
        handlers,
        DESKTOP_IPC_CHANNELS.runtimeCancelConfigurationVerification,
      )(null, {
        verificationId: 'verify-1',
      }),
    ).resolves.toEqual(snapshot)
    await expect(
      getHandler(handlers, DESKTOP_IPC_CHANNELS.runtimeSaveProvider)(null, {
        providerId: 'anthropic',
        apiKey: 'sk-test-secret-7890',
      }),
    ).resolves.toEqual(snapshot)
    await expect(
      getHandler(handlers, DESKTOP_IPC_CHANNELS.runtimeDeleteProvider)(null, {
        providerId: 'anthropic',
      }),
    ).resolves.toEqual(snapshot)
    expect(runtime.saveProvider).toHaveBeenCalledWith({
      providerId: 'anthropic',
      apiKey: 'sk-test-secret-7890',
    })
    expect(runtime.deleteProvider).toHaveBeenCalledWith({
      providerId: 'anthropic',
    })
    await expect(
      getHandler(handlers, DESKTOP_IPC_CHANNELS.sessionsList)(null, {
        agentId: 'agent-2',
      }),
    ).resolves.toEqual([session])
    expect(runtime.listSessions).toHaveBeenCalledWith('agent-2', undefined)
    await expect(
      getHandler(handlers, DESKTOP_IPC_CHANNELS.sessionsList)(null, {
        agentId: 'agent-2',
        includeArchived: true,
      }),
    ).resolves.toEqual([session])
    expect(runtime.listSessions).toHaveBeenLastCalledWith('agent-2', true)
    await expect(
      getHandler(handlers, DESKTOP_IPC_CHANNELS.sessionsCreate)(null, {
        agentId: 'yuanxiao',
        title: '新会话',
      }),
    ).resolves.toEqual(session)
    await expect(
      getHandler(handlers, DESKTOP_IPC_CHANNELS.sessionsResume)(
        null,
        undefined,
      ),
    ).resolves.toMatchObject({ activeSession: session })
    expect(runtime.resumeSession).toHaveBeenCalledOnce()
    await expect(
      getHandler(handlers, DESKTOP_IPC_CHANNELS.sessionsSetLastActive)(null, {
        agentId: 'yuanxiao',
        sessionId: 'session-1',
      }),
    ).resolves.toEqual(lastActiveSession)
    await expect(
      getHandler(handlers, DESKTOP_IPC_CHANNELS.sessionsGetTranscript)(null, {
        agentId: 'yuanxiao',
        sessionId: 'session-1',
      }),
    ).resolves.toEqual({
      sessionId: 'session-1',
      agentId: 'yuanxiao',
      entries: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    await expect(
      getHandler(handlers, DESKTOP_IPC_CHANNELS.sessionsSendMessage)(null, {
        agentId: 'yuanxiao',
        sessionId: 'session-1',
        content: '你好',
      }),
    ).resolves.toEqual({
      sessionId: 'session-1',
      agentId: 'yuanxiao',
      entries: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    await expect(
      getHandler(handlers, DESKTOP_IPC_CHANNELS.sessionsCancelRun)(null, {
        agentId: 'yuanxiao',
        sessionId: 'session-1',
      }),
    ).resolves.toEqual(session)
    await expect(
      getHandler(handlers, DESKTOP_IPC_CHANNELS.sessionsArchive)(null, {
        agentId: 'yuanxiao',
        sessionId: 'session-1',
        confirmActivityStop: false,
      }),
    ).resolves.toMatchObject({ status: 'archived' })
    await expect(
      getHandler(handlers, DESKTOP_IPC_CHANNELS.sessionsRename)(null, {
        agentId: 'yuanxiao',
        sessionId: 'session-1',
        title: '新标题',
      }),
    ).resolves.toEqual(session)
    expect(runtime.renameSession).toHaveBeenCalledWith({
      agentId: 'yuanxiao',
      sessionId: 'session-1',
      title: '新标题',
    })
    await expect(
      getHandler(handlers, DESKTOP_IPC_CHANNELS.sessionsRecover)(null, {
        agentId: 'yuanxiao',
        sessionId: 'session-1',
      }),
    ).resolves.toEqual([session])
    await expect(
      getHandler(handlers, DESKTOP_IPC_CHANNELS.openExternalLink)(null, {
        url: 'https://example.com',
      }),
    ).resolves.toBeUndefined()
    expect(openExternalLink).toHaveBeenCalledWith('https://example.com')
    expect(runtime.createSession).toHaveBeenCalledWith({
      agentId: 'yuanxiao',
      title: '新会话',
    })
    expect(runtime.saveRuntimeConfiguration).toHaveBeenCalledWith({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    expect(runtime.cancelRuntimeConfigurationVerification).toHaveBeenCalledWith(
      {
        verificationId: 'verify-1',
      },
    )
    expect(runtime.getTranscript).toHaveBeenCalledWith({
      agentId: 'yuanxiao',
      sessionId: 'session-1',
    })
    expect(runtime.sendMessage).toHaveBeenCalledWith({
      agentId: 'yuanxiao',
      sessionId: 'session-1',
      content: '你好',
    })
    expect(runtime.cancelRun).toHaveBeenCalledWith({
      agentId: 'yuanxiao',
      sessionId: 'session-1',
    })

    // Profile channel tests
    await expect(
      getHandler(handlers, DESKTOP_IPC_CHANNELS.profileGetSoul)(null, {
        agentId: 'yuanxiao',
      }),
    ).resolves.toEqual({
      agentId: 'yuanxiao',
      content: '# Soul content',
      updatedAt: '2026-07-08T00:00:00.000Z',
      version: 'sha256:soul',
    })
    expect(runtime.getSoul).toHaveBeenCalledWith('yuanxiao')

    await expect(
      getHandler(handlers, DESKTOP_IPC_CHANNELS.profileGetUser)(
        null,
        undefined,
      ),
    ).resolves.toEqual({
      content: '# User profile',
      updatedAt: '2026-07-08T00:00:00.000Z',
      version: 'sha256:user',
    })
    expect(runtime.getUserProfile).toHaveBeenCalledOnce()

    await expect(
      getHandler(handlers, DESKTOP_IPC_CHANNELS.profileUpdateSoul)(null, {
        agentId: 'yuanxiao',
        content: 'New soul',
        expectedVersion: 'sha256:old',
      }),
    ).resolves.toEqual({
      target: 'soul',
      status: 'updated',
      version: 'sha256:new-soul',
    })
    expect(runtime.updateSoul).toHaveBeenCalledWith(
      'yuanxiao',
      'New soul',
      'sha256:old',
    )

    await expect(
      getHandler(handlers, DESKTOP_IPC_CHANNELS.profileUpdateUser)(null, {
        content: 'New user profile',
        expectedVersion: 'sha256:old',
      }),
    ).resolves.toEqual({
      target: 'user',
      status: 'updated',
      version: 'sha256:new-user',
    })
    expect(runtime.updateUserProfile).toHaveBeenCalledWith(
      'New user profile',
      'sha256:old',
    )

    // Skills channel tests
    await expect(
      getHandler(handlers, DESKTOP_IPC_CHANNELS.skillsListAgent)(null, {
        agentId: 'agent-1',
      }),
    ).resolves.toEqual([
      {
        name: 'skill-1',
        description: 'A skill.',
        source: 'agent',
        path: '/path/SKILL.md',
        hasScripts: false,
      },
    ])
    expect(runtime.listAgentSkills).toHaveBeenCalledWith('agent-1')

    await expect(
      getHandler(handlers, DESKTOP_IPC_CHANNELS.skillsListShared)(
        null,
        undefined,
      ),
    ).resolves.toEqual([
      {
        name: 'shared-skill',
        description: 'A shared skill.',
        source: 'shared',
        path: '/skills/shared/SKILL.md',
        hasScripts: false,
      },
    ])
    expect(runtime.listSharedSkills).toHaveBeenCalledOnce()
  })

  it('rejects malformed IPC payloads before they reach the runtime', async () => {
    const handlers = new Map<DesktopIpcChannel, IpcHandler<DesktopIpcChannel>>()
    const ipcMain: IpcMainLike = {
      handle: vi.fn((channel, handler) => {
        handlers.set(channel, handler as IpcHandler<DesktopIpcChannel>)
      }) as IpcMainLike['handle'],
    }
    const snapshot = createMissingConfigurationSnapshot()
    const runtime: YuanxiaoRuntime = {
      getRuntimeSnapshot: vi.fn().mockResolvedValue(snapshot),
      refreshRuntime: vi.fn().mockResolvedValue(snapshot),
      saveRuntimeConfiguration: vi.fn().mockResolvedValue(snapshot),
      saveProvider: vi.fn().mockResolvedValue(snapshot),
      deleteProvider: vi.fn().mockResolvedValue(snapshot),
      cancelRuntimeConfigurationVerification: vi
        .fn()
        .mockResolvedValue(snapshot),
      listSessions: vi.fn().mockResolvedValue([]),
      resumeSession: vi.fn(),
      setLastActiveSession: vi.fn().mockResolvedValue(null),
      createSession: vi.fn(),
      getTranscript: vi.fn().mockResolvedValue({
        sessionId: 'session-1',
        agentId: 'yuanxiao',
        entries: [],
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
      sendMessage: vi.fn().mockResolvedValue({
        sessionId: 'session-1',
        agentId: 'yuanxiao',
        entries: [],
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
      retryMessage: vi.fn().mockResolvedValue({
        sessionId: 'session-1',
        agentId: 'yuanxiao',
        entries: [],
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
      forkSession: vi.fn(),
      archiveSession: vi.fn(),
      recoverSession: vi.fn(),
      deleteSession: vi.fn(),
      renameSession: vi.fn(),
      cancelRun: vi.fn(),
      subscribe: vi.fn(),
      cancelAllActiveRuns: vi.fn().mockResolvedValue(undefined),
      restoreFromBackup: vi.fn().mockResolvedValue(snapshot),
      resetConfiguration: vi.fn().mockResolvedValue(snapshot),
      listAgents: vi.fn().mockResolvedValue([]),
      createAgent: vi.fn(),
      updateAgentConfig: vi.fn().mockResolvedValue(snapshot.agents[0]),
      archiveAgent: vi.fn().mockResolvedValue(snapshot.agents[0]),
      recoverAgent: vi.fn().mockResolvedValue(snapshot.agents[0]),
      reconcileAgentDirectories: vi.fn().mockResolvedValue({
        agents: snapshot.agents,
        unclaimedDirectories: [],
      }),
      claimAgentDirectory: vi.fn().mockResolvedValue(snapshot.agents[0]),
      rebuildYuanxiaoHome: vi.fn().mockResolvedValue(snapshot.agents[0]),
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
      reloadAgentSessions: vi.fn().mockResolvedValue(undefined),
      reloadAllSessions: vi.fn().mockResolvedValue(undefined),
      installSkill: vi.fn().mockResolvedValue([]),
      deleteSkill: vi.fn().mockResolvedValue([]),
      getSkillInstallRecords: vi.fn().mockResolvedValue([]),
    }

    registerDesktopAppIpc(ipcMain, runtime)

    await expect(
      getHandler(handlers, DESKTOP_IPC_CHANNELS.sessionsCreate)(null, {
        agentId: 'yuanxiao',
        title: '   ',
      }),
    ).rejects.toThrow()
    expect(runtime.createSession).not.toHaveBeenCalled()

    await expect(
      getHandler(handlers, DESKTOP_IPC_CHANNELS.sessionsArchive)(null, {
        agentId: 'yuanxiao',
        sessionId: 'session-1',
      } as never),
    ).rejects.toThrow()
    expect(runtime.archiveSession).not.toHaveBeenCalled()
  })

  it('rejects malformed runtime responses before they cross IPC', async () => {
    const handlers = new Map<DesktopIpcChannel, IpcHandler<DesktopIpcChannel>>()
    const ipcMain: IpcMainLike = {
      handle: vi.fn((channel, handler) => {
        handlers.set(channel, handler as IpcHandler<DesktopIpcChannel>)
      }) as IpcMainLike['handle'],
    }
    const runtime = {
      getRuntimeSnapshot: vi.fn().mockResolvedValue({
        ...createMissingConfigurationSnapshot(),
        status: 'unexpected-status',
      }),
      refreshRuntime: vi.fn(),
      saveRuntimeConfiguration: vi.fn(),
      cancelRuntimeConfigurationVerification: vi.fn(),
      listSessions: vi.fn(),
      createSession: vi.fn(),
      sendMessage: vi.fn(),
      retryMessage: vi.fn().mockResolvedValue({
        sessionId: 'session-1',
        agentId: 'yuanxiao',
        entries: [],
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
      forkSession: vi.fn(),
      archiveSession: vi.fn(),
      recoverSession: vi.fn(),
      deleteSession: vi.fn(),
      cancelRun: vi.fn(),
      subscribe: vi.fn(),
      cancelAllActiveRuns: vi.fn(),
      installSkill: vi.fn(),
      deleteSkill: vi.fn(),
      getSkillInstallRecords: vi.fn(),
    } as unknown as YuanxiaoRuntime

    registerDesktopAppIpc(ipcMain, runtime)

    await expect(
      getHandler(handlers, DESKTOP_IPC_CHANNELS.runtimeGetSnapshot)(
        null,
        undefined,
      ),
    ).rejects.toThrow()
  })
})

/**
 * 从测试 handler 表中读取指定 channel 的 handler。
 *
 * @param handlers - registerDesktopAppIpc 写入的 handler 表。
 * @param channel - 需要读取的 IPC channel。
 * @returns 对应 channel 的类型化 handler。
 * @throws 当指定 channel 未注册时抛出错误。
 */
function getHandler<Channel extends DesktopIpcChannel>(
  handlers: Map<DesktopIpcChannel, IpcHandler<DesktopIpcChannel>>,
  channel: Channel,
): IpcHandler<Channel> {
  const handler = handlers.get(channel)

  if (!handler) {
    throw new Error(`未注册 IPC channel: ${channel}`)
  }

  return handler as unknown as IpcHandler<Channel>
}

/**
 * 创建 IPC 测试使用的缺配置运行时快照。
 *
 * @returns 一个默认 Agent 下缺少 Provider、Model 和 API Key 的 RuntimeSnapshot。
 * @throws 此测试辅助方法不会主动抛出错误。
 */
function createMissingConfigurationSnapshot(): RuntimeSnapshot {
  return createRuntimeSnapshot({
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
    providers: [],
    models: [],
    settings: {
      selectedProviderId: null,
      selectedModelId: null,
    },
    auth: {
      apiKey: {
        configured: false,
        maskedValue: null,
      },
    },
  })
}

/**
 * 创建 IPC 测试使用的会话摘要。
 *
 * @returns 默认 Agent 的空闲会话摘要。
 * @throws 此测试辅助方法不会主动抛出错误。
 */
function createSessionSummary(): AgentSessionSummary {
  return createDefaultSessionSummary({
    sessionId: 'session-1',
    title: '新会话',
    updatedAt: '2026-07-08T00:00:00.000Z',
  })
}

/**
 * 创建 IPC 测试使用的标准 attempt-started 事件。
 *
 * @returns 默认 Agent 下的 attempt-started 事件。
 * @throws 此测试辅助方法不会主动抛出错误。
 */
function createAttemptStartedEvent(): AgentEvent {
  return {
    type: 'attempt-started',
    agentId: YUANXIAO_DEFAULT_AGENT_ID,
    sessionId: 'session-1',
    runId: 'run-1',
    occurredAt: '2026-07-08T00:00:00.000Z',
  }
}
