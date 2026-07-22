import { z } from 'zod'
import {
  agentMessageSchema,
  agentSessionSummarySchema,
  answerClarificationRequestSchema,
  approveBashRequestSchema,
  archiveAgentRequestSchema,
  cancelClarificationRequestSchema,
  cancelConfigurationVerificationRequestSchema,
  cancelRunRequestSchema,
  claimAgentDirectoryRequestSchema,
  createSessionRequestSchema,
  getSessionMessagesRequestSchema,
  getSessionModelInfoRequestSchema,
  getSoulRequestSchema,
  listAgentSkillsRequestSchema,
  nonEmptyIdentifierSchema,
  openExternalLinkRequestSchema,
  profileMaintenanceResultSchema,
  recoverAgentRequestSchema,
  rejectBashRequestSchema,
  retryRunRequestSchema,
  runtimeConfigurationSchema,
  runtimeSnapshotSchema,
  sendMessageRequestSchema,
  sessionModelInfoSchema,
  setSessionModelRequestSchema,
  setSessionThinkingLevelRequestSchema,
  skillOperationParamsSchema,
  soulContentSchema,
  transcriptSnapshotSchema,
  updateAgentConfigRequestSchema,
  updateSoulRequestSchema,
  updateUserProfileRequestSchema,
  userProfileContentSchema,
  bashApprovalRequestSchema,
  questionClarificationRequestSchema,
  skillApprovalRequestSchema,
  skillInstallRecordSchema,
  skillSummarySchema,
} from './schemas'
import type {
  AgentEventListener,
  AgentMessage,
  AgentSessionSummary,
  AgentSummary,
  AnswerClarificationRequest,
  ApproveBashRequest,
  ArchiveAgentRequest,
  BashApprovalRequest,
  CancelClarificationRequest,
  CancelConfigurationVerificationRequest,
  CancelRunRequest,
  ClaimAgentDirectoryRequest,
  CreateSessionRequest,
  GetSessionMessagesRequest,
  GetSessionModelInfoRequest,
  GetSoulRequest,
  ListAgentSkillsRequest,
  OpenExternalLinkRequest,
  ProfileMaintenanceResult,
  QuestionClarificationRequest,
  RecoverAgentRequest,
  RejectBashRequest,
  RetryRunRequest,
  RuntimeConfiguration,
  RuntimeSnapshot,
  SendMessageRequest,
  SessionModelInfo,
  SetSessionModelRequest,
  SetSessionThinkingLevelRequest,
  SkillApprovalRequest,
  SkillInstallRecord,
  SkillOperationParams,
  SkillSummary,
  SoulContent,
  TranscriptSnapshot,
  UnclaimedDirectory,
  UpdateAgentConfigRequest,
  UpdateSoulRequest,
  UpdateUserProfileRequest,
  UserProfileContent,
} from './types'

export const DESKTOP_IPC_CHANNELS = {
  runtimeGetSnapshot: 'tangyuan:runtime:get-snapshot',
  runtimeRefresh: 'tangyuan:runtime:refresh',
  runtimeSaveConfiguration: 'tangyuan:runtime:save-configuration',
  runtimeCancelConfigurationVerification:
    'tangyuan:runtime:cancel-configuration-verification',
  runtimeRestoreFromBackup: 'tangyuan:runtime:restore-from-backup',
  runtimeResetConfiguration: 'tangyuan:runtime:reset-configuration',
  sessionsList: 'tangyuan:sessions:list',
  sessionsCreate: 'tangyuan:sessions:create',
  sessionsGetMessages: 'tangyuan:sessions:get-messages',
  sessionsSendMessage: 'tangyuan:sessions:send-message',
  sessionsCancelRun: 'tangyuan:sessions:cancel-run',
  agentsList: 'tangyuan:agents:list',
  agentsUpdateConfig: 'tangyuan:agents:update-config',
  agentsArchive: 'tangyuan:agents:archive',
  agentsRecover: 'tangyuan:agents:recover',
  agentsReconcile: 'tangyuan:agents:reconcile',
  agentsClaimDirectory: 'tangyuan:agents:claim-directory',
  agentsRebuildTangyuan: 'tangyuan:agents:rebuild-tangyuan',
  sessionsGetModelInfo: 'tangyuan:sessions:get-model-info',
  sessionsSetModel: 'tangyuan:sessions:set-model',
  sessionsSetThinkingLevel: 'tangyuan:sessions:set-thinking-level',
  profileGetSoul: 'tangyuan:profile:get-soul',
  profileGetUser: 'tangyuan:profile:get-user',
  profileUpdateSoul: 'tangyuan:profile:update-soul',
  profileUpdateUser: 'tangyuan:profile:update-user',
  skillsListAgent: 'tangyuan:skills:list-agent',
  skillsListShared: 'tangyuan:skills:list-shared',
  skillsInstall: 'tangyuan:skills:install',
  skillsDelete: 'tangyuan:skills:delete',
  skillsApproveOperation: 'tangyuan:skills:approve-operation',
  skillsRejectOperation: 'tangyuan:skills:reject-operation',
  skillsGetPendingApprovals: 'tangyuan:skills:get-pending-approvals',
  skillsGetInstallRecords: 'tangyuan:skills:get-install-records',
  openExternalLink: 'tangyuan:open-external-link',
  sessionsApproveBash: 'tangyuan:sessions:approve-bash',
  sessionsRejectBash: 'tangyuan:sessions:reject-bash',
  sessionsGetPendingApprovals: 'tangyuan:sessions:get-pending-approvals',
  sessionsAnswerClarification: 'tangyuan:sessions:answer-clarification',
  sessionsCancelClarification: 'tangyuan:sessions:cancel-clarification',
  sessionsGetPendingClarifications: 'tangyuan:sessions:get-pending-clarifications',
  sessionsGetTranscript: 'tangyuan:sessions:get-transcript',
  sessionsRetryMessage: 'tangyuan:sessions:retry-message',
} as const

