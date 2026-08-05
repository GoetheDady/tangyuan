import {
  DESKTOP_IPC_CHANNELS,
  parseDesktopIpcRequest,
  parseDesktopIpcResponse,
} from '@yuanxiao/contracts'
import type { YuanxiaoRuntime } from '@yuanxiao/agent-runtime'
import type { IpcMainLike } from './types'

/**
 * 注册 Runtime 相关 IPC handler（配置、Provider、快照）。
 */
export function registerRuntimeIpc(
  ipcMain: IpcMainLike,
  runtime: YuanxiaoRuntime,
): void {
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.runtimeGetSnapshot,
    async (_event, payload) => {
      parseDesktopIpcRequest(DESKTOP_IPC_CHANNELS.runtimeGetSnapshot, payload)
      return parseDesktopIpcResponse(
        DESKTOP_IPC_CHANNELS.runtimeGetSnapshot,
        await runtime.getRuntimeSnapshot(),
      )
    },
  )
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.runtimeRefresh,
    async (_event, payload) => {
      parseDesktopIpcRequest(DESKTOP_IPC_CHANNELS.runtimeRefresh, payload)
      return parseDesktopIpcResponse(
        DESKTOP_IPC_CHANNELS.runtimeRefresh,
        await runtime.refreshRuntime(),
      )
    },
  )
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.runtimeSaveConfiguration,
    async (_event, payload) => {
      return parseDesktopIpcResponse(
        DESKTOP_IPC_CHANNELS.runtimeSaveConfiguration,
        await runtime.saveRuntimeConfiguration(
          parseDesktopIpcRequest(
            DESKTOP_IPC_CHANNELS.runtimeSaveConfiguration,
            payload,
          ),
        ),
      )
    },
  )
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.runtimeCancelConfigurationVerification,
    async (_event, payload) => {
      return parseDesktopIpcResponse(
        DESKTOP_IPC_CHANNELS.runtimeCancelConfigurationVerification,
        await runtime.cancelRuntimeConfigurationVerification(
          parseDesktopIpcRequest(
            DESKTOP_IPC_CHANNELS.runtimeCancelConfigurationVerification,
            payload,
          ),
        ),
      )
    },
  )
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.runtimeSaveProvider,
    async (_event, payload) => {
      return parseDesktopIpcResponse(
        DESKTOP_IPC_CHANNELS.runtimeSaveProvider,
        await runtime.saveProvider(
          parseDesktopIpcRequest(
            DESKTOP_IPC_CHANNELS.runtimeSaveProvider,
            payload,
          ),
        ),
      )
    },
  )
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.runtimeDeleteProvider,
    async (_event, payload) => {
      return parseDesktopIpcResponse(
        DESKTOP_IPC_CHANNELS.runtimeDeleteProvider,
        await runtime.deleteProvider(
          parseDesktopIpcRequest(
            DESKTOP_IPC_CHANNELS.runtimeDeleteProvider,
            payload,
          ),
        ),
      )
    },
  )
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.runtimeRestoreFromBackup,
    async (_event, payload) => {
      parseDesktopIpcRequest(
        DESKTOP_IPC_CHANNELS.runtimeRestoreFromBackup,
        payload,
      )
      return parseDesktopIpcResponse(
        DESKTOP_IPC_CHANNELS.runtimeRestoreFromBackup,
        await runtime.restoreFromBackup(),
      )
    },
  )
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.runtimeResetConfiguration,
    async (_event, payload) => {
      parseDesktopIpcRequest(
        DESKTOP_IPC_CHANNELS.runtimeResetConfiguration,
        payload,
      )
      return parseDesktopIpcResponse(
        DESKTOP_IPC_CHANNELS.runtimeResetConfiguration,
        await runtime.resetConfiguration(),
      )
    },
  )
}
