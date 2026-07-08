import {
  DESKTOP_IPC_CHANNELS,
  TANGYUAN_DEFAULT_AGENT_ID,
  createDefaultSessionSummary,
  createRuntimeSnapshot,
  type AgentSessionSummary,
  type DesktopIpcChannel,
  type DesktopIpcRequest,
  type DesktopIpcResponse,
  type RuntimeSnapshot
} from '@tangyuan/shared'
import { describe, expect, it, vi } from 'vitest'
import type { DesktopAppStore } from './DesktopAppStore'
import { registerDesktopAppIpc, type IpcMainLike } from './ipc'

type IpcHandler<Channel extends DesktopIpcChannel> = (
  event: unknown,
  payload: DesktopIpcRequest<Channel>
) => Promise<DesktopIpcResponse<Channel>>

describe('registerDesktopAppIpc', () => {
  it('connects IPC channels to the DesktopAppStore methods', async () => {
    const handlers = new Map<DesktopIpcChannel, IpcHandler<DesktopIpcChannel>>()
    const ipcMain: IpcMainLike = {
      handle: vi.fn((channel, handler) => {
        handlers.set(channel, handler as IpcHandler<DesktopIpcChannel>)
      }) as IpcMainLike['handle']
    }
    const snapshot = createMissingConfigurationSnapshot()
    const session = createSessionSummary()
    const store: DesktopAppStore = {
      getRuntimeSnapshot: vi.fn().mockResolvedValue(snapshot),
      refreshRuntime: vi.fn().mockResolvedValue(snapshot),
      listSessions: vi.fn().mockResolvedValue([session]),
      createSession: vi.fn().mockResolvedValue(session)
    }

    registerDesktopAppIpc(ipcMain, store)

    expect(ipcMain.handle).toHaveBeenCalledTimes(4)
    await expect(
      getHandler(handlers, DESKTOP_IPC_CHANNELS.runtimeGetSnapshot)(null, undefined)
    ).resolves.toEqual(snapshot)
    await expect(
      getHandler(handlers, DESKTOP_IPC_CHANNELS.runtimeRefresh)(null, undefined)
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
    expect(store.createSession).toHaveBeenCalledWith({
      agentId: 'tangyuan',
      title: '新会话'
    })
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