/**
 * Main 进程向 Renderer 推送 Agent 标准事件时使用的 IPC channel。
 */
export const DESKTOP_AGENT_EVENT_CHANNEL = 'tangyuan:agent:event'

/**
 * 描述桌面端允许使用的 IPC channel 名称。
 */
export type DesktopIpcChannel =
  (typeof DESKTOP_IPC_CHANNELS)[keyof typeof DESKTOP_IPC_CHANNELS]

/**
 * 描述每个 IPC channel 对应的请求载荷。
 */
export interface DesktopIpcRequestMap {
  [DESKTOP_IPC_CHANNELS.runtimeGetSnapshot]: undefined
  [DESKTOP_IPC_CHANNELS.runtimeRefresh]: undefined
  [DESKTOP_IPC_CHANNELS.runtimeSaveConfiguration]: RuntimeConfiguration
  [DESKTOP_IPC_CHANNELS.runtimeCancelConfigurationVerification]: CancelConfigurationVerificationRequest
  [DESKTOP_IPC_CHANNELS.runtimeRestoreFromBackup]: undefined
  [DESKTOP_IPC_CHANNELS.runtimeResetConfiguration]: undefined
  [DESKTOP_IPC_CHANNELS.sessionsList]: undefined
  [DESKTOP_IPC_CHANNELS.sessionsCreate]: CreateSessionRequest
  [DESKTOP_IPC_CHANNELS.sessionsGetMessages]: GetSessionMessagesRequest
  [DESKTOP_IPC_CHANNELS.sessionsSendMessage]: SendMessageRequest
  [DESKTOP_IPC_CHANNELS.sessionsCancelRun]: CancelRunRequest
  [DESKTOP_IPC_CHANNELS.agentsList]: undefined
  [DESKTOP_IPC_CHANNELS.agentsUpdateConfig]: UpdateAgentConfigRequest
  [DESKTOP_IPC_CHANNELS.agentsArchive]: ArchiveAgentRequest
  [DESKTOP_IPC_CHANNELS.agentsRecover]: RecoverAgentRequest
  [DESKTOP_IPC_CHANNELS.agentsReconcile]: undefined
  [DESKTOP_IPC_CHANNELS.agentsClaimDirectory]: ClaimAgentDirectoryRequest
  [DESKTOP_IPC_CHANNELS.agentsRebuildTangyuan]: undefined
  [DESKTOP_IPC_CHANNELS.sessionsGetModelInfo]: GetSessionModelInfoRequest
  [DESKTOP_IPC_CHANNELS.sessionsSetModel]: SetSessionModelRequest
  [DESKTOP_IPC_CHANNELS.sessionsSetThinkingLevel]: SetSessionThinkingLevelRequest
  [DESKTOP_IPC_CHANNELS.profileGetSoul]: GetSoulRequest
  [DESKTOP_IPC_CHANNELS.profileGetUser]: undefined
  [DESKTOP_IPC_CHANNELS.profileUpdateSoul]: UpdateSoulRequest
  [DESKTOP_IPC_CHANNELS.profileUpdateUser]: UpdateUserProfileRequest
  [DESKTOP_IPC_CHANNELS.skillsListAgent]: ListAgentSkillsRequest
  [DESKTOP_IPC_CHANNELS.skillsListShared]: undefined
  [DESKTOP_IPC_CHANNELS.skillsInstall]: SkillOperationParams
  [DESKTOP_IPC_CHANNELS.skillsDelete]: SkillOperationParams
  [DESKTOP_IPC_CHANNELS.skillsApproveOperation]: ApproveBashRequest
  [DESKTOP_IPC_CHANNELS.skillsRejectOperation]: RejectBashRequest
  [DESKTOP_IPC_CHANNELS.skillsGetPendingApprovals]: undefined
  [DESKTOP_IPC_CHANNELS.skillsGetInstallRecords]: undefined
  [DESKTOP_IPC_CHANNELS.openExternalLink]: OpenExternalLinkRequest
  [DESKTOP_IPC_CHANNELS.sessionsApproveBash]: ApproveBashRequest
  [DESKTOP_IPC_CHANNELS.sessionsRejectBash]: RejectBashRequest
  [DESKTOP_IPC_CHANNELS.sessionsGetPendingApprovals]: undefined
  [DESKTOP_IPC_CHANNELS.sessionsAnswerClarification]: AnswerClarificationRequest
  [DESKTOP_IPC_CHANNELS.sessionsCancelClarification]: CancelClarificationRequest
  [DESKTOP_IPC_CHANNELS.sessionsGetPendingClarifications]: undefined
  [DESKTOP_IPC_CHANNELS.sessionsGetTranscript]: GetSessionMessagesRequest
  [DESKTOP_IPC_CHANNELS.sessionsRetryMessage]: RetryRunRequest
}

/**
 * 保存每个 IPC channel 对应的运行时请求 schema。
 */
