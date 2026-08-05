import {
  DESKTOP_IPC_CHANNELS,
  parseDesktopIpcRequest,
  parseDesktopIpcResponse,
} from '@yuanxiao/contracts'
import type { YuanxiaoRuntime } from '@yuanxiao/agent-runtime'
import type { IpcMainLike } from './types'

/**
 * 注册 Profile（灵魂与用户画像）相关 IPC handler。
 */
export function registerProfileIpc(
  ipcMain: IpcMainLike,
  runtime: YuanxiaoRuntime,
): void {
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.profileGetSoul,
    async (_event, payload) => {
      const { agentId } = parseDesktopIpcRequest(
        DESKTOP_IPC_CHANNELS.profileGetSoul,
        payload,
      )
      return parseDesktopIpcResponse(
        DESKTOP_IPC_CHANNELS.profileGetSoul,
        await runtime.getSoul(agentId),
      )
    },
  )
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.profileGetUser,
    async (_event, payload) => {
      parseDesktopIpcRequest(DESKTOP_IPC_CHANNELS.profileGetUser, payload)
      return parseDesktopIpcResponse(
        DESKTOP_IPC_CHANNELS.profileGetUser,
        await runtime.getUserProfile(),
      )
    },
  )
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.profileUpdateSoul,
    async (_event, payload) => {
      const { agentId, content, expectedVersion } = parseDesktopIpcRequest(
        DESKTOP_IPC_CHANNELS.profileUpdateSoul,
        payload,
      )
      return parseDesktopIpcResponse(
        DESKTOP_IPC_CHANNELS.profileUpdateSoul,
        await runtime.updateSoul(agentId, content, expectedVersion),
      )
    },
  )
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.profileUpdateUser,
    async (_event, payload) => {
      const { content, expectedVersion } = parseDesktopIpcRequest(
        DESKTOP_IPC_CHANNELS.profileUpdateUser,
        payload,
      )
      return parseDesktopIpcResponse(
        DESKTOP_IPC_CHANNELS.profileUpdateUser,
        await runtime.updateUserProfile(content, expectedVersion),
      )
    },
  )
}
