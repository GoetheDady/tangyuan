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
      sendMessage: vi.fn().mockResolvedValue([]),
      cancelRun: vi.fn().mockResolvedValue(session),
      subscribe: vi.fn(),
      cancelAllActiveRuns: vi.fn().mockResolvedValue(undefined)
    }
    const broadcastAgentEvent = vi.fn()
    runtime.subscribe = vi.fn((listener) => {
      listener(createTurnStartedEvent())

      return {
        unsubscribe: vi.fn()
      }
    })

    registerDesktopAppIpc(ipcMain, runtime, broadcastAgentEvent)

    expect(ipcMain.handle).toHaveBeenCalledTimes(9)
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
      sendMessage: vi.fn().mockResolvedValue([]),
      cancelRun: vi.fn(),
      subscribe: vi.fn(),
      cancelAllActiveRuns: vi.fn().mockResolvedValue(undefined)
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
      cancelAllActiveRuns: vi.fn()
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
