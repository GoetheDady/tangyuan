import {
  DESKTOP_IPC_CHANNELS,
  agentEventSchema,
  parseDesktopIpcRequest,
  parseDesktopIpcResponse,
  type AgentEvent,
  type DesktopIpcChannel,
  type DesktopIpcResponse
} from '@tangyuan/contracts'
import type { TangyuanRuntime } from '@tangyuan/agent-runtime'

/**
 * 描述 TangyuanRuntime IPC 注册所需的 Electron ipcMain 子集。
 */
export interface IpcMainLike {
  /**
   * 注册一个可被 Renderer invoke 的 IPC handler。
   *
   * @param channel - IPC channel 名称。
   * @param handler - 处理 Renderer 请求的异步方法。
   * @returns 无返回值。
   * @throws 当底层 Electron 注册失败时可能抛出错误。
   */
  handle<Channel extends DesktopIpcChannel>(
    channel: Channel,
    handler: (event: unknown, payload: unknown) => Promise<DesktopIpcResponse<Channel>>
  ): void
}

/**
 * 描述 Main 侧把 Agent 事件推送到 Renderer 的广播方法。
 */
export type AgentEventBroadcaster = (event: AgentEvent) => void

/**
 * 把允许的 IPC channel 连接到 TangyuanRuntime。
 *
 * @param ipcMain - Electron ipcMain 或测试替身。
 * @param runtime - Main 侧唯一运行时入口。
 * @param broadcastAgentEvent - 可选事件广播方法，用于推送 Agent 标准事件。
 * @returns 无返回值。
 * @throws 当 ipcMain.handle 注册失败时可能抛出错误。
 */
export function registerDesktopAppIpc(
  ipcMain: IpcMainLike,
  runtime: TangyuanRuntime,
  broadcastAgentEvent?: AgentEventBroadcaster
): void {
  if (broadcastAgentEvent) {
    runtime.subscribe((event) => {
      broadcastAgentEvent(agentEventSchema.parse(event))
    })
  }

  ipcMain.handle(DESKTOP_IPC_CHANNELS.runtimeGetSnapshot, async (_event, payload) => {
    parseDesktopIpcRequest(DESKTOP_IPC_CHANNELS.runtimeGetSnapshot, payload)
    return parseDesktopIpcResponse(
      DESKTOP_IPC_CHANNELS.runtimeGetSnapshot,
      await runtime.getRuntimeSnapshot()
    )
  })
  ipcMain.handle(DESKTOP_IPC_CHANNELS.runtimeRefresh, async (_event, payload) => {
    parseDesktopIpcRequest(DESKTOP_IPC_CHANNELS.runtimeRefresh, payload)
    return parseDesktopIpcResponse(
      DESKTOP_IPC_CHANNELS.runtimeRefresh,
      await runtime.refreshRuntime()
    )
  })
  ipcMain.handle(DESKTOP_IPC_CHANNELS.runtimeSaveConfiguration, async (_event, payload) => {
    return parseDesktopIpcResponse(
      DESKTOP_IPC_CHANNELS.runtimeSaveConfiguration,
      await runtime.saveRuntimeConfiguration(
        parseDesktopIpcRequest(DESKTOP_IPC_CHANNELS.runtimeSaveConfiguration, payload)
      )
    )
  })
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.runtimeCancelConfigurationVerification,
    async (_event, payload) => {
      return parseDesktopIpcResponse(
        DESKTOP_IPC_CHANNELS.runtimeCancelConfigurationVerification,
        await runtime.cancelRuntimeConfigurationVerification(
          parseDesktopIpcRequest(
            DESKTOP_IPC_CHANNELS.runtimeCancelConfigurationVerification,
            payload
          )
        )
      )
    }
  )
  ipcMain.handle(DESKTOP_IPC_CHANNELS.sessionsList, async (_event, payload) => {
    parseDesktopIpcRequest(DESKTOP_IPC_CHANNELS.sessionsList, payload)
    return parseDesktopIpcResponse(DESKTOP_IPC_CHANNELS.sessionsList, await runtime.listSessions())
  })
  ipcMain.handle(DESKTOP_IPC_CHANNELS.sessionsCreate, async (_event, payload) => {
    return parseDesktopIpcResponse(
      DESKTOP_IPC_CHANNELS.sessionsCreate,
      await runtime.createSession(
        parseDesktopIpcRequest(DESKTOP_IPC_CHANNELS.sessionsCreate, payload)
      )
    )
  })
  ipcMain.handle(DESKTOP_IPC_CHANNELS.sessionsGetMessages, async (_event, payload) => {
    return parseDesktopIpcResponse(
      DESKTOP_IPC_CHANNELS.sessionsGetMessages,
      await runtime.getMessages(
        parseDesktopIpcRequest(DESKTOP_IPC_CHANNELS.sessionsGetMessages, payload)
      )
    )
  })
  ipcMain.handle(DESKTOP_IPC_CHANNELS.sessionsSendMessage, async (_event, payload) => {
    return parseDesktopIpcResponse(
      DESKTOP_IPC_CHANNELS.sessionsSendMessage,
      await runtime.sendMessage(
        parseDesktopIpcRequest(DESKTOP_IPC_CHANNELS.sessionsSendMessage, payload)
      )
    )
  })
  ipcMain.handle(DESKTOP_IPC_CHANNELS.sessionsCancelRun, async (_event, payload) => {
    return parseDesktopIpcResponse(
      DESKTOP_IPC_CHANNELS.sessionsCancelRun,
      await runtime.cancelRun(
        parseDesktopIpcRequest(DESKTOP_IPC_CHANNELS.sessionsCancelRun, payload)
      )
    )
  })
}