export const desktopIpcRequestSchemas = {
  [DESKTOP_IPC_CHANNELS.runtimeGetSnapshot]: z.undefined(),
  [DESKTOP_IPC_CHANNELS.runtimeRefresh]: z.undefined(),
  [DESKTOP_IPC_CHANNELS.runtimeSaveConfiguration]: runtimeConfigurationSchema,
  [DESKTOP_IPC_CHANNELS.runtimeCancelConfigurationVerification]:
    cancelConfigurationVerificationRequestSchema,
  [DESKTOP_IPC_CHANNELS.runtimeRestoreFromBackup]: z.undefined(),
  [DESKTOP_IPC_CHANNELS.runtimeResetConfiguration]: z.undefined(),
  [DESKTOP_IPC_CHANNELS.sessionsList]: z.undefined(),
  [DESKTOP_IPC_CHANNELS.sessionsCreate]: createSessionRequestSchema,
  [DESKTOP_IPC_CHANNELS.sessionsGetMessages]: getSessionMessagesRequestSchema,
  [DESKTOP_IPC_CHANNELS.sessionsSendMessage]: sendMessageRequestSchema,
  [DESKTOP_IPC_CHANNELS.sessionsCancelRun]: cancelRunRequestSchema,
  [DESKTOP_IPC_CHANNELS.agentsList]: z.undefined(),
  [DESKTOP_IPC_CHANNELS.agentsUpdateConfig]: updateAgentConfigRequestSchema,
  [DESKTOP_IPC_CHANNELS.agentsArchive]: archiveAgentRequestSchema,
  [DESKTOP_IPC_CHANNELS.agentsRecover]: recoverAgentRequestSchema,
  [DESKTOP_IPC_CHANNELS.agentsReconcile]: z.undefined(),
  [DESKTOP_IPC_CHANNELS.agentsClaimDirectory]: claimAgentDirectoryRequestSchema,
  [DESKTOP_IPC_CHANNELS.agentsRebuildTangyuan]: z.undefined(),
  [DESKTOP_IPC_CHANNELS.sessionsGetModelInfo]: getSessionModelInfoRequestSchema,
  [DESKTOP_IPC_CHANNELS.sessionsSetModel]: setSessionModelRequestSchema,
  [DESKTOP_IPC_CHANNELS.sessionsSetThinkingLevel]:
    setSessionThinkingLevelRequestSchema,
  [DESKTOP_IPC_CHANNELS.profileGetSoul]: getSoulRequestSchema,
  [DESKTOP_IPC_CHANNELS.profileGetUser]: z.undefined(),
  [DESKTOP_IPC_CHANNELS.profileUpdateSoul]: updateSoulRequestSchema,
  [DESKTOP_IPC_CHANNELS.profileUpdateUser]: updateUserProfileRequestSchema,
  [DESKTOP_IPC_CHANNELS.skillsListAgent]: listAgentSkillsRequestSchema,
  [DESKTOP_IPC_CHANNELS.skillsListShared]: z.undefined(),
  [DESKTOP_IPC_CHANNELS.skillsInstall]: skillOperationParamsSchema,
  [DESKTOP_IPC_CHANNELS.skillsDelete]: skillOperationParamsSchema,
  [DESKTOP_IPC_CHANNELS.skillsApproveOperation]: approveBashRequestSchema,
  [DESKTOP_IPC_CHANNELS.skillsRejectOperation]: rejectBashRequestSchema,
  [DESKTOP_IPC_CHANNELS.skillsGetPendingApprovals]: z.undefined(),
  [DESKTOP_IPC_CHANNELS.skillsGetInstallRecords]: z.undefined(),
  [DESKTOP_IPC_CHANNELS.openExternalLink]: openExternalLinkRequestSchema,
  [DESKTOP_IPC_CHANNELS.sessionsApproveBash]: approveBashRequestSchema,
  [DESKTOP_IPC_CHANNELS.sessionsRejectBash]: rejectBashRequestSchema,
  [DESKTOP_IPC_CHANNELS.sessionsGetPendingApprovals]: z.undefined(),
  [DESKTOP_IPC_CHANNELS.sessionsAnswerClarification]: answerClarificationRequestSchema,
  [DESKTOP_IPC_CHANNELS.sessionsCancelClarification]: cancelClarificationRequestSchema,
  [DESKTOP_IPC_CHANNELS.sessionsGetPendingClarifications]: z.undefined(),
  [DESKTOP_IPC_CHANNELS.sessionsGetTranscript]: getSessionMessagesRequestSchema,
  [DESKTOP_IPC_CHANNELS.sessionsRetryMessage]: retryRunRequestSchema,
} satisfies Record<DesktopIpcChannel, z.ZodType>

/**
 * 在 Main 进程调用 Runtime 前重新校验 IPC 请求。
 *
 * @param channel - Renderer 调用的 IPC channel。
 * @param payload - Electron 传入的未知请求载荷。
 * @returns 通过对应 schema 校验后的类型化请求。
 * @throws 当请求载荷不符合 contract 时抛出 ZodError。
 */
export function parseDesktopIpcRequest<Channel extends DesktopIpcChannel>(
  channel: Channel,
  payload: unknown,
): DesktopIpcRequest<Channel> {
  return desktopIpcRequestSchemas[channel].parse(
    payload,
  ) as DesktopIpcRequest<Channel>
}

/**
 * 描述每个 IPC channel 对应的响应载荷。
 */
