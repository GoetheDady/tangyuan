import { z } from 'zod'
import {
  agentSessionSummarySchema,
  agentSummarySchema,
  answerClarificationRequestSchema,
  approveBashRequestSchema,
  approveSkillOperationRequestSchema,
  archiveSessionRequestSchema,
  archiveSessionResultSchema,
  deleteSessionRequestSchema,
  deleteSessionResultSchema,
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
  listSessionsRequestSchema,
  nonEmptyIdentifierSchema,
  openExternalLinkRequestSchema,
  profileUpdateResultSchema,
  recoverAgentRequestSchema,
  recoverSessionRequestSchema,
  rejectBashRequestSchema,
  retryRunRequestSchema,
  runtimeConfigurationSchema,
  providerConfigurationSchema,
  deleteProviderRequestSchema,
  runtimeSnapshotSchema,
  sendMessageRequestSchema,
  sendNotificationRequestSchema,
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
  forkSessionRequestSchema,
  lastActiveSessionSchema,
  sessionResumeSnapshotSchema,
  setLastActiveSessionRequestSchema,
} from './schemas'
import type {
  LastActiveSession,
  SessionResumeSnapshot,
  SetLastActiveSessionRequest,
} from './last-active-session'
import type {
  ArchiveSessionRequest,
  ArchiveSessionResult,
  DeleteSessionRequest,
  DeleteSessionResult,
  RecoverSessionRequest,
} from './session-archive-types'
import type {
  AgentSessionSummary,
  AgentSummary,
  AnswerClarificationRequest,
  ApproveBashRequest,
  ApproveSkillOperationRequest,
  ArchiveAgentRequest,
  BashApprovalRequest,
  CancelClarificationRequest,
  CancelConfigurationVerificationRequest,
  CancelRunRequest,
  ClaimAgentDirectoryRequest,
  CreateSessionRequest,
  DeleteProviderRequest,
  GetSessionMessagesRequest,
  GetSessionModelInfoRequest,
  GetSoulRequest,
  ListAgentSkillsRequest,
  ListSessionsRequest,
  OpenExternalLinkRequest,
  ProfileUpdateResult,
  ProviderConfiguration,
  QuestionClarificationRequest,
  RecoverAgentRequest,
  RejectBashRequest,
  ForkSessionRequest,
  RetryRunRequest,
  RuntimeConfiguration,
  RuntimeSnapshot,
  SendMessageRequest,
  SendNotificationRequest,
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
  runtimeGetSnapshot: 'yuanxiao:runtime:get-snapshot',
  runtimeRefresh: 'yuanxiao:runtime:refresh',
  runtimeSaveConfiguration: 'yuanxiao:runtime:save-configuration',
  runtimeCancelConfigurationVerification:
    'yuanxiao:runtime:cancel-configuration-verification',
  runtimeRestoreFromBackup: 'yuanxiao:runtime:restore-from-backup',
  runtimeResetConfiguration: 'yuanxiao:runtime:reset-configuration',
  runtimeSaveProvider: 'yuanxiao:runtime:save-provider',
  runtimeDeleteProvider: 'yuanxiao:runtime:delete-provider',
  sessionsList: 'yuanxiao:sessions:list',
  sessionsCreate: 'yuanxiao:sessions:create',
  sessionsSendMessage: 'yuanxiao:sessions:send-message',
  sessionsCancelRun: 'yuanxiao:sessions:cancel-run',
  agentsList: 'yuanxiao:agents:list',
  agentsUpdateConfig: 'yuanxiao:agents:update-config',
  agentsArchive: 'yuanxiao:agents:archive',
  agentsRecover: 'yuanxiao:agents:recover',
  agentsReconcile: 'yuanxiao:agents:reconcile',
  agentsClaimDirectory: 'yuanxiao:agents:claim-directory',
  agentsRebuildYuanxiao: 'yuanxiao:agents:rebuild-yuanxiao',
  sessionsGetModelInfo: 'yuanxiao:sessions:get-model-info',
  sessionsSetModel: 'yuanxiao:sessions:set-model',
  sessionsSetThinkingLevel: 'yuanxiao:sessions:set-thinking-level',
  profileGetSoul: 'yuanxiao:profile:get-soul',
  profileGetUser: 'yuanxiao:profile:get-user',
  profileUpdateSoul: 'yuanxiao:profile:update-soul',
  profileUpdateUser: 'yuanxiao:profile:update-user',
  skillsListAgent: 'yuanxiao:skills:list-agent',
  skillsListShared: 'yuanxiao:skills:list-shared',
  skillsInstall: 'yuanxiao:skills:install',
  skillsDelete: 'yuanxiao:skills:delete',
  skillsApproveOperation: 'yuanxiao:skills:approve-operation',
  skillsRejectOperation: 'yuanxiao:skills:reject-operation',
  skillsGetPendingApprovals: 'yuanxiao:skills:get-pending-approvals',
  skillsGetInstallRecords: 'yuanxiao:skills:get-install-records',
  openExternalLink: 'yuanxiao:open-external-link',
  sessionsApproveBash: 'yuanxiao:sessions:approve-bash',
  sessionsRejectBash: 'yuanxiao:sessions:reject-bash',
  sessionsGetPendingApprovals: 'yuanxiao:sessions:get-pending-approvals',
  sessionsAnswerClarification: 'yuanxiao:sessions:answer-clarification',
  sessionsCancelClarification: 'yuanxiao:sessions:cancel-clarification',
  sessionsGetPendingClarifications:
    'yuanxiao:sessions:get-pending-clarifications',
  sessionsGetTranscript: 'yuanxiao:sessions:get-transcript',
  sessionsRetryMessage: 'yuanxiao:sessions:retry-message',
  sessionsFork: 'yuanxiao:sessions:fork',
  sessionsArchive: 'yuanxiao:sessions:archive',
  sessionsRecover: 'yuanxiao:sessions:recover',
  sessionsDelete: 'yuanxiao:sessions:delete',
  sessionsResume: 'yuanxiao:sessions:resume',
  sessionsSetLastActive: 'yuanxiao:sessions:set-last-active',
  notificationSend: 'yuanxiao:notification:send',
} as const

