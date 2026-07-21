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
 * 描述 Main 侧安全打开外部链接的方法签名。
 */
export type OpenExternalLinkHandler = (url: string) => Promise<void>

/**
 * 把允许的 IPC channel 连接到 TangyuanRuntime。
 *
 * @param ipcMain - Electron ipcMain 或测试替身。
 * @param runtime - Main 侧唯一运行时入口。
 * @param broadcastAgentEvent - 可选事件广播方法，用于推送 Agent 标准事件。
 * @param openExternalLink - 可选外部链接处理方法，用于安全打开系统浏览器。
 * @returns 无返回值。
 * @throws 当 ipcMain.handle 注册失败时可能抛出错误。
 */
export function registerDesktopAppIpc(
  ipcMain: IpcMainLike,
  runtime: TangyuanRuntime,
  broadcastAgentEvent?: AgentEventBroadcaster,
  openExternalLink?: OpenExternalLinkHandler
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
  ipcMain.handle(DESKTOP_IPC_CHANNELS.sessionsGetTranscript, async (_event, payload) => {
    return parseDesktopIpcResponse(
      DESKTOP_IPC_CHANNELS.sessionsGetTranscript,
      await runtime.getTranscript(
        parseDesktopIpcRequest(DESKTOP_IPC_CHANNELS.sessionsGetTranscript, payload)
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
  ipcMain.handle(DESKTOP_IPC_CHANNELS.agentsList, async (_event, payload) => {
    parseDesktopIpcRequest(DESKTOP_IPC_CHANNELS.agentsList, payload)
    return parseDesktopIpcResponse(DESKTOP_IPC_CHANNELS.agentsList, await runtime.listAgents())
  })
  ipcMain.handle(DESKTOP_IPC_CHANNELS.agentsUpdateConfig, async (_event, payload) => {
    return parseDesktopIpcResponse(
      DESKTOP_IPC_CHANNELS.agentsUpdateConfig,
      await runtime.updateAgentConfig(
        parseDesktopIpcRequest(DESKTOP_IPC_CHANNELS.agentsUpdateConfig, payload)
      )
    )
  })
  ipcMain.handle(DESKTOP_IPC_CHANNELS.agentsArchive, async (_event, payload) => {
    const { agentId } = parseDesktopIpcRequest(DESKTOP_IPC_CHANNELS.agentsArchive, payload)
    return parseDesktopIpcResponse(
      DESKTOP_IPC_CHANNELS.agentsArchive,
      await runtime.archiveAgent(agentId)
    )
  })
  ipcMain.handle(DESKTOP_IPC_CHANNELS.agentsRecover, async (_event, payload) => {
    const { agentId } = parseDesktopIpcRequest(DESKTOP_IPC_CHANNELS.agentsRecover, payload)
    return parseDesktopIpcResponse(
      DESKTOP_IPC_CHANNELS.agentsRecover,
      await runtime.recoverAgent(agentId)
    )
  })
  ipcMain.handle(DESKTOP_IPC_CHANNELS.agentsReconcile, async (_event, payload) => {
    parseDesktopIpcRequest(DESKTOP_IPC_CHANNELS.agentsReconcile, payload)
    return parseDesktopIpcResponse(
      DESKTOP_IPC_CHANNELS.agentsReconcile,
      await runtime.reconcileAgentDirectories()
    )
  })
  ipcMain.handle(DESKTOP_IPC_CHANNELS.agentsClaimDirectory, async (_event, payload) => {
    const { agentId, displayName } = parseDesktopIpcRequest(
      DESKTOP_IPC_CHANNELS.agentsClaimDirectory,
      payload
    )
    return parseDesktopIpcResponse(
      DESKTOP_IPC_CHANNELS.agentsClaimDirectory,
      await runtime.claimAgentDirectory(agentId, displayName)
    )
  })
  ipcMain.handle(DESKTOP_IPC_CHANNELS.agentsRebuildTangyuan, async (_event, payload) => {
    parseDesktopIpcRequest(DESKTOP_IPC_CHANNELS.agentsRebuildTangyuan, payload)
    return parseDesktopIpcResponse(
      DESKTOP_IPC_CHANNELS.agentsRebuildTangyuan,
      await runtime.rebuildTangyuanHome()
    )
  })
  ipcMain.handle(DESKTOP_IPC_CHANNELS.sessionsGetModelInfo, async (_event, payload) => {
    return parseDesktopIpcResponse(
      DESKTOP_IPC_CHANNELS.sessionsGetModelInfo,
      await runtime.getSessionModelInfo(
        parseDesktopIpcRequest(DESKTOP_IPC_CHANNELS.sessionsGetModelInfo, payload)
      )
    )
  })
  ipcMain.handle(DESKTOP_IPC_CHANNELS.sessionsSetModel, async (_event, payload) => {
    return parseDesktopIpcResponse(
      DESKTOP_IPC_CHANNELS.sessionsSetModel,
      await runtime.setSessionModel(
        parseDesktopIpcRequest(DESKTOP_IPC_CHANNELS.sessionsSetModel, payload)
      )
    )
  })
  ipcMain.handle(DESKTOP_IPC_CHANNELS.sessionsSetThinkingLevel, async (_event, payload) => {
    return parseDesktopIpcResponse(
      DESKTOP_IPC_CHANNELS.sessionsSetThinkingLevel,
      await runtime.setSessionThinkingLevel(
        parseDesktopIpcRequest(DESKTOP_IPC_CHANNELS.sessionsSetThinkingLevel, payload)
      )
    )
  })
  ipcMain.handle(DESKTOP_IPC_CHANNELS.runtimeRestoreFromBackup, async (_event, payload) => {
    parseDesktopIpcRequest(DESKTOP_IPC_CHANNELS.runtimeRestoreFromBackup, payload)
    return parseDesktopIpcResponse(
      DESKTOP_IPC_CHANNELS.runtimeRestoreFromBackup,
      await runtime.restoreFromBackup()
    )
  })
  ipcMain.handle(DESKTOP_IPC_CHANNELS.runtimeResetConfiguration, async (_event, payload) => {
    parseDesktopIpcRequest(DESKTOP_IPC_CHANNELS.runtimeResetConfiguration, payload)
    return parseDesktopIpcResponse(
      DESKTOP_IPC_CHANNELS.runtimeResetConfiguration,
      await runtime.resetConfiguration()
    )
  })
  ipcMain.handle(DESKTOP_IPC_CHANNELS.profileGetSoul, async (_event, payload) => {
    const { agentId } = parseDesktopIpcRequest(DESKTOP_IPC_CHANNELS.profileGetSoul, payload)
    return parseDesktopIpcResponse(
      DESKTOP_IPC_CHANNELS.profileGetSoul,
      await runtime.getSoul(agentId)
    )
  })
  ipcMain.handle(DESKTOP_IPC_CHANNELS.profileGetUser, async (_event, payload) => {
    parseDesktopIpcRequest(DESKTOP_IPC_CHANNELS.profileGetUser, payload)
    return parseDesktopIpcResponse(
      DESKTOP_IPC_CHANNELS.profileGetUser,
      await runtime.getUserProfile()
    )
  })
  ipcMain.handle(DESKTOP_IPC_CHANNELS.profileUpdateSoul, async (_event, payload) => {
    const { agentId, content } = parseDesktopIpcRequest(
      DESKTOP_IPC_CHANNELS.profileUpdateSoul,
      payload
    )
    return parseDesktopIpcResponse(
      DESKTOP_IPC_CHANNELS.profileUpdateSoul,
      await runtime.updateSoul(agentId, content)
    )
  })
  ipcMain.handle(DESKTOP_IPC_CHANNELS.profileUpdateUser, async (_event, payload) => {
    const { content } = parseDesktopIpcRequest(DESKTOP_IPC_CHANNELS.profileUpdateUser, payload)
    return parseDesktopIpcResponse(
      DESKTOP_IPC_CHANNELS.profileUpdateUser,
      await runtime.updateUserProfile(content)
    )
  })
  ipcMain.handle(DESKTOP_IPC_CHANNELS.skillsListAgent, async (_event, payload) => {
    const { agentId } = parseDesktopIpcRequest(DESKTOP_IPC_CHANNELS.skillsListAgent, payload)
    return parseDesktopIpcResponse(
      DESKTOP_IPC_CHANNELS.skillsListAgent,
      await runtime.listAgentSkills(agentId)
    )
  })
  ipcMain.handle(DESKTOP_IPC_CHANNELS.skillsListShared, async (_event, payload) => {
    parseDesktopIpcRequest(DESKTOP_IPC_CHANNELS.skillsListShared, payload)
    return parseDesktopIpcResponse(
      DESKTOP_IPC_CHANNELS.skillsListShared,
      await runtime.listSharedSkills()
    )
  })
  ipcMain.handle(DESKTOP_IPC_CHANNELS.openExternalLink, async (_event, payload) => {
    if (!openExternalLink) {
      throw new Error('外部链接功能不可用。')
    }
    const request = parseDesktopIpcRequest(DESKTOP_IPC_CHANNELS.openExternalLink, payload)
    await openExternalLink(request.url)
    return parseDesktopIpcResponse(DESKTOP_IPC_CHANNELS.openExternalLink, undefined)
  })

  ipcMain.handle(DESKTOP_IPC_CHANNELS.sessionsApproveBash, async (_event, payload) => {
    const { approvalId } = parseDesktopIpcRequest(DESKTOP_IPC_CHANNELS.sessionsApproveBash, payload)
    await runtime.approveBash(approvalId)
    return parseDesktopIpcResponse(DESKTOP_IPC_CHANNELS.sessionsApproveBash, undefined)
  })

  ipcMain.handle(DESKTOP_IPC_CHANNELS.sessionsRejectBash, async (_event, payload) => {
    const { approvalId } = parseDesktopIpcRequest(DESKTOP_IPC_CHANNELS.sessionsRejectBash, payload)
    await runtime.rejectBash(approvalId)
    return parseDesktopIpcResponse(DESKTOP_IPC_CHANNELS.sessionsRejectBash, undefined)
  })

  ipcMain.handle(DESKTOP_IPC_CHANNELS.sessionsGetPendingApprovals, async (_event, payload) => {
    parseDesktopIpcRequest(DESKTOP_IPC_CHANNELS.sessionsGetPendingApprovals, payload)
    return parseDesktopIpcResponse(
      DESKTOP_IPC_CHANNELS.sessionsGetPendingApprovals,
      runtime.getPendingApprovals()
    )
  })

  ipcMain.handle(DESKTOP_IPC_CHANNELS.skillsInstall, async (_event, payload) => {
    return parseDesktopIpcResponse(
      DESKTOP_IPC_CHANNELS.skillsInstall,
      await runtime.installSkill(
        parseDesktopIpcRequest(DESKTOP_IPC_CHANNELS.skillsInstall, payload)
      )
    )
  })

  ipcMain.handle(DESKTOP_IPC_CHANNELS.skillsDelete, async (_event, payload) => {
    return parseDesktopIpcResponse(
      DESKTOP_IPC_CHANNELS.skillsDelete,
      await runtime.deleteSkill(parseDesktopIpcRequest(DESKTOP_IPC_CHANNELS.skillsDelete, payload))
    )
  })

  ipcMain.handle(DESKTOP_IPC_CHANNELS.skillsApproveOperation, async (_event, payload) => {
    const { approvalId } = parseDesktopIpcRequest(
      DESKTOP_IPC_CHANNELS.skillsApproveOperation,
      payload
    )
    await runtime.approveSkillOperation(approvalId)
    return parseDesktopIpcResponse(DESKTOP_IPC_CHANNELS.skillsApproveOperation, undefined)
  })

  ipcMain.handle(DESKTOP_IPC_CHANNELS.skillsRejectOperation, async (_event, payload) => {
    const { approvalId } = parseDesktopIpcRequest(
      DESKTOP_IPC_CHANNELS.skillsRejectOperation,
      payload
    )
    await runtime.rejectSkillOperation(approvalId)
    return parseDesktopIpcResponse(DESKTOP_IPC_CHANNELS.skillsRejectOperation, undefined)
  })

  ipcMain.handle(DESKTOP_IPC_CHANNELS.skillsGetPendingApprovals, async (_event, payload) => {
    parseDesktopIpcRequest(DESKTOP_IPC_CHANNELS.skillsGetPendingApprovals, payload)
    return parseDesktopIpcResponse(
      DESKTOP_IPC_CHANNELS.skillsGetPendingApprovals,
      runtime.getPendingSkillApprovals()
    )
  })

  ipcMain.handle(DESKTOP_IPC_CHANNELS.skillsGetInstallRecords, async (_event, payload) => {
    parseDesktopIpcRequest(DESKTOP_IPC_CHANNELS.skillsGetInstallRecords, payload)
    return parseDesktopIpcResponse(
      DESKTOP_IPC_CHANNELS.skillsGetInstallRecords,
      await runtime.getSkillInstallRecords()
    )
  })
}
