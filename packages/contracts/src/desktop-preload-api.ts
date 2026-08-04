import type {
  AgentEventListener,
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
  DeleteProviderRequest,
  ForkSessionRequest,
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

/** Renderer 能通过 window.api 调用的桌面端能力。 */
export interface DesktopPreloadApi {
  getRuntimeSnapshot(): Promise<RuntimeSnapshot>
  refreshRuntime(): Promise<RuntimeSnapshot>
  saveRuntimeConfiguration(
    configuration: RuntimeConfiguration,
  ): Promise<RuntimeSnapshot>
  saveProvider(config: ProviderConfiguration): Promise<RuntimeSnapshot>
  deleteProvider(request: DeleteProviderRequest): Promise<RuntimeSnapshot>
  cancelRuntimeConfigurationVerification(
    request: CancelConfigurationVerificationRequest,
  ): Promise<RuntimeSnapshot>
  restoreFromBackup(): Promise<RuntimeSnapshot>
  resetConfiguration(): Promise<RuntimeSnapshot>

  listSessions(request?: ListSessionsRequest): Promise<AgentSessionSummary[]>
  createSession(request: CreateSessionRequest): Promise<AgentSessionSummary>
  getTranscript(request: GetSessionMessagesRequest): Promise<TranscriptSnapshot>
  sendMessage(request: SendMessageRequest): Promise<TranscriptSnapshot>
  cancelRun(request: CancelRunRequest): Promise<AgentSessionSummary>
  retryMessage(request: RetryRunRequest): Promise<TranscriptSnapshot>
  forkSession(request: ForkSessionRequest): Promise<AgentSessionSummary>
  archiveSession(request: ArchiveSessionRequest): Promise<ArchiveSessionResult>
  recoverSession(request: RecoverSessionRequest): Promise<AgentSessionSummary[]>
  deleteSession(request: DeleteSessionRequest): Promise<DeleteSessionResult>
  resumeSession(): Promise<SessionResumeSnapshot>
  setLastActiveSession(
    request: SetLastActiveSessionRequest,
  ): Promise<LastActiveSession | null>
  subscribeToAgentEvents(listener: AgentEventListener): () => void

  listAgents(): Promise<AgentSummary[]>
  updateAgentConfig(request: UpdateAgentConfigRequest): Promise<AgentSummary>
  archiveAgent(request: ArchiveAgentRequest): Promise<AgentSummary>
  recoverAgent(request: RecoverAgentRequest): Promise<AgentSummary>
  reconcileAgentDirectories(): Promise<{
    agents: AgentSummary[]
    unclaimedDirectories: UnclaimedDirectory[]
  }>
  claimAgentDirectory(
    request: ClaimAgentDirectoryRequest,
  ): Promise<AgentSummary>
  rebuildYuanxiaoHome(): Promise<AgentSummary>

  getSessionModelInfo(
    request: GetSessionModelInfoRequest,
  ): Promise<SessionModelInfo>
  setSessionModel(request: SetSessionModelRequest): Promise<SessionModelInfo>
  setSessionThinkingLevel(
    request: SetSessionThinkingLevelRequest,
  ): Promise<SessionModelInfo>

  getSoul(request: GetSoulRequest): Promise<SoulContent>
  getUserProfile(): Promise<UserProfileContent>
  updateSoul(request: UpdateSoulRequest): Promise<ProfileUpdateResult>
  updateUserProfile(
    request: UpdateUserProfileRequest,
  ): Promise<ProfileUpdateResult>

  listAgentSkills(request: ListAgentSkillsRequest): Promise<SkillSummary[]>
  listSharedSkills(): Promise<SkillSummary[]>
  installSkill(params: SkillOperationParams): Promise<SkillSummary[]>
  deleteSkill(params: SkillOperationParams): Promise<SkillSummary[]>
  approveSkillOperation(request: ApproveBashRequest): Promise<void>
  rejectSkillOperation(request: RejectBashRequest): Promise<void>
  getPendingSkillApprovals(): Promise<SkillApprovalRequest[]>
  getSkillInstallRecords(): Promise<SkillInstallRecord[]>

  approveBash(request: ApproveBashRequest): Promise<void>
  rejectBash(request: RejectBashRequest): Promise<void>
  getPendingApprovals(): Promise<BashApprovalRequest[]>
  answerClarification(request: AnswerClarificationRequest): Promise<void>
  cancelClarification(request: CancelClarificationRequest): Promise<void>
  getPendingClarifications(): Promise<QuestionClarificationRequest[]>

  openExternalLink(request: OpenExternalLinkRequest): Promise<void>
}
