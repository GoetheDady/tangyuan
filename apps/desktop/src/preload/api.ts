import {
  DESKTOP_AGENT_EVENT_CHANNEL,
  DESKTOP_IPC_CHANNELS,
  type AgentEventListener,
  type CancelRunRequest,
  type CreateSessionRequest,
  type DesktopIpcChannel,
  type DesktopIpcPayloadArgs,
  type DesktopIpcResponse,
  type DesktopPreloadApi,
  type GetSessionMessagesRequest,
  type RuntimeConfiguration,
  type CancelConfigurationVerificationRequest,
  type SendMessageRequest
} from '@tangyuan/contracts'

/**
 * 描述 Preload API 内部使用的 IPC 调用方法。
 */
export type IpcInvoke = <Channel extends DesktopIpcChannel>(
  channel: Channel,
  ...payload: DesktopIpcPayloadArgs<Channel>
) => Promise<DesktopIpcResponse<Channel>>

/**
 * 描述 Preload API 内部使用的 IPC 事件订阅方法。
 */
export type IpcSubscribe = (
  channel: typeof DESKTOP_AGENT_EVENT_CHANNEL,
  listener: AgentEventListener
) => () => void

/**
 * 创建暴露给 Renderer 的类型化桌面 API。
 *
 * @param invoke - 调用 Electron IPC 的窄函数。
 * @param subscribe - 订阅 Electron IPC 事件的窄函数。
 * @returns Renderer 可以通过 `window.api` 调用的 DesktopPreloadApi。
 * @throws 此方法不会主动抛出错误；具体 IPC 错误会在返回的 Promise 中 reject。
 */
export function createTangyuanPreloadApi(
  invoke: IpcInvoke,
  subscribe: IpcSubscribe = () => () => undefined
): DesktopPreloadApi {
  return {
    getRuntimeSnapshot: async () => {
      return invoke(DESKTOP_IPC_CHANNELS.runtimeGetSnapshot)
    },
    refreshRuntime: async () => {
      return invoke(DESKTOP_IPC_CHANNELS.runtimeRefresh)
    },
    saveRuntimeConfiguration: async (configuration: RuntimeConfiguration) => {
      return invoke(DESKTOP_IPC_CHANNELS.runtimeSaveConfiguration, configuration)
    },
    cancelRuntimeConfigurationVerification: async (
      request: CancelConfigurationVerificationRequest
    ) => {
      return invoke(DESKTOP_IPC_CHANNELS.runtimeCancelConfigurationVerification, request)
    },
    listSessions: async () => {
      return invoke(DESKTOP_IPC_CHANNELS.sessionsList)
    },
    createSession: async (request: CreateSessionRequest) => {
      return invoke(DESKTOP_IPC_CHANNELS.sessionsCreate, request)
    },
    getMessages: async (request: GetSessionMessagesRequest) => {
      return invoke(DESKTOP_IPC_CHANNELS.sessionsGetMessages, request)
    },
    sendMessage: async (request: SendMessageRequest) => {
      return invoke(DESKTOP_IPC_CHANNELS.sessionsSendMessage, request)
    },
    cancelRun: async (request: CancelRunRequest) => {
      return invoke(DESKTOP_IPC_CHANNELS.sessionsCancelRun, request)
    },
    subscribeToAgentEvents: (listener: AgentEventListener) => {
      return subscribe(DESKTOP_AGENT_EVENT_CHANNEL, listener)
    }
  }
}
