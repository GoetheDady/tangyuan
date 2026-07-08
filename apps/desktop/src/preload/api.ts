import {
  DESKTOP_IPC_CHANNELS,
  type CreateSessionRequest,
  type DesktopIpcChannel,
  type DesktopIpcPayloadArgs,
  type DesktopIpcResponse,
  type DesktopPreloadApi
} from '@tangyuan/shared'

/**
 * 描述 Preload API 内部使用的 IPC 调用方法。
 */
export type IpcInvoke = <Channel extends DesktopIpcChannel>(
  channel: Channel,
  ...payload: DesktopIpcPayloadArgs<Channel>
) => Promise<DesktopIpcResponse<Channel>>

/**
 * 创建暴露给 Renderer 的类型化桌面 API。
 *
 * @param invoke - 调用 Electron IPC 的窄函数。
 * @returns Renderer 可以通过 `window.api` 调用的 DesktopPreloadApi。
 * @throws 此方法不会主动抛出错误；具体 IPC 错误会在返回的 Promise 中 reject。
 */
export function createTangyuanPreloadApi(invoke: IpcInvoke): DesktopPreloadApi {
  return {
    getRuntimeSnapshot: async () => {
      return invoke(DESKTOP_IPC_CHANNELS.runtimeGetSnapshot)
    },
    refreshRuntime: async () => {
      return invoke(DESKTOP_IPC_CHANNELS.runtimeRefresh)
    },
    listSessions: async () => {
      return invoke(DESKTOP_IPC_CHANNELS.sessionsList)
    },
    createSession: async (request: CreateSessionRequest) => {
      return invoke(DESKTOP_IPC_CHANNELS.sessionsCreate, request)
    }
  }
}
