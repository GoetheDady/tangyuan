import {
  DESKTOP_IPC_CHANNELS,
  type AgentEvent,
  TANGYUAN_DEFAULT_AGENT_ID,
  createDefaultSessionSummary,
  createRuntimeSnapshot,
  type AgentSessionSummary,
  type DesktopIpcChannel,
  type DesktopIpcRequest,
  type DesktopIpcResponse,
  type RuntimeSnapshot
} from '@tangyuan/contracts'
import { describe, expect, it, vi } from 'vitest'
import type { TangyuanRuntime } from '@tangyuan/agent-runtime'
import { registerDesktopAppIpc, type IpcMainLike } from './ipc'

type IpcHandler<Channel extends DesktopIpcChannel> = (
  event: unknown,
  payload: DesktopIpcRequest<Channel>
) => Promise<DesktopIpcResponse<Channel>>

describe('registerDesktopAppIpc', () => {
  it('connects IPC channels to the TangyuanRuntime methods', async () => {
    const handlers = new Map<DesktopIpcChannel, IpcHandler<DesktopIpcChannel>>()
    const ipcMain: IpcMainLike = {
      handle: vi.fn((channel, handler) => {
        handlers.set(channel, handler as IpcHandler<DesktopIpcChannel>)
      }) as IpcMainLike['handle']
    }
    const snapshot = createMissingConfigurationSnapshot()
    const session = createSessionSummary()
    const runtime: TangyuanRuntime = {
      getRuntimeSnapshot: vi.fn().mockResolvedValue(snapshot),
      refreshRuntime: vi.fn().mockResolvedValue(snapshot),
      saveRuntimeConfiguration: vi.fn().mockResolvedValue(snapshot),
      cancelRuntimeConfigurationVerification: vi.fn().mockResolvedValue(snapshot),
      listSessions: vi.fn().mockResolvedValue([session]),
      createSession: vi.fn().mockResolvedValue(session),
      getMessages: vi.fn().mockResolvedValue([]),
      getTranscript: vi.fn().mockResolvedValue({
        sessionId: 'session-1',
        agentId: 'tangyuan',
        entries: [],
        updatedAt: '2026-01-01T00:00:00.000Z'
      }),
      sendMessage: vi.fn().mockResolvedValue([]),
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
      reconcileAgentDirectories: vi
        .fn()
        .mockResolvedValue({ agents: snapshot.agents, unclaimedDirectories: [] }),
      claimAgentDirectory: vi.fn().mockResolvedValue(snapshot.agents[0]),
      rebuildTangyuanHome: vi.fn().mockResolvedValue(snapshot.agents[0]),
      getSessionModelInfo: vi.fn().mockResolvedValue({
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        displayName: 'Claude Sonnet 4.5',
        thinkingLevel: null,
        supportedThinkingLevels: [],
        supportsThinking: false
      }),
      setSessionModel: vi.fn().mockResolvedValue({
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        displayName: 'Claude Sonnet 4.5',
        thinkingLevel: null,
        supportedThinkingLevels: [],
        supportsThinking: false
      }),
      setSessionThinkingLevel: vi.fn().mockResolvedValue({
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        displayName: 'Claude Sonnet 4.5',
        thinkingLevel: 'medium',
        supportedThinkingLevels: ['low', 'medium', 'high'],
        supportsThinking: true
      }),
      getSoul: vi.fn().mockResolvedValue({
        agentId: 'tangyuan',
        content: '# Soul content',
        updatedAt: '2026-07-08T00:00:00.000Z'
      }),
      getUserProfile: vi.fn().mockResolvedValue({
        content: '# User profile',
        updatedAt: '2026-07-08T00:00:00.000Z'
      }),
      updateSoul: vi.fn().mockResolvedValue({
        target: 'soul',
        success: true
      }),
      updateUserProfile: vi.fn().mockResolvedValue({
        target: 'user',
        success: true
      }),
      reloadAgentSessions: vi.fn().mockResolvedValue(undefined),
      reloadAllSessions: vi.fn().mockResolvedValue(undefined),
      listAgentSkills: vi.fn().mockResolvedValue([
        {
          name: 'skill-1',
          description: 'A skill.',
          source: 'agent',
          path: '/path/SKILL.md',
          hasScripts: false
        }
      ]),
      listSharedSkills: vi.fn().mockResolvedValue([
        {
          name: 'shared-skill',
          description: 'A shared skill.',
          source: 'shared',
          path: '/skills/shared/SKILL.md',
          hasScripts: false
        }
      ]),
      approveBash: vi.fn().mockResolvedValue(undefined),
      rejectBash: vi.fn().mockResolvedValue(undefined),
      getPendingApprovals: vi.fn().mockReturnValue([]),
      createToolApprovalGateway: vi.fn(),
      installSkill: vi.fn().mockResolvedValue([]),
      deleteSkill: vi.fn().mockResolvedValue([]),
      approveSkillOperation: vi.fn().mockResolvedValue(undefined),
      rejectSkillOperation: vi.fn().mockResolvedValue(undefined),
      getPendingSkillApprovals: vi.fn().mockReturnValue([]),
      getSkillInstallRecords: vi.fn().mockResolvedValue([])
    }
    const broadcastAgentEvent = vi.fn()
    const openExternalLink = vi.fn().mockResolvedValue(undefined)
    runtime.subscribe = vi.fn((listener) => {
      listener(createTurnStartedEvent())

      return {
        unsubscribe: vi.fn()
      }
    })

    registerDesktopAppIpc(ipcMain, runtime, broadcastAgentEvent, openExternalLink)

    expect(ipcMain.handle).toHaveBeenCalledTimes(38)
    expect(broadcastAgentEvent).toHaveBeenCalledWith(createTurnStartedEvent())
    await expect(
      getHandler(handlers, DESKTOP_IPC_CHANNELS.runtimeGetSnapshot)(null, undefined)
    ).resolves.toEqual(snapshot)
    await expect(
      getHandler(handlers, DESKTOP_IPC_CHANNELS.runtimeRefresh)(null, undefined)
    ).resolves.toEqual(snapshot)
    await expect(
      getHandler(handlers, DESKTOP_IPC_CHANNELS.runtimeSaveConfiguration)(null, {
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        apiKey: 'sk-test-secret-7890'
      })
    ).resolves.toEqual(snapshot)
    await expect(
      getHandler(handlers, DESKTOP_IPC_CHANNELS.runtimeCancelConfigurationVerification)(null, {
        verificationId: 'verify-1'
      })
    ).resolves.toEqual(snapshot)
    await expect(
      getHandler(handlers, DESKTOP_IPC_CHANNELS.sessionsList)(null, undefined)
    ).resolves.toEqual([session])
    await expect(
      getHandler(handlers, DESKTOP_IPC_CHANNELS.sessionsCreate)(null, {
        agentId: 'tangyuan',
        title: '新会话'
      })
    ).resolves.toEqual(session)
    await expect(
      getHandler(handlers, DESKTOP_IPC_CHANNELS.sessionsGetMessages)(null, {
        agentId: 'tangyuan',
        sessionId: 'session-1'
      })
    ).resolves.toEqual([])
    await expect(
      getHandler(handlers, DESKTOP_IPC_CHANNELS.sessionsSendMessage)(null, {
        agentId: 'tangyuan',
        sessionId: 'session-1',
        content: '你好'
      })
    ).resolves.toEqual([])
    await expect(
      getHandler(handlers, DESKTOP_IPC_CHANNELS.sessionsCancelRun)(null, {
        agentId: 'tangyuan',
        sessionId: 'session-1'
      })
    ).resolves.toEqual(session)
    await expect(
      getHandler(handlers, DESKTOP_IPC_CHANNELS.openExternalLink)(null, {
        url: 'https://example.com'
      })
    ).resolves.toBeUndefined()
    expect(openExternalLink).toHaveBeenCalledWith('https://example.com')
    expect(runtime.createSession).toHaveBeenCalledWith({
      agentId: 'tangyuan',
      title: '新会话'
    })
    expect(runtime.saveRuntimeConfiguration).toHaveBeenCalledWith({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890'
    })
    expect(runtime.cancelRuntimeConfigurationVerification).toHaveBeenCalledWith({
      verificationId: 'verify-1'
    })
    expect(runtime.getMessages).toHaveBeenCalledWith({
      agentId: 'tangyuan',
      sessionId: 'session-1'
    })
    expect(runtime.sendMessage).toHaveBeenCalledWith({
      agentId: 'tangyuan',
      sessionId: 'session-1',
      content: '你好'
    })
    expect(runtime.cancelRun).toHaveBeenCalledWith({
      agentId: 'tangyuan',
      sessionId: 'session-1'
    })

    // Profile channel tests
    await expect(
      getHandler(handlers, DESKTOP_IPC_CHANNELS.profileGetSoul)(null, {
        agentId: 'tangyuan'
      })
    ).resolves.toEqual({
      agentId: 'tangyuan',
      content: '# Soul content',
      updatedAt: '2026-07-08T00:00:00.000Z'
    })
    expect(runtime.getSoul).toHaveBeenCalledWith('tangyuan')

    await expect(
      getHandler(handlers, DESKTOP_IPC_CHANNELS.profileGetUser)(null, undefined)
    ).resolves.toEqual({
      content: '# User profile',
      updatedAt: '2026-07-08T00:00:00.000Z'
    })
    expect(runtime.getUserProfile).toHaveBeenCalledOnce()

    await expect(
      getHandler(handlers, DESKTOP_IPC_CHANNELS.profileUpdateSoul)(null, {
        agentId: 'tangyuan',
        content: 'New soul'
      })
    ).resolves.toEqual({ target: 'soul', success: true })
    expect(runtime.updateSoul).toHaveBeenCalledWith('tangyuan', 'New soul')

    await expect(
      getHandler(handlers, DESKTOP_IPC_CHANNELS.profileUpdateUser)(null, {
        content: 'New user profile'
      })
    ).resolves.toEqual({ target: 'user', success: true })
    expect(runtime.updateUserProfile).toHaveBeenCalledWith('New user profile')

    // Skills channel tests
    await expect(
      getHandler(handlers, DESKTOP_IPC_CHANNELS.skillsListAgent)(null, {
        agentId: 'agent-1'
      })
    ).resolves.toEqual([
      {
        name: 'skill-1',
        description: 'A skill.',
        source: 'agent',
        path: '/path/SKILL.md',
        hasScripts: false
      }
    ])
    expect(runtime.listAgentSkills).toHaveBeenCalledWith('agent-1')

    await expect(
      getHandler(handlers, DESKTOP_IPC_CHANNELS.skillsListShared)(null, undefined)
    ).resolves.toEqual([
      {
        name: 'shared-skill',
        description: 'A shared skill.',
        source: 'shared',
        path: '/skills/shared/SKILL.md',
        hasScripts: false
      }
    ])
    expect(runtime.listSharedSkills).toHaveBeenCalledOnce()
  })

  it('rejects malformed IPC payloads before they reach the runtime', async () => {
    const handlers = new Map<DesktopIpcChannel, IpcHandler<DesktopIpcChannel>>()
    const ipcMain: IpcMainLike = {
      handle: vi.fn((channel, handler) => {
        handlers.set(channel, handler as IpcHandler<DesktopIpcChannel>)
      }) as IpcMainLike['handle']
    }
    const snapshot = createMissingConfigurationSnapshot()
    const runtime: TangyuanRuntime = {
      getRuntimeSnapshot: vi.fn().mockResolvedValue(snapshot),
      refreshRuntime: vi.fn().mockResolvedValue(snapshot),
      saveRuntimeConfiguration: vi.fn().mockResolvedValue(snapshot),
      cancelRuntimeConfigurationVerification: vi.fn().mockResolvedValue(snapshot),
      listSessions: vi.fn().mockResolvedValue([]),
      createSession: vi.fn(),
      getMessages: vi.fn().mockResolvedValue([]),
      getTranscript: vi.fn().mockResolvedValue({
        sessionId: 'session-1',
        agentId: 'tangyuan',
        entries: [],
        updatedAt: '2026-01-01T00:00:00.000Z'
      }),
      sendMessage: vi.fn().mockResolvedValue([]),
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
      reconcileAgentDirectories: vi
        .fn()
        .mockResolvedValue({ agents: snapshot.agents, unclaimedDirectories: [] }),
      claimAgentDirectory: vi.fn().mockResolvedValue(snapshot.agents[0]),
      rebuildTangyuanHome: vi.fn().mockResolvedValue(snapshot.agents[0]),
      getSessionModelInfo: vi.fn().mockResolvedValue({
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        displayName: 'Claude Sonnet 4.5',
        thinkingLevel: null,
        supportedThinkingLevels: [],
        supportsThinking: false
      }),
      setSessionModel: vi.fn().mockResolvedValue({
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        displayName: 'Claude Sonnet 4.5',
        thinkingLevel: null,
        supportedThinkingLevels: [],
        supportsThinking: false
      }),
      setSessionThinkingLevel: vi.fn().mockResolvedValue({
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        displayName: 'Claude Sonnet 4.5',
        thinkingLevel: 'medium',
        supportedThinkingLevels: ['low', 'medium', 'high'],
        supportsThinking: true
      }),
      getSoul: vi.fn().mockResolvedValue({
        agentId: 'tangyuan',
        content: '',
        updatedAt: ''
      }),
      getUserProfile: vi.fn().mockResolvedValue({
        content: '',
        updatedAt: ''
      }),
      updateSoul: vi.fn().mockResolvedValue({
        target: 'soul' as const,
        success: true
      }),
      updateUserProfile: vi.fn().mockResolvedValue({
        target: 'user' as const,
        success: true
      }),
      listAgentSkills: vi.fn().mockResolvedValue([]),
      listSharedSkills: vi.fn().mockResolvedValue([]),
      reloadAgentSessions: vi.fn().mockResolvedValue(undefined),
      reloadAllSessions: vi.fn().mockResolvedValue(undefined),
      approveBash: vi.fn().mockResolvedValue(undefined),
      rejectBash: vi.fn().mockResolvedValue(undefined),
      getPendingApprovals: vi.fn().mockReturnValue([]),
      createToolApprovalGateway: vi.fn(),
      installSkill: vi.fn().mockResolvedValue([]),
      deleteSkill: vi.fn().mockResolvedValue([]),
      approveSkillOperation: vi.fn().mockResolvedValue(undefined),
      rejectSkillOperation: vi.fn().mockResolvedValue(undefined),
      getPendingSkillApprovals: vi.fn().mockReturnValue([]),
      getSkillInstallRecords: vi.fn().mockResolvedValue([])
    }

    registerDesktopAppIpc(ipcMain, runtime)

    await expect(
      getHandler(handlers, DESKTOP_IPC_CHANNELS.sessionsCreate)(null, {
        agentId: 'tangyuan',
        title: '   '
      })
    ).rejects.toThrow()
    expect(runtime.createSession).not.toHaveBeenCalled()
  })

  it('rejects malformed runtime responses before they cross IPC', async () => {
    const handlers = new Map<DesktopIpcChannel, IpcHandler<DesktopIpcChannel>>()
    const ipcMain: IpcMainLike = {
      handle: vi.fn((channel, handler) => {
        handlers.set(channel, handler as IpcHandler<DesktopIpcChannel>)
      }) as IpcMainLike['handle']
    }
    const runtime = {
      getRuntimeSnapshot: vi.fn().mockResolvedValue({
        ...createMissingConfigurationSnapshot(),
        status: 'unexpected-status'
      }),
      refreshRuntime: vi.fn(),
      saveRuntimeConfiguration: vi.fn(),
      cancelRuntimeConfigurationVerification: vi.fn(),
      listSessions: vi.fn(),
      createSession: vi.fn(),
      getMessages: vi.fn(),
      sendMessage: vi.fn(),
      cancelRun: vi.fn(),
      subscribe: vi.fn(),
      cancelAllActiveRuns: vi.fn(),
      approveBash: vi.fn(),
      rejectBash: vi.fn(),
      getPendingApprovals: vi.fn(),
      createToolApprovalGateway: vi.fn(),
      installSkill: vi.fn(),
      deleteSkill: vi.fn(),
      approveSkillOperation: vi.fn(),
      rejectSkillOperation: vi.fn(),
      getPendingSkillApprovals: vi.fn(),
      getSkillInstallRecords: vi.fn()
    } as unknown as TangyuanRuntime

    registerDesktopAppIpc(ipcMain, runtime)

    await expect(
      getHandler(handlers, DESKTOP_IPC_CHANNELS.runtimeGetSnapshot)(null, undefined)
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
  channel: Channel
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
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      displayName: '汤圆',
      homePath: '~/.tangyuan/agents/tangyuan',
      profile: {
        initialized: false,
        bootstrapRequired: true,
        soulUpdatedAt: null,
        userUpdatedAt: null
      }
    },
    providers: [],
    models: [],
    settings: {
      selectedProviderId: null,
      selectedModelId: null
    },
    auth: {
      apiKey: {
        configured: false,
        maskedValue: null
      }
    }
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
    updatedAt: '2026-07-08T00:00:00.000Z'
  })
}

/**
 * 创建 IPC 测试使用的标准 turn-started 事件。
 *
 * @returns 默认 Agent 下的 turn-started 事件。
 * @throws 此测试辅助方法不会主动抛出错误。
 */
function createTurnStartedEvent(): AgentEvent {
  return {
    type: 'turn-started',
    agentId: TANGYUAN_DEFAULT_AGENT_ID,
    sessionId: 'session-1',
    runId: 'run-1',
    occurredAt: '2026-07-08T00:00:00.000Z'
  }
}
