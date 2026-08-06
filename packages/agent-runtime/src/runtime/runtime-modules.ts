import type {
  AgentConfig,
  AgentEventListener,
  AgentEventSubscription,
  AgentId,
  AgentSessionSummary,
  AgentSummary,
  CancelConfigurationVerificationRequest,
  CancelRunRequest,
  CreateSessionRequest,
  DeleteProviderRequest,
  ForkSessionRequest,
  GetSessionMessagesRequest,
  GetSessionModelInfoRequest,
  ListSessionsRequest,
  ProfileUpdateResult,
  ProviderConfiguration,
  RetryRunRequest,
  RuntimeConfiguration,
  RuntimeSnapshot,
  SendMessageRequest,
  SessionModelInfo,
  SetSessionModelRequest,
  SetSessionThinkingLevelRequest,
  SkillInstallRecord,
  SkillOperationParams,
  SkillSummary,
  SoulContent,
  TranscriptSnapshot,
  UnclaimedDirectory,
  UserProfileContent,
} from '@yuanxiao/contracts'
import type { PersistedAttemptEntry } from '../session/session-index-types'

/** Runtime 配置、Provider 与资源快照能力。 */
export interface RuntimeConfigurationModule {
  getSnapshot(): Promise<RuntimeSnapshot>
  refresh(): Promise<RuntimeSnapshot>
  saveConfiguration(
    configuration: RuntimeConfiguration,
  ): Promise<RuntimeSnapshot>
  cancelConfigurationVerification(
    request: CancelConfigurationVerificationRequest,
  ): Promise<RuntimeSnapshot>
  restoreFromBackup(): Promise<RuntimeSnapshot>
  resetConfiguration(): Promise<void>
  saveProvider(config: ProviderConfiguration): Promise<RuntimeSnapshot>
  deleteProvider(request: DeleteProviderRequest): Promise<RuntimeSnapshot>
}

/** Session 生命周期、执行、模型与资源重载能力。 */
export interface SessionModule {
  listSessions(request: ListSessionsRequest): Promise<AgentSessionSummary[]>
  setSessionsArchived(
    sessionIds: readonly string[],
    archivedAt: string | null,
  ): Promise<AgentSessionSummary[]>
  deleteSessions(sessionIds: readonly string[]): Promise<void>
  createSession(request: CreateSessionRequest): Promise<AgentSessionSummary>
  getTranscript(request: GetSessionMessagesRequest): Promise<TranscriptSnapshot>
  sendMessage(request: SendMessageRequest): Promise<void>
  cancelRun(request: CancelRunRequest): Promise<void>
  retryMessage(request: RetryRunRequest): Promise<void>
  forkSession(request: ForkSessionRequest): Promise<AgentSessionSummary>
  getSessionAttempts(sessionId: string): Promise<PersistedAttemptEntry[]>
  renameSession(sessionId: string, title: string): Promise<AgentSessionSummary>
  getSessionModelInfo(
    request: GetSessionModelInfoRequest,
  ): Promise<SessionModelInfo>
  setSessionModel(request: SetSessionModelRequest): Promise<SessionModelInfo>
  setSessionThinkingLevel(
    request: SetSessionThinkingLevelRequest,
  ): Promise<SessionModelInfo>
  reloadAgentSessions(agentId: AgentId): Promise<void>
  reloadAllSessions(): Promise<void>
  subscribe(listener: AgentEventListener): AgentEventSubscription
  /** 返回指定会话当前活跃运行的 runId；无活跃运行时返回 undefined。 */
  getActiveRunId(sessionId: string): string | undefined
  /** 返回当前全部活跃运行的数量。 */
  getActiveRunCount(): number
}

/** Agent 生命周期与目录对账能力。 */
export interface AgentLifecycleModule {
  createAgent(displayName: string): Promise<AgentSummary>
  updateAgentConfig(
    agentId: AgentId,
    patch: Partial<Pick<AgentConfig, 'defaultProviderId' | 'defaultModelId'>>,
  ): Promise<AgentSummary>
  archiveAgent(agentId: AgentId): Promise<AgentSummary>
  recoverAgent(agentId: AgentId): Promise<AgentSummary>
  reconcileAgentDirectories(): Promise<{
    agents: AgentSummary[]
    unclaimedDirectories: UnclaimedDirectory[]
  }>
  claimAgentDirectory(
    agentId: string,
    displayName: string,
  ): Promise<AgentSummary>
  rebuildYuanxiaoHome(): Promise<AgentSummary>
}

/** Agent 灵魂与共享用户画像持久化能力。 */
export interface ProfileModule {
  getSoul(agentId: AgentId): Promise<SoulContent>
  getUserProfile(): Promise<UserProfileContent>
  updateSoul(
    agentId: AgentId,
    content: string,
    expectedVersion: string,
  ): Promise<ProfileUpdateResult>
  updateUserProfile(
    content: string,
    expectedVersion: string,
  ): Promise<ProfileUpdateResult>
}

/** Skill 列表、持久化与安装记录能力。 */
export interface SkillOperationPreflight {
  description: string
  hasScripts: boolean
  conflict?: {
    overriddenPath: string
    overriddenSource: 'shared' | 'agent'
  }
}

export interface SkillModule {
  listAgentSkills(agentId: AgentId): Promise<SkillSummary[]>
  listSharedSkills(): Promise<SkillSummary[]>
  preflightSkillOperation(
    params: SkillOperationParams,
  ): Promise<SkillOperationPreflight>
  installSkill(params: SkillOperationParams): Promise<SkillSummary[]>
  deleteSkill(params: SkillOperationParams): Promise<SkillSummary[]>
  getSkillInstallRecords(): Promise<SkillInstallRecord[]>
}
