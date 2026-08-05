import {
  DESKTOP_IPC_CHANNELS,
  parseDesktopIpcRequest,
  parseDesktopIpcResponse,
} from '@yuanxiao/contracts'
import type { YuanxiaoRuntime } from '@yuanxiao/agent-runtime'
import type { IpcMainLike } from './types'

/**
 * 注册 Agent 生命周期相关 IPC handler。
 */
export function registerAgentsIpc(
  ipcMain: IpcMainLike,
  runtime: YuanxiaoRuntime,
): void {
  ipcMain.handle(DESKTOP_IPC_CHANNELS.agentsList, async (_event, payload) => {
    parseDesktopIpcRequest(DESKTOP_IPC_CHANNELS.agentsList, payload)
    return parseDesktopIpcResponse(
      DESKTOP_IPC_CHANNELS.agentsList,
      await runtime.listAgents(),
    )
  })
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.agentsUpdateConfig,
    async (_event, payload) => {
      return parseDesktopIpcResponse(
        DESKTOP_IPC_CHANNELS.agentsUpdateConfig,
        await runtime.updateAgentConfig(
          parseDesktopIpcRequest(
            DESKTOP_IPC_CHANNELS.agentsUpdateConfig,
            payload,
          ),
        ),
      )
    },
  )
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.agentsArchive,
    async (_event, payload) => {
      const { agentId } = parseDesktopIpcRequest(
        DESKTOP_IPC_CHANNELS.agentsArchive,
        payload,
      )
      return parseDesktopIpcResponse(
        DESKTOP_IPC_CHANNELS.agentsArchive,
        await runtime.archiveAgent(agentId),
      )
    },
  )
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.agentsRecover,
    async (_event, payload) => {
      const { agentId } = parseDesktopIpcRequest(
        DESKTOP_IPC_CHANNELS.agentsRecover,
        payload,
      )
      return parseDesktopIpcResponse(
        DESKTOP_IPC_CHANNELS.agentsRecover,
        await runtime.recoverAgent(agentId),
      )
    },
  )
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.agentsReconcile,
    async (_event, payload) => {
      parseDesktopIpcRequest(DESKTOP_IPC_CHANNELS.agentsReconcile, payload)
      return parseDesktopIpcResponse(
        DESKTOP_IPC_CHANNELS.agentsReconcile,
        await runtime.reconcileAgentDirectories(),
      )
    },
  )
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.agentsClaimDirectory,
    async (_event, payload) => {
      const { agentId, displayName } = parseDesktopIpcRequest(
        DESKTOP_IPC_CHANNELS.agentsClaimDirectory,
        payload,
      )
      return parseDesktopIpcResponse(
        DESKTOP_IPC_CHANNELS.agentsClaimDirectory,
        await runtime.claimAgentDirectory(agentId, displayName),
      )
    },
  )
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.agentsRebuildYuanxiao,
    async (_event, payload) => {
      parseDesktopIpcRequest(
        DESKTOP_IPC_CHANNELS.agentsRebuildYuanxiao,
        payload,
      )
      return parseDesktopIpcResponse(
        DESKTOP_IPC_CHANNELS.agentsRebuildYuanxiao,
        await runtime.rebuildYuanxiaoHome(),
      )
    },
  )
}