export interface DesktopIpcResponseMap {
  [DESKTOP_IPC_CHANNELS.runtimeGetSnapshot]: RuntimeSnapshot
  [DESKTOP_IPC_CHANNELS.runtimeRefresh]: RuntimeSnapshot
  [DESKTOP_IPC_CHANNELS.runtimeSaveConfiguration]: RuntimeSnapshot
  [DESKTOP_IPC_CHANNELS.runtimeCancelConfigurationVerification]: RuntimeSnapshot
  [DESKTOP_IPC_CHANNELS.runtimeRestoreFromBackup]: RuntimeSnapshot
  [DESKTOP_IPC_CHANNELS.runtimeResetConfiguration]: RuntimeSnapshot
  [DESKTOP_IPC_CHANNELS.sessionsList]: AgentSessionSummary[]
  [DESKTOP_IPC_CHANNELS.sessionsCreate]: AgentSessionSummary
  [DESKTOP_IPC_CHANNELS.sessionsGetMessages]: AgentMessage[]
  [DESKTOP_IPC_CHANNELS.sessionsSendMessage]: AgentMessage[]
  [DESKTOP_IPC_CHANNELS.sessionsCancelRun]: AgentSessionSummary
  [DESKTOP_IPC_CHANNELS.agentsList]: AgentSummary[]
  [DESKTOP_IPC_CHANNELS.agentsUpdateConfig]: AgentSummary
  [DESKTOP_IPC_CHANNELS.agentsArchive]: AgentSummary
  [DESKTOP_IPC_CHANNELS.agentsRecover]: AgentSummary
  [DESKTOP_IPC_CHANNELS.agentsReconcile]: {
    agents: AgentSummary[]
    unclaimedDirectories: UnclaimedDirectory[]
  }
  [DESKTOP_IPC_CHANNELS.agentsClaimDirectory]: AgentSummary
  [DESKTOP_IPC_CHANNELS.agentsRebuildTangyuan]: AgentSummary
  [DESKTOP_IPC_CHANNELS.sessionsGetModelInfo]: SessionModelInfo
  [DESKTOP_IPC_CHANNELS.sessionsSetModel]: SessionModelInfo
  [DESKTOP_IPC_CHANNELS.sessionsSetThinkingLevel]: SessionModelInfo
  [DESKTOP_IPC_CHANNELS.profileGetSoul]: SoulContent
  [DESKTOP_IPC_CHANNELS.profileGetUser]: UserProfileContent
  [DESKTOP_IPC_CHANNELS.profileUpdateSoul]: ProfileMaintenanceResult
  [DESKTOP_IPC_CHANNELS.profileUpdateUser]: ProfileMaintenanceResult
  [DESKTOP_IPC_CHANNELS.skillsListAgent]: SkillSummary[]
  [DESKTOP_IPC_CHANNELS.skillsListShared]: SkillSummary[]
  [DESKTOP_IPC_CHANNELS.skillsInstall]: SkillSummary[]
  [DESKTOP_IPC_CHANNELS.skillsDelete]: SkillSummary[]
  [DESKTOP_IPC_CHANNELS.skillsApproveOperation]: void
  [DESKTOP_IPC_CHANNELS.skillsRejectOperation]: void
  [DESKTOP_IPC_CHANNELS.skillsGetPendingApprovals]: SkillApprovalRequest[]
  [DESKTOP_IPC_CHANNELS.skillsGetInstallRecords]: SkillInstallRecord[]
  [DESKTOP_IPC_CHANNELS.openExternalLink]: void
  [DESKTOP_IPC_CHANNELS.sessionsApproveBash]: void
  [DESKTOP_IPC_CHANNELS.sessionsRejectBash]: void
  [DESKTOP_IPC_CHANNELS.sessionsGetPendingApprovals]: BashApprovalRequest[]
  [DESKTOP_IPC_CHANNELS.sessionsAnswerClarification]: void
  [DESKTOP_IPC_CHANNELS.sessionsCancelClarification]: void
  [DESKTOP_IPC_CHANNELS.sessionsGetPendingClarifications]: QuestionClarificationRequest[]
  [DESKTOP_IPC_CHANNELS.sessionsGetTranscript]: TranscriptSnapshot
  [DESKTOP_IPC_CHANNELS.sessionsRetryMessage]: AgentMessage[]
}

/**
 * 保存每个 IPC channel 对应的运行时响应 schema。
 */
