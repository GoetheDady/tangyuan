import {
  DESKTOP_IPC_CHANNELS,
  type DesktopIpcChannel,
  type DesktopIpcRequest,
  type DesktopIpcResponse
} from '@tangyuan/shared'
import type { DesktopAppStore } from './DesktopAppStore'

/**
 * 描述 DesktopAppStore IPC 注册所需的 Electron ipcMain 子集。
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
    handler: (
      event: unknown,
      payload: DesktopIpcRequest<Channel>
    ) => Promise<DesktopIpcResponse<Channel>>
  ): void
}

/**
 * 把允许的 IPC channel 连接到 DesktopAppStore。
 *
 * @param ipcMain - Electron ipcMain 或测试替身。
 * @param store - Main 侧应用状态中心。
 * @returns 无返回值。
 * @throws 当 ipcMain.handle 注册失败时可能抛出错误。
 */
export function registerDesktopAppIpc(ipcMain: IpcMainLike, store: DesktopAppStore): void {
  ipcMain.handle(DESKTOP_IPC_CHANNELS.runtimeGetSnapshot, async () => {
    return store.getRuntimeSnapshot()
  })
  ipcMain.handle(DESKTOP_IPC_CHANNELS.runtimeRefresh, async () => {
    return store.refreshRuntime()
  })
  ipcMain.handle(DESKTOP_IPC_CHANNELS.sessionsList, async () => {
    return store.listSessions()
  })
  ipcMain.handle(DESKTOP_IPC_CHANNELS.sessionsCreate, async (_event, payload) => {
    return store.createSession(payload)
  })
}
