import {
  DESKTOP_IPC_CHANNELS,
  parseDesktopIpcRequest,
  parseDesktopIpcResponse,
} from '@yuanxiao/contracts'
import type { YuanxiaoRuntime } from '@yuanxiao/agent-runtime'
import type { IpcMainLike, OpenExternalLinkHandler } from './types'

/**
 * 注册 Skills 和外部链接相关 IPC handler。
 */
export function registerSkillsIpc(
  ipcMain: IpcMainLike,
  runtime: YuanxiaoRuntime,
  openExternalLink?: OpenExternalLinkHandler,
): void {
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.skillsListAgent,
    async (_event, payload) => {
      const { agentId } = parseDesktopIpcRequest(
        DESKTOP_IPC_CHANNELS.skillsListAgent,
        payload,
      )
      return parseDesktopIpcResponse(
        DESKTOP_IPC_CHANNELS.skillsListAgent,
        await runtime.listAgentSkills(agentId),
      )
    },
  )
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.skillsListShared,
    async (_event, payload) => {
      parseDesktopIpcRequest(DESKTOP_IPC_CHANNELS.skillsListShared, payload)
      return parseDesktopIpcResponse(
        DESKTOP_IPC_CHANNELS.skillsListShared,
        await runtime.listSharedSkills(),
      )
    },
  )
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.skillsInstall,
    async (_event, payload) => {
      return parseDesktopIpcResponse(
        DESKTOP_IPC_CHANNELS.skillsInstall,
        await runtime.installSkill(
          parseDesktopIpcRequest(DESKTOP_IPC_CHANNELS.skillsInstall, payload),
        ),
      )
    },
  )
  ipcMain.handle(DESKTOP_IPC_CHANNELS.skillsDelete, async (_event, payload) => {
    return parseDesktopIpcResponse(
      DESKTOP_IPC_CHANNELS.skillsDelete,
      await runtime.deleteSkill(
        parseDesktopIpcRequest(DESKTOP_IPC_CHANNELS.skillsDelete, payload),
      ),
    )
  })
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.skillsApproveOperation,
    async (_event, payload) => {
      const { approvalId } = parseDesktopIpcRequest(
        DESKTOP_IPC_CHANNELS.skillsApproveOperation,
        payload,
      )
      await runtime.approveSkillOperation(approvalId)
      return parseDesktopIpcResponse(
        DESKTOP_IPC_CHANNELS.skillsApproveOperation,
        undefined,
      )
    },
  )
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.skillsRejectOperation,
    async (_event, payload) => {
      const { approvalId } = parseDesktopIpcRequest(
        DESKTOP_IPC_CHANNELS.skillsRejectOperation,
        payload,
      )
      await runtime.rejectSkillOperation(approvalId)
      return parseDesktopIpcResponse(
        DESKTOP_IPC_CHANNELS.skillsRejectOperation,
        undefined,
      )
    },
  )
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.skillsGetPendingApprovals,
    async (_event, payload) => {
      parseDesktopIpcRequest(
        DESKTOP_IPC_CHANNELS.skillsGetPendingApprovals,
        payload,
      )
      return parseDesktopIpcResponse(
        DESKTOP_IPC_CHANNELS.skillsGetPendingApprovals,
        runtime.getPendingSkillApprovals(),
      )
    },
  )
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.skillsGetInstallRecords,
    async (_event, payload) => {
      parseDesktopIpcRequest(
        DESKTOP_IPC_CHANNELS.skillsGetInstallRecords,
        payload,
      )
      return parseDesktopIpcResponse(
        DESKTOP_IPC_CHANNELS.skillsGetInstallRecords,
        await runtime.getSkillInstallRecords(),
      )
    },
  )
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.openExternalLink,
    async (_event, payload) => {
      if (!openExternalLink) {
        throw new Error('外部链接功能不可用。')
      }
      const request = parseDesktopIpcRequest(
        DESKTOP_IPC_CHANNELS.openExternalLink,
        payload,
      )
      await openExternalLink(request.url)
      return parseDesktopIpcResponse(
        DESKTOP_IPC_CHANNELS.openExternalLink,
        undefined,
      )
    },
  )
}