export const desktopIpcResponseSchemas = {
  [DESKTOP_IPC_CHANNELS.runtimeGetSnapshot]: runtimeSnapshotSchema,
  [DESKTOP_IPC_CHANNELS.runtimeRefresh]: runtimeSnapshotSchema,
  [DESKTOP_IPC_CHANNELS.runtimeSaveConfiguration]: runtimeSnapshotSchema,
  [DESKTOP_IPC_CHANNELS.runtimeCancelConfigurationVerification]:
    runtimeSnapshotSchema,
  [DESKTOP_IPC_CHANNELS.runtimeRestoreFromBackup]: runtimeSnapshotSchema,
  [DESKTOP_IPC_CHANNELS.runtimeResetConfiguration]: runtimeSnapshotSchema,
  [DESKTOP_IPC_CHANNELS.sessionsList]: z.array(agentSessionSummarySchema),
  [DESKTOP_IPC_CHANNELS.sessionsCreate]: agentSessionSummarySchema,
  [DESKTOP_IPC_CHANNELS.sessionsGetMessages]: z.array(agentMessageSchema),
  [DESKTOP_IPC_CHANNELS.sessionsSendMessage]: z.array(agentMessageSchema),
  [DESKTOP_IPC_CHANNELS.sessionsCancelRun]: agentSessionSummarySchema,
  [DESKTOP_IPC_CHANNELS.agentsList]: z.array(
    z.strictObject({
      agentId: nonEmptyIdentifierSchema,
      displayName: z.string(),
      status: z.enum(['active', 'archived']),
      defaultProviderId: z.string().nullable(),
      defaultModelId: z.string().nullable(),
      homePath: z.string(),
      archivedAt: z.string().nullable(),
      directoryStatus: z.enum(['healthy', 'damaged']),
    }),
  ),
  [DESKTOP_IPC_CHANNELS.agentsUpdateConfig]: z.strictObject({
    agentId: nonEmptyIdentifierSchema,
    displayName: z.string(),
    status: z.enum(['active', 'archived']),
    defaultProviderId: z.string().nullable(),
    defaultModelId: z.string().nullable(),
    homePath: z.string(),
    archivedAt: z.string().nullable(),
    directoryStatus: z.enum(['healthy', 'damaged']),
  }),
  [DESKTOP_IPC_CHANNELS.agentsArchive]: z.strictObject({
    agentId: nonEmptyIdentifierSchema,
    displayName: z.string(),
    status: z.enum(['active', 'archived']),
    defaultProviderId: z.string().nullable(),
    defaultModelId: z.string().nullable(),
    homePath: z.string(),
    archivedAt: z.string().nullable(),
    directoryStatus: z.enum(['healthy', 'damaged']),
  }),
  [DESKTOP_IPC_CHANNELS.agentsRecover]: z.strictObject({
    agentId: nonEmptyIdentifierSchema,
    displayName: z.string(),
    status: z.enum(['active', 'archived']),
    defaultProviderId: z.string().nullable(),
    defaultModelId: z.string().nullable(),
    homePath: z.string(),
    archivedAt: z.string().nullable(),
    directoryStatus: z.enum(['healthy', 'damaged']),
  }),
  [DESKTOP_IPC_CHANNELS.agentsReconcile]: z.strictObject({
    agents: z.array(
      z.strictObject({
        agentId: nonEmptyIdentifierSchema,
        displayName: z.string(),
        status: z.enum(['active', 'archived']),
        defaultProviderId: z.string().nullable(),
        defaultModelId: z.string().nullable(),
        homePath: z.string(),
        archivedAt: z.string().nullable(),
        directoryStatus: z.enum(['healthy', 'damaged']),
      }),
    ),
    unclaimedDirectories: z.array(
      z.strictObject({
        agentId: nonEmptyIdentifierSchema,
        homePath: z.string(),
        hasSoul: z.boolean(),
      }),
    ),
  }),
  [DESKTOP_IPC_CHANNELS.agentsClaimDirectory]: z.strictObject({
    agentId: nonEmptyIdentifierSchema,
    displayName: z.string(),
    status: z.enum(['active', 'archived']),
    defaultProviderId: z.string().nullable(),
    defaultModelId: z.string().nullable(),
    homePath: z.string(),
    archivedAt: z.string().nullable(),
    directoryStatus: z.enum(['healthy', 'damaged']),
  }),
  [DESKTOP_IPC_CHANNELS.agentsRebuildTangyuan]: z.strictObject({
    agentId: nonEmptyIdentifierSchema,
    displayName: z.string(),
    status: z.enum(['active', 'archived']),
    defaultProviderId: z.string().nullable(),
    defaultModelId: z.string().nullable(),
    homePath: z.string(),
    archivedAt: z.string().nullable(),
    directoryStatus: z.enum(['healthy', 'damaged']),
  }),
  [DESKTOP_IPC_CHANNELS.sessionsGetModelInfo]: sessionModelInfoSchema,
  [DESKTOP_IPC_CHANNELS.sessionsSetModel]: sessionModelInfoSchema,
  [DESKTOP_IPC_CHANNELS.sessionsSetThinkingLevel]: sessionModelInfoSchema,
  [DESKTOP_IPC_CHANNELS.profileGetSoul]: soulContentSchema,
  [DESKTOP_IPC_CHANNELS.profileGetUser]: userProfileContentSchema,
  [DESKTOP_IPC_CHANNELS.profileUpdateSoul]: profileMaintenanceResultSchema,
  [DESKTOP_IPC_CHANNELS.profileUpdateUser]: profileMaintenanceResultSchema,
  [DESKTOP_IPC_CHANNELS.skillsListAgent]: z.array(skillSummarySchema),
  [DESKTOP_IPC_CHANNELS.skillsListShared]: z.array(skillSummarySchema),
  [DESKTOP_IPC_CHANNELS.skillsInstall]: z.array(skillSummarySchema),
  [DESKTOP_IPC_CHANNELS.skillsDelete]: z.array(skillSummarySchema),
  [DESKTOP_IPC_CHANNELS.skillsApproveOperation]: z.void(),
  [DESKTOP_IPC_CHANNELS.skillsRejectOperation]: z.void(),
  [DESKTOP_IPC_CHANNELS.skillsGetPendingApprovals]: z.array(
    skillApprovalRequestSchema,
  ),
  [DESKTOP_IPC_CHANNELS.skillsGetInstallRecords]: z.array(
    skillInstallRecordSchema,
  ),
  [DESKTOP_IPC_CHANNELS.openExternalLink]: z.void(),
  [DESKTOP_IPC_CHANNELS.sessionsApproveBash]: z.void(),
  [DESKTOP_IPC_CHANNELS.sessionsRejectBash]: z.void(),
  [DESKTOP_IPC_CHANNELS.sessionsGetPendingApprovals]: z.array(
    bashApprovalRequestSchema,
  ),
  [DESKTOP_IPC_CHANNELS.sessionsAnswerClarification]: z.void(),
  [DESKTOP_IPC_CHANNELS.sessionsCancelClarification]: z.void(),
  [DESKTOP_IPC_CHANNELS.sessionsGetPendingClarifications]: z.array(
    questionClarificationRequestSchema,
  ),
  [DESKTOP_IPC_CHANNELS.sessionsGetTranscript]: transcriptSnapshotSchema,
  [DESKTOP_IPC_CHANNELS.sessionsRetryMessage]: z.array(agentMessageSchema),
} satisfies Record<DesktopIpcChannel, z.ZodType>