/**
 * Main 进程向 Renderer 推送 Agent 标准事件时使用的 IPC channel。
 */
export const DESKTOP_AGENT_EVENT_CHANNEL = 'yuanxiao:agent:event'

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
  [DESKTOP_IPC_CHANNELS.runtimeSaveProvider]: ProviderConfiguration
  [DESKTOP_IPC_CHANNELS.runtimeDeleteProvider]: DeleteProviderRequest
  [DESKTOP_IPC_CHANNELS.sessionsList]: ListSessionsRequest | undefined
  [DESKTOP_IPC_CHANNELS.sessionsCreate]: CreateSessionRequest
  [DESKTOP_IPC_CHANNELS.sessionsSendMessage]: SendMessageRequest
  [DESKTOP_IPC_CHANNELS.sessionsCancelRun]: CancelRunRequest
  [DESKTOP_IPC_CHANNELS.agentsList]: undefined
  [DESKTOP_IPC_CHANNELS.agentsUpdateConfig]: UpdateAgentConfigRequest
  [DESKTOP_IPC_CHANNELS.agentsArchive]: ArchiveAgentRequest
  [DESKTOP_IPC_CHANNELS.agentsRecover]: RecoverAgentRequest
  [DESKTOP_IPC_CHANNELS.agentsReconcile]: undefined
  [DESKTOP_IPC_CHANNELS.agentsClaimDirectory]: ClaimAgentDirectoryRequest
  [DESKTOP_IPC_CHANNELS.agentsRebuildYuanxiao]: undefined
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
  [DESKTOP_IPC_CHANNELS.skillsApproveOperation]: ApproveSkillOperationRequest
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
  [DESKTOP_IPC_CHANNELS.sessionsFork]: ForkSessionRequest
  [DESKTOP_IPC_CHANNELS.sessionsArchive]: ArchiveSessionRequest
  [DESKTOP_IPC_CHANNELS.sessionsRecover]: RecoverSessionRequest
  [DESKTOP_IPC_CHANNELS.sessionsDelete]: DeleteSessionRequest
  [DESKTOP_IPC_CHANNELS.sessionsResume]: undefined
  [DESKTOP_IPC_CHANNELS.sessionsSetLastActive]: SetLastActiveSessionRequest
  [DESKTOP_IPC_CHANNELS.notificationSend]: SendNotificationRequest
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
  [DESKTOP_IPC_CHANNELS.runtimeSaveProvider]: providerConfigurationSchema,
  [DESKTOP_IPC_CHANNELS.runtimeDeleteProvider]: deleteProviderRequestSchema,
  [DESKTOP_IPC_CHANNELS.sessionsList]: listSessionsRequestSchema.optional(),
  [DESKTOP_IPC_CHANNELS.sessionsCreate]: createSessionRequestSchema,
  [DESKTOP_IPC_CHANNELS.sessionsSendMessage]: sendMessageRequestSchema,
  [DESKTOP_IPC_CHANNELS.sessionsCancelRun]: cancelRunRequestSchema,
  [DESKTOP_IPC_CHANNELS.agentsList]: z.undefined(),
  [DESKTOP_IPC_CHANNELS.agentsUpdateConfig]: updateAgentConfigRequestSchema,
  [DESKTOP_IPC_CHANNELS.agentsArchive]: archiveAgentRequestSchema,
  [DESKTOP_IPC_CHANNELS.agentsRecover]: recoverAgentRequestSchema,
  [DESKTOP_IPC_CHANNELS.agentsReconcile]: z.undefined(),
  [DESKTOP_IPC_CHANNELS.agentsClaimDirectory]: claimAgentDirectoryRequestSchema,
  [DESKTOP_IPC_CHANNELS.agentsRebuildYuanxiao]: z.undefined(),
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
  [DESKTOP_IPC_CHANNELS.skillsApproveOperation]: approveSkillOperationRequestSchema,
  [DESKTOP_IPC_CHANNELS.skillsRejectOperation]: rejectBashRequestSchema,
  [DESKTOP_IPC_CHANNELS.skillsGetPendingApprovals]: z.undefined(),
  [DESKTOP_IPC_CHANNELS.skillsGetInstallRecords]: z.undefined(),
  [DESKTOP_IPC_CHANNELS.openExternalLink]: openExternalLinkRequestSchema,
  [DESKTOP_IPC_CHANNELS.sessionsApproveBash]: approveBashRequestSchema,
  [DESKTOP_IPC_CHANNELS.sessionsRejectBash]: rejectBashRequestSchema,
  [DESKTOP_IPC_CHANNELS.sessionsGetPendingApprovals]: z.undefined(),
  [DESKTOP_IPC_CHANNELS.sessionsAnswerClarification]:
    answerClarificationRequestSchema,
  [DESKTOP_IPC_CHANNELS.sessionsCancelClarification]:
    cancelClarificationRequestSchema,
  [DESKTOP_IPC_CHANNELS.sessionsGetPendingClarifications]: z.undefined(),
  [DESKTOP_IPC_CHANNELS.sessionsGetTranscript]: getSessionMessagesRequestSchema,
  [DESKTOP_IPC_CHANNELS.sessionsRetryMessage]: retryRunRequestSchema,
  [DESKTOP_IPC_CHANNELS.sessionsFork]: forkSessionRequestSchema,
  [DESKTOP_IPC_CHANNELS.sessionsArchive]: archiveSessionRequestSchema,
  [DESKTOP_IPC_CHANNELS.sessionsRecover]: recoverSessionRequestSchema,
  [DESKTOP_IPC_CHANNELS.sessionsDelete]: deleteSessionRequestSchema,
  [DESKTOP_IPC_CHANNELS.sessionsResume]: z.undefined(),
  [DESKTOP_IPC_CHANNELS.sessionsSetLastActive]:
    setLastActiveSessionRequestSchema,
  [DESKTOP_IPC_CHANNELS.notificationSend]: sendNotificationRequestSchema,
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
  [DESKTOP_IPC_CHANNELS.runtimeSaveProvider]: RuntimeSnapshot
  [DESKTOP_IPC_CHANNELS.runtimeDeleteProvider]: RuntimeSnapshot
  [DESKTOP_IPC_CHANNELS.sessionsList]: AgentSessionSummary[]
  [DESKTOP_IPC_CHANNELS.sessionsCreate]: AgentSessionSummary
  [DESKTOP_IPC_CHANNELS.sessionsSendMessage]: TranscriptSnapshot
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
  [DESKTOP_IPC_CHANNELS.agentsRebuildYuanxiao]: AgentSummary
  [DESKTOP_IPC_CHANNELS.sessionsGetModelInfo]: SessionModelInfo
  [DESKTOP_IPC_CHANNELS.sessionsSetModel]: SessionModelInfo
  [DESKTOP_IPC_CHANNELS.sessionsSetThinkingLevel]: SessionModelInfo
  [DESKTOP_IPC_CHANNELS.profileGetSoul]: SoulContent
  [DESKTOP_IPC_CHANNELS.profileGetUser]: UserProfileContent
  [DESKTOP_IPC_CHANNELS.profileUpdateSoul]: ProfileUpdateResult
  [DESKTOP_IPC_CHANNELS.profileUpdateUser]: ProfileUpdateResult
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
  [DESKTOP_IPC_CHANNELS.sessionsRetryMessage]: TranscriptSnapshot
  [DESKTOP_IPC_CHANNELS.sessionsFork]: AgentSessionSummary
  [DESKTOP_IPC_CHANNELS.sessionsArchive]: ArchiveSessionResult
  [DESKTOP_IPC_CHANNELS.sessionsRecover]: AgentSessionSummary[]
  [DESKTOP_IPC_CHANNELS.sessionsDelete]: DeleteSessionResult
  [DESKTOP_IPC_CHANNELS.sessionsResume]: SessionResumeSnapshot
  [DESKTOP_IPC_CHANNELS.sessionsSetLastActive]: LastActiveSession | null
  [DESKTOP_IPC_CHANNELS.notificationSend]: void
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
  [DESKTOP_IPC_CHANNELS.runtimeSaveProvider]: runtimeSnapshotSchema,
  [DESKTOP_IPC_CHANNELS.runtimeDeleteProvider]: runtimeSnapshotSchema,
  [DESKTOP_IPC_CHANNELS.sessionsList]: z.array(agentSessionSummarySchema),
  [DESKTOP_IPC_CHANNELS.sessionsCreate]: agentSessionSummarySchema,
  [DESKTOP_IPC_CHANNELS.sessionsSendMessage]: transcriptSnapshotSchema,
  [DESKTOP_IPC_CHANNELS.sessionsCancelRun]: agentSessionSummarySchema,
  [DESKTOP_IPC_CHANNELS.agentsList]: z.array(agentSummarySchema),
  [DESKTOP_IPC_CHANNELS.agentsUpdateConfig]: agentSummarySchema,
  [DESKTOP_IPC_CHANNELS.agentsArchive]: agentSummarySchema,
  [DESKTOP_IPC_CHANNELS.agentsRecover]: agentSummarySchema,
  [DESKTOP_IPC_CHANNELS.agentsReconcile]: z.strictObject({
    agents: z.array(agentSummarySchema),
    unclaimedDirectories: z.array(
      z.strictObject({
        agentId: nonEmptyIdentifierSchema,
        homePath: z.string(),
        hasSoul: z.boolean(),
      }),
    ),
  }),
  [DESKTOP_IPC_CHANNELS.agentsClaimDirectory]: agentSummarySchema,
  [DESKTOP_IPC_CHANNELS.agentsRebuildYuanxiao]: agentSummarySchema,
  [DESKTOP_IPC_CHANNELS.sessionsGetModelInfo]: sessionModelInfoSchema,
  [DESKTOP_IPC_CHANNELS.sessionsSetModel]: sessionModelInfoSchema,
  [DESKTOP_IPC_CHANNELS.sessionsSetThinkingLevel]: sessionModelInfoSchema,
  [DESKTOP_IPC_CHANNELS.profileGetSoul]: soulContentSchema,
  [DESKTOP_IPC_CHANNELS.profileGetUser]: userProfileContentSchema,
  [DESKTOP_IPC_CHANNELS.profileUpdateSoul]: profileUpdateResultSchema,
  [DESKTOP_IPC_CHANNELS.profileUpdateUser]: profileUpdateResultSchema,
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
  [DESKTOP_IPC_CHANNELS.sessionsRetryMessage]: transcriptSnapshotSchema,
  [DESKTOP_IPC_CHANNELS.sessionsFork]: agentSessionSummarySchema,
  [DESKTOP_IPC_CHANNELS.sessionsArchive]: archiveSessionResultSchema,
  [DESKTOP_IPC_CHANNELS.sessionsRecover]: z.array(agentSessionSummarySchema),
  [DESKTOP_IPC_CHANNELS.sessionsDelete]: deleteSessionResultSchema,
  [DESKTOP_IPC_CHANNELS.sessionsResume]: sessionResumeSnapshotSchema,
  [DESKTOP_IPC_CHANNELS.sessionsSetLastActive]:
    lastActiveSessionSchema.nullable(),
  [DESKTOP_IPC_CHANNELS.notificationSend]: z.void(),
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
  undefined extends DesktopIpcRequest<Channel>
    ? [payload?: Exclude<DesktopIpcRequest<Channel>, undefined>]
    : [payload: DesktopIpcRequest<Channel>]

export type { DesktopPreloadApi } from './desktop-preload-api'
