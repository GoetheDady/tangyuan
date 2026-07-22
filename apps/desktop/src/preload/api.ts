import {
  DESKTOP_AGENT_EVENT_CHANNEL,
  DESKTOP_IPC_CHANNELS,
  type AgentEventListener,
  type AnswerClarificationRequest,
  type ApproveBashRequest,
  type ArchiveAgentRequest,
  type CancelClarificationRequest,
  type CancelRunRequest,
  type ClaimAgentDirectoryRequest,
  type CreateSessionRequest,
  type DesktopIpcChannel,
  type DesktopIpcPayloadArgs,
  type DesktopIpcResponse,
  type DesktopPreloadApi,
  type GetSessionMessagesRequest,
  type GetSessionModelInfoRequest,
  type GetSoulRequest,
  type ListAgentSkillsRequest,
  type OpenExternalLinkRequest,
  type RecoverAgentRequest,
  type RejectBashRequest,
  type RetryRunRequest,
  type RuntimeConfiguration,
  type CancelConfigurationVerificationRequest,
  type SendMessageRequest,
  type SetSessionModelRequest,
  type SetSessionThinkingLevelRequest,
  type SkillOperationParams,
  type UpdateAgentConfigRequest,
  type UpdateSoulRequest,
  type UpdateUserProfileRequest
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
    getTranscript: async (request: GetSessionMessagesRequest) => {
      return invoke(DESKTOP_IPC_CHANNELS.sessionsGetTranscript, request)
    },
    sendMessage: async (request: SendMessageRequest) => {
      return invoke(DESKTOP_IPC_CHANNELS.sessionsSendMessage, request)
    },
    cancelRun: async (request: CancelRunRequest) => {
      return invoke(DESKTOP_IPC_CHANNELS.sessionsCancelRun, request)
    },
    retryMessage: async (request: RetryRunRequest) => {
      return invoke(DESKTOP_IPC_CHANNELS.sessionsRetryMessage, request)
    },
    subscribeToAgentEvents: (listener: AgentEventListener) => {
      return subscribe(DESKTOP_AGENT_EVENT_CHANNEL, listener)
    },
    listAgents: async () => {
      return invoke(DESKTOP_IPC_CHANNELS.agentsList)
    },
    restoreFromBackup: async () => {
      return invoke(DESKTOP_IPC_CHANNELS.runtimeRestoreFromBackup)
    },
    resetConfiguration: async () => {
      return invoke(DESKTOP_IPC_CHANNELS.runtimeResetConfiguration)
    },
    openExternalLink: async (request: OpenExternalLinkRequest) => {
      await invoke(DESKTOP_IPC_CHANNELS.openExternalLink, request)
    },
    updateAgentConfig: async (request: UpdateAgentConfigRequest) => {
      return invoke(DESKTOP_IPC_CHANNELS.agentsUpdateConfig, request)
    },
    archiveAgent: async (request: ArchiveAgentRequest) => {
      return invoke(DESKTOP_IPC_CHANNELS.agentsArchive, request)
    },
    recoverAgent: async (request: RecoverAgentRequest) => {
      return invoke(DESKTOP_IPC_CHANNELS.agentsRecover, request)
    },
    reconcileAgentDirectories: async () => {
      return invoke(DESKTOP_IPC_CHANNELS.agentsReconcile)
    },
    claimAgentDirectory: async (request: ClaimAgentDirectoryRequest) => {
      return invoke(DESKTOP_IPC_CHANNELS.agentsClaimDirectory, request)
    },
    rebuildTangyuanHome: async () => {
      return invoke(DESKTOP_IPC_CHANNELS.agentsRebuildTangyuan)
    },
    getSessionModelInfo: async (request: GetSessionModelInfoRequest) => {
      return invoke(DESKTOP_IPC_CHANNELS.sessionsGetModelInfo, request)
    },
    setSessionModel: async (request: SetSessionModelRequest) => {
      return invoke(DESKTOP_IPC_CHANNELS.sessionsSetModel, request)
    },
    setSessionThinkingLevel: async (request: SetSessionThinkingLevelRequest) => {
      return invoke(DESKTOP_IPC_CHANNELS.sessionsSetThinkingLevel, request)
    },
    getSoul: async (request: GetSoulRequest) => {
      return invoke(DESKTOP_IPC_CHANNELS.profileGetSoul, request)
    },
    getUserProfile: async () => {
      return invoke(DESKTOP_IPC_CHANNELS.profileGetUser)
    },
    updateSoul: async (request: UpdateSoulRequest) => {
      return invoke(DESKTOP_IPC_CHANNELS.profileUpdateSoul, request)
    },
    updateUserProfile: async (request: UpdateUserProfileRequest) => {
      return invoke(DESKTOP_IPC_CHANNELS.profileUpdateUser, request)
    },
    listAgentSkills: async (request: ListAgentSkillsRequest) => {
      return invoke(DESKTOP_IPC_CHANNELS.skillsListAgent, request)
    },
    listSharedSkills: async () => {
      return invoke(DESKTOP_IPC_CHANNELS.skillsListShared)
    },
    installSkill: async (params: SkillOperationParams) => {
      return invoke(DESKTOP_IPC_CHANNELS.skillsInstall, params)
    },
    deleteSkill: async (params: SkillOperationParams) => {
      return invoke(DESKTOP_IPC_CHANNELS.skillsDelete, params)
    },
    approveSkillOperation: async (request: ApproveBashRequest) => {
      await invoke(DESKTOP_IPC_CHANNELS.skillsApproveOperation, request)
    },
    rejectSkillOperation: async (request: RejectBashRequest) => {
      await invoke(DESKTOP_IPC_CHANNELS.skillsRejectOperation, request)
    },
    getPendingSkillApprovals: async () => {
      return invoke(DESKTOP_IPC_CHANNELS.skillsGetPendingApprovals)
    },
    getSkillInstallRecords: async () => {
      return invoke(DESKTOP_IPC_CHANNELS.skillsGetInstallRecords)
    },
    approveBash: async (request: ApproveBashRequest) => {
      await invoke(DESKTOP_IPC_CHANNELS.sessionsApproveBash, request)
    },
    rejectBash: async (request: RejectBashRequest) => {
      await invoke(DESKTOP_IPC_CHANNELS.sessionsRejectBash, request)
    },
    getPendingApprovals: async () => {
      return invoke(DESKTOP_IPC_CHANNELS.sessionsGetPendingApprovals)
    },
    answerClarification: async (request: AnswerClarificationRequest) => {
      await invoke(DESKTOP_IPC_CHANNELS.sessionsAnswerClarification, request)
    },
    cancelClarification: async (request: CancelClarificationRequest) => {
      await invoke(DESKTOP_IPC_CHANNELS.sessionsCancelClarification, request)
    },
    getPendingClarifications: async () => {
      return invoke(DESKTOP_IPC_CHANNELS.sessionsGetPendingClarifications)
    }
  }
}