/**
 * 在 Main 进程把响应传给 Renderer 前重新校验 IPC 返回值。
 *
 * @param channel - Renderer 调用的 IPC channel。
 * @param response - Runtime 返回的未知响应载荷。
 * @returns 通过对应 schema 校验后的类型化响应。
 * @throws 当响应载荷不符合 contract 时抛出 ZodError。
 */
export function parseDesktopIpcResponse<Channel extends DesktopIpcChannel>(
  channel: Channel,
  response: unknown,
): DesktopIpcResponse<Channel> {
  return desktopIpcResponseSchemas[channel].parse(
    response,
  ) as DesktopIpcResponse<Channel>
}

/**
 * 描述某个 IPC channel 需要的请求载荷。
 */
export type DesktopIpcRequest<Channel extends DesktopIpcChannel> =
  DesktopIpcRequestMap[Channel]

/**
 * 描述某个 IPC channel 会返回的响应载荷。
 */
export type DesktopIpcResponse<Channel extends DesktopIpcChannel> =
  DesktopIpcResponseMap[Channel]

/**
 * 描述调用某个 IPC channel 时是否需要传 payload 参数。
 */
export type DesktopIpcPayloadArgs<Channel extends DesktopIpcChannel> =
  DesktopIpcRequest<Channel> extends undefined
    ? []
    : [payload: DesktopIpcRequest<Channel>]

/**
 * Renderer 能通过 `window.api` 调用的桌面端能力。
 */
export interface DesktopPreloadApi {
  /**
   * 读取当前运行时快照。
   *
   * @returns Provider、模型、API Key 和 activeAgent 状态。
   * @throws 当 Main 进程无法读取运行时资源时，Promise 会 reject。
   */
  getRuntimeSnapshot(): Promise<RuntimeSnapshot>

  /**
   * 刷新运行时资源并返回最新快照。
   *
   * @returns 刷新后的 RuntimeSnapshot。
   * @throws 当 Provider 或模型资源刷新失败时，Promise 会 reject。
   */
  refreshRuntime(): Promise<RuntimeSnapshot>

  /**
   * 验证并保存运行时配置。
   *
   * @param configuration - Provider、模型和 API Key。
   * @returns 保存后的 RuntimeSnapshot。
   * @throws 当 Main 进程验证失败或保存失败时，Promise 会 reject。
   */
  saveRuntimeConfiguration(
    configuration: RuntimeConfiguration,
  ): Promise<RuntimeSnapshot>

  /**
   * 取消正在进行的配置验证。
   *
   * @param request - 需要取消的验证标识。
   * @returns 取消后的 RuntimeSnapshot。
   * @throws 当 Main 进程无法取消验证时，Promise 会 reject。
   */
  cancelRuntimeConfigurationVerification(
    request: CancelConfigurationVerificationRequest,
  ): Promise<RuntimeSnapshot>

  /**
   * 读取当前 Agent 的会话列表。
   *
   * @returns 会话摘要列表。
   * @throws 当会话索引读取失败时，Promise 会 reject。
   */
  listSessions(): Promise<AgentSessionSummary[]>

  /**
   * 创建一个新的 Agent 会话。
   *
   * @param request - 新会话所属 Agent 和标题。
   * @returns 创建后的会话摘要。
   * @throws 当 Driver 无法创建会话时，Promise 会 reject。
   */
  createSession(request: CreateSessionRequest): Promise<AgentSessionSummary>

  /**
   * 读取指定会话的结构化 transcript 快照。
   *
   * @param request - 会话所属 Agent 和会话标识。
   * @returns 结构化会话快照，包含按时间排序的条目列表。
   * @throws 当会话不存在或 Main 进程无法构建快照时，Promise 会 reject。
   */
  getTranscript(request: GetSessionMessagesRequest): Promise<TranscriptSnapshot>

  /**
   * 读取指定会话的对话消息。
   *
   * @param request - 会话所属 Agent 和会话标识。
   * @returns 会话里的消息列表。
   * @throws 当会话不存在或 Main 进程无法读取消息时，Promise 会 reject。
   */
  getMessages(request: GetSessionMessagesRequest): Promise<AgentMessage[]>

  /**
   * 向指定 Agent 会话发送一条用户消息。
   *
   * @param request - 会话所属 Agent、会话标识和用户消息内容。
   * @returns 发送完成后可展示的最新消息列表。
   * @throws 当配置缺失、会话不存在或 Agent 运行失败时，Promise 会 reject。
   */
  sendMessage(request: SendMessageRequest): Promise<AgentMessage[]>

