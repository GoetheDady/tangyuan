import {
  DESKTOP_AGENT_EVENT_CHANNEL,
  DESKTOP_IPC_CHANNELS,
  type AgentEventListener,
  type ArchiveAgentRequest,
  type ArchiveSessionRequest,
  type DeleteSessionRequest,
  type CancelRunRequest,
  type ClaimAgentDirectoryRequest,
  type CreateSessionRequest,
  type DesktopIpcChannel,
  type DesktopIpcPayloadArgs,
  type DesktopIpcResponse,
  type DesktopPreloadApi,
  type ForkSessionRequest,
  type GetSessionMessagesRequest,
  type GetSessionModelInfoRequest,
  type GetSoulRequest,
  type ListAgentSkillsRequest,
  type ListSessionsRequest,
  type OpenExternalLinkRequest,
  type RecoverAgentRequest,
  type RecoverSessionRequest,
  type RetryRunRequest,
  type RenameSessionRequest,
  type RuntimeConfiguration,
  type CancelConfigurationVerificationRequest,
  type ProviderConfiguration,
  type DeleteProviderRequest,
  type SendMessageRequest,
  type SendNotificationRequest,
  type SetSessionModelRequest,
  type SetSessionThinkingLevelRequest,
  type SetLastActiveSessionRequest,
  type SkillOperationParams,
  type UpdateAgentConfigRequest,
  type UpdateSoulRequest,
  type UpdateUserProfileRequest,
} from '@yuanxiao/contracts'

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
  listener: AgentEventListener,
) => () => void

/**
 * 创建暴露给 Renderer 的类型化桌面 API。
 *
 * @param invoke - 调用 Electron IPC 的窄函数。
 * @param subscribe - 订阅 Electron IPC 事件的窄函数。
 * @returns Renderer 可以通过 `window.api` 调用的 DesktopPreloadApi。
 * @throws 此方法不会主动抛出错误；具体 IPC 错误会在返回的 Promise 中 reject。
 */
export function createYuanxiaoPreloadApi(
  invoke: IpcInvoke,
  subscribe: IpcSubscribe = () => () => undefined,
): DesktopPreloadApi {
  return {
    getRuntimeSnapshot: async () => {
      return invoke(DESKTOP_IPC_CHANNELS.runtimeGetSnapshot)
    },
    refreshRuntime: async () => {
      return invoke(DESKTOP_IPC_CHANNELS.runtimeRefresh)
    },
    saveRuntimeConfiguration: async (configuration: RuntimeConfiguration) => {
      return invoke(
        DESKTOP_IPC_CHANNELS.runtimeSaveConfiguration,
        configuration,
      )
    },
    cancelRuntimeConfigurationVerification: async (
      request: CancelConfigurationVerificationRequest,
    ) => {
      return invoke(
        DESKTOP_IPC_CHANNELS.runtimeCancelConfigurationVerification,
        request,
      )
    },
    saveProvider: async (config: ProviderConfiguration) => {
      return invoke(DESKTOP_IPC_CHANNELS.runtimeSaveProvider, config)
    },
    deleteProvider: async (request: DeleteProviderRequest) => {
      return invoke(DESKTOP_IPC_CHANNELS.runtimeDeleteProvider, request)
    },
    listSessions: async (request?: ListSessionsRequest) => {
      return invoke(DESKTOP_IPC_CHANNELS.sessionsList, request)
    },
    resumeSession: async () => {
      return invoke(DESKTOP_IPC_CHANNELS.sessionsResume)
    },
    setLastActiveSession: async (request: SetLastActiveSessionRequest) => {
      return invoke(DESKTOP_IPC_CHANNELS.sessionsSetLastActive, request)
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
    forkSession: async (request: ForkSessionRequest) => {
      return invoke(DESKTOP_IPC_CHANNELS.sessionsFork, request)
    },
    archiveSession: async (request: ArchiveSessionRequest) => {
      return invoke(DESKTOP_IPC_CHANNELS.sessionsArchive, request)
    },
    recoverSession: async (request: RecoverSessionRequest) => {
      return invoke(DESKTOP_IPC_CHANNELS.sessionsRecover, request)
    },
    deleteSession: async (request: DeleteSessionRequest) => {
      return invoke(DESKTOP_IPC_CHANNELS.sessionsDelete, request)
    },
    renameSession: async (request: RenameSessionRequest) => {
      return invoke(DESKTOP_IPC_CHANNELS.sessionsRename, request)
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
    sendNotification: async (request: SendNotificationRequest) => {
      await invoke(DESKTOP_IPC_CHANNELS.notificationSend, request)
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
    rebuildYuanxiaoHome: async () => {
      return invoke(DESKTOP_IPC_CHANNELS.agentsRebuildYuanxiao)
    },
    getSessionModelInfo: async (request: GetSessionModelInfoRequest) => {
      return invoke(DESKTOP_IPC_CHANNELS.sessionsGetModelInfo, request)
    },
    setSessionModel: async (request: SetSessionModelRequest) => {
      return invoke(DESKTOP_IPC_CHANNELS.sessionsSetModel, request)
    },
    setSessionThinkingLevel: async (
      request: SetSessionThinkingLevelRequest,
    ) => {
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
    getSkillInstallRecords: async () => {
      return invoke(DESKTOP_IPC_CHANNELS.skillsGetInstallRecords)
    },
  }
}