  /**
   * 取消指定会话正在运行的 Agent 响应。
   *
   * @param request - 会话所属 Agent 和会话标识。
   * @returns 取消后的会话摘要。
   * @throws 当会话不存在或 Main 进程无法取消运行时，Promise 会 reject。
   */
  cancelRun(request: CancelRunRequest): Promise<AgentSessionSummary>

  /**
   * 重试一条失败的用户消息，复用原始请求并创建新的执行尝试。
   *
   * @param request - 会话定位信息和要重试的原始用户消息标识。
   * @returns 重试完成后的最新消息列表。
   * @throws 当配置缺失、会话不存在或 Agent 运行失败时，Promise 会 reject。
   */
  retryMessage(request: RetryRunRequest): Promise<AgentMessage[]>

  /**
   * 订阅 Main 进程转发的 Agent 标准事件。
   *
   * @param listener - 接收标准事件的回调。
   * @returns 取消订阅方法。
   * @throws 此方法不会主动抛出错误。
   */
  subscribeToAgentEvents(listener: AgentEventListener): () => void

  /**
   * 列出所有 Agent 摘要。
   *
   * @returns Agent 摘要列表。
   * @throws 当 Main 进程无法读取配置时，Promise 会 reject。
   */
  listAgents(): Promise<AgentSummary[]>

  /**
   * 从备份恢复配置。
   *
   * @returns 恢复后的 RuntimeSnapshot。
   * @throws 当备份不存在或恢复失败时，Promise 会 reject。
   */
  restoreFromBackup(): Promise<RuntimeSnapshot>

  /**
   * 重置配置并删除当前和备份配置文件（不删除 Agent 数据或 Pi session）。
   *
   * @returns 重置后的 RuntimeSnapshot。
   * @throws 当重置失败时，Promise 会 reject。
   */
  resetConfiguration(): Promise<RuntimeSnapshot>

  /**
   * 更新指定 Agent 的默认 Provider 和 Model 配置。
   *
   * @param request - Agent 标识和要更新的默认 Provider/Model。
   * @returns 更新后的 AgentSummary。
   * @throws 当 Agent 不存在或配置保存失败时，Promise 会 reject。
   */
  updateAgentConfig(request: UpdateAgentConfigRequest): Promise<AgentSummary>

  /**
   * 归档指定的自定义 Agent（默认汤圆不可归档）。
   *
   * @param request - 要归档的 Agent 标识。
   * @returns 归档后的 AgentSummary。
   * @throws 当 Agent 是汤圆或配置保存失败时，Promise 会 reject。
   */
  archiveAgent(request: ArchiveAgentRequest): Promise<AgentSummary>

  /**
   * 恢复已归档的 Agent 到活跃状态。
   *
   * @param request - 要恢复的 Agent 标识。
   * @returns 恢复后的 AgentSummary。
   * @throws 当 Agent 不存在或配置保存失败时，Promise 会 reject。
   */
  recoverAgent(request: RecoverAgentRequest): Promise<AgentSummary>

  /**
   * 执行目录对账：标记损坏 Agent 并发现未归属目录。
   *
   * @returns 包含更新后 Agent 列表和未归属目录的对账报告。
   * @throws 当配置读取或目录扫描失败时，Promise 会 reject。
   */
  reconcileAgentDirectories(): Promise<{
    agents: AgentSummary[]
    unclaimedDirectories: UnclaimedDirectory[]
  }>

  /**
   * 认领未归属的 Agent 目录，为其创建配置条目。
   *
   * @param request - 目录的 agentId 和展示名称。
   * @returns 认领后的 AgentSummary。
   * @throws 当目录不存在或配置保存失败时，Promise 会 reject。
   */
  claimAgentDirectory(
    request: ClaimAgentDirectoryRequest,
  ): Promise<AgentSummary>

  /**
   * 按固定模板重建默认汤圆的目录结构。
   *
   * @returns 重建后的 AgentSummary。
   * @throws 当目录创建或文件写入失败时，Promise 会 reject。
   */
  rebuildTangyuanHome(): Promise<AgentSummary>

  /**
   * 读取当前 Session 使用的模型和 Thinking Level 信息。
   *
   * @param request - Agent 和 Session 标识。
   * @returns Session 的模型信息。
   * @throws 当 Session 不存在或读取失败时，Promise 会 reject。
   */
  getSessionModelInfo(
    request: GetSessionModelInfoRequest,
  ): Promise<SessionModelInfo>

  /**
   * 切换当前 Session 的 Provider 和 Model。
   *
   * @param request - Agent、Session 标识和目标 Provider/Model。
   * @returns 切换后的模型信息。
   * @throws 当 Session 不存在或模型切换失败时，Promise 会 reject。
   */
  setSessionModel(request: SetSessionModelRequest): Promise<SessionModelInfo>

  /**
   * 切换当前 Session 的 Thinking Level。
   *
   * @param request - Agent、Session 标识和目标 Thinking Level。
   * @returns 切换后的模型信息。
   * @throws 当 Session 不存在或不支持 Thinking 时，Promise 会 reject。
   */
  setSessionThinkingLevel(
    request: SetSessionThinkingLevelRequest,
  ): Promise<SessionModelInfo>

  /**
   * 读取指定 Agent 的 soul（身份/角色）内容。
   *
   * @param request - Agent 标识。
   * @returns Agent 的 soul 内容和更新时间。
   * @throws 当 Agent 不存在或文件读取失败时，Promise 会 reject。
   */
  getSoul(request: GetSoulRequest): Promise<SoulContent>

  /**
   * 读取共享 user profile 内容。
   *
   * @returns 共享 user profile 内容和更新时间。
   * @throws 当文件不存在或读取失败时，Promise 会 reject。
   */
  getUserProfile(): Promise<UserProfileContent>

  /**
   * 更新指定 Agent 的 soul 内容。
   *
   * @param request - Agent 标识和新 soul 内容。
   * @returns profile 维护结果，包含成功状态和可能的失败原因。
   * @throws 当文件操作失败时，Promise 会 reject。
   */
  updateSoul(request: UpdateSoulRequest): Promise<ProfileMaintenanceResult>

  /**
   * 更新共享 user profile 内容。
   *
   * @param request - 新 user profile 内容。
   * @returns profile 维护结果，包含成功状态和可能的失败原因。
   * @throws 当文件操作失败时，Promise 会 reject。
   */
  updateUserProfile(
    request: UpdateUserProfileRequest,
  ): Promise<ProfileMaintenanceResult>

  /**
   * 请求 Main 进程校验协议后使用系统浏览器安全打开外部链接。
   *
   * @param request - 待打开的外部 URL。
   * @returns 无返回值；协议不允许或 URL 无效时 Promise 会 reject。
   * @throws 当 URL 协议不是 http/https 时 Promise 会 reject。
   */
  openExternalLink(request: OpenExternalLinkRequest): Promise<void>

  /**
   * 读取指定 Agent 实际生效的 Skill 列表及冲突诊断。
   *
   * @param request - Agent 标识。
   * @returns Agent 的 Skill 摘要列表。
   * @throws 当 Agent 不存在或 Skill 目录读取失败时，Promise 会 reject。
   */
  listAgentSkills(request: ListAgentSkillsRequest): Promise<SkillSummary[]>

  /**
   * 读取共享 Skill 列表。
   *
   * @returns 共享 Skill 摘要列表。
   * @throws 当共享 Skill 目录读取失败时，Promise 会 reject。
   */
  listSharedSkills(): Promise<SkillSummary[]>

  /**
   * 安装或更新 Skill。
   *
   * @param params - 操作类型、来源、目标 Agent、Skill 名称和源目录路径。
   * @returns 更新后的 Skill 摘要列表。
   * @throws 当权限不足、Skill 校验失败或文件操作失败时，Promise 会 reject。
   */
  installSkill(params: SkillOperationParams): Promise<SkillSummary[]>

  /**
   * 删除 Skill。
   *
   * @param params - 操作类型、来源、目标 Agent 和 Skill 名称。
   * @returns 更新后的 Skill 摘要列表。
   * @throws 当权限不足或文件操作失败时，Promise 会 reject。
   */
  deleteSkill(params: SkillOperationParams): Promise<SkillSummary[]>

  /**
   * 批准指定 Skill 操作审批请求。
   *
   * @param request - 审批标识。
   * @returns 无返回值。
   * @throws 当审批不存在或已过期时，Promise 会 reject。
   */
  approveSkillOperation(request: ApproveBashRequest): Promise<void>

  /**
   * 拒绝指定 Skill 操作审批请求。
   *
   * @param request - 审批标识。
   * @returns 无返回值。
   * @throws 当审批不存在或已过期时，Promise 会 reject。
   */
  rejectSkillOperation(request: RejectBashRequest): Promise<void>

  /**
   * 读取所有待审批的 Skill 操作请求。
   *
   * @returns 待审批 Skill 操作请求列表。
   * @throws 此方法不会主动抛出错误。
   */
  getPendingSkillApprovals(): Promise<SkillApprovalRequest[]>

  /**
   * 读取 Skill 安装记录。
   *
   * @returns 安装记录列表。
   * @throws 当读取失败时，Promise 会 reject。
   */
  getSkillInstallRecords(): Promise<SkillInstallRecord[]>

  /**
   * 批准指定 Bash 审批请求，使命令继续执行。
   *
   * @param request - 审批标识。
   * @returns 无返回值。
   * @throws 当审批不存在或已过期时，Promise 会 reject。
   */
  approveBash(request: ApproveBashRequest): Promise<void>

  /**
   * 拒绝指定 Bash 审批请求，向 Agent 返回拒绝工具结果。
   *
   * @param request - 审批标识。
   * @returns 无返回值。
   * @throws 当审批不存在或已过期时，Promise 会 reject。
   */
  rejectBash(request: RejectBashRequest): Promise<void>

  /**
   * 读取所有待审批的 Bash 请求。
   *
   * @returns 待审批请求列表。
   * @throws 此方法不会主动抛出错误。
   */
  getPendingApprovals(): Promise<BashApprovalRequest[]>

  /**
   * 提交澄清问题的答案。
   *
   * @param request - 澄清标识和用户答案。
   * @returns 无返回值。
   * @throws 当澄清不存在或已过期时，Promise 会 reject。
   */
  answerClarification(request: AnswerClarificationRequest): Promise<void>

  /**
   * 取消澄清问题。
   *
   * @param request - 澄清标识。
   * @returns 无返回值。
   * @throws 当澄清不存在或已过期时，Promise 会 reject。
   */
  cancelClarification(request: CancelClarificationRequest): Promise<void>

  /**
   * 读取所有待回答的澄清问题。
   *
   * @returns 待回答澄清请求列表。
   * @throws 此方法不会主动抛出错误。
   */
  getPendingClarifications(): Promise<QuestionClarificationRequest[]>
}
