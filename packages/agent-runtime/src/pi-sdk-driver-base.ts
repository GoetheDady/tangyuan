/* eslint-disable max-lines -- 资源与共享状态已从会话执行职责拆分 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { RealPiSdkGateway } from './gateway'
import { DirectoryLayout } from './directory-layout'
import { ConfigStore } from './config-store'
import { AgentRegistry } from './agent-registry'
import { SkillStore } from './skill-store'
import { ProfileStore } from './profile-store'
import { SessionIndexStore } from './session-index-store'
import { MessageStore } from './message-store'
import { AgentRuntimeError } from './errors'
import {
  sanitizeErrorMessage,
  extractAgentRuntimeConfig,
  getMtimeIso,
} from './utils'
import {
  TANGYUAN_DEFAULT_AGENT_ID,
  createAgentProfileStatus,
  createRuntimeSnapshot,
  type AgentConfig,
  type AgentEvent,
  type AgentEventListener,
  type AgentEventSubscription,
  type AgentId,
  type AgentRunState,
  type AgentSessionSummary,
  type AgentSummary,
  type ConfigEncryptionAdapter,
  type GetSessionModelInfoRequest,
  type ProfileUpdateResult,
  type ProviderAuthSnapshot,
  type RuntimeSnapshot,
  type SessionModelInfo,
  type SetSessionModelRequest,
  type SetSessionThinkingLevelRequest,
  type SkillInstallRecord,
  type SkillOperationParams,
  type SkillSummary,
  type SoulContent,
  type TranscriptSnapshot,
  type UserProfileContent,
} from '@tangyuan/contracts'
import type {
  DriverEvent,
  InternalMessage,
  PiSdkDriverOptions,
  PiSdkGateway,
  PiSdkSessionHandle,
  ToolApprovalGateway,
} from './index'

export class PiSdkDriverBase {
  protected readonly now: () => string
  protected readonly agentHomePath: string
  protected readonly fsRoot: string
  protected readonly userDataPath: string
  protected readonly layout: DirectoryLayout
  protected readonly configStore: ConfigStore
  protected readonly agentRegistry: AgentRegistry
  protected readonly skillStore: SkillStore
  protected readonly profileStore: ProfileStore
  protected readonly sessionIndexStore: SessionIndexStore
  protected readonly messageStore: MessageStore
  protected readonly gateway: PiSdkGateway
  protected readonly encryptionAdapter: ConfigEncryptionAdapter | null
  protected readonly listeners = new Set<AgentEventListener>()
  protected readonly transcriptCache = new Map<string, TranscriptSnapshot>()
  protected readonly sessionHandles = new Map<string, PiSdkSessionHandle>()
  protected readonly sessionSoulVersions = new Map<string, string>()
  protected readonly pendingProfileRefreshes = new Set<string>()
  protected readonly activeRunIds = new Map<string, string>()
  protected readonly runSequenceBySession = new Map<string, number>()
  protected configurationVerificationController: AbortController | null = null
  protected toolApprovalGateway: ToolApprovalGateway | undefined

  /**
   * 创建 Pi SDK Driver 骨架。
   *
   * @param options - 时间函数、默认 Agent Home 路径和文件系统根目录等可替换依赖。
   * @returns PiSdkDriver 实例。
   * @throws 此构造方法不会主动抛出错误。
   */
  constructor(options: PiSdkDriverOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString())
    this.agentHomePath = options.agentHomePath ?? '~/.tangyuan/agents/tangyuan'
    this.fsRoot = options.fsRoot ?? homedir()
    this.userDataPath = options.userDataPath ?? join(this.fsRoot, '.tangyuan')
    this.layout = new DirectoryLayout({
      agentHomePath: this.agentHomePath,
      fsRoot: this.fsRoot,
      userDataPath: this.userDataPath,
    })
    this.gateway = options.gateway ?? new RealPiSdkGateway()
    this.encryptionAdapter = options.encryptionAdapter ?? null
    this.configStore = new ConfigStore({
      layout: this.layout,
      encryptionAdapter: this.encryptionAdapter,
      now: this.now,
    })
    this.agentRegistry = new AgentRegistry({
      layout: this.layout,
      configStore: this.configStore,
      now: this.now,
      emit: (event) => this.emit(event),
      agentHomePath: this.agentHomePath,
    })
    this.skillStore = new SkillStore({
      layout: this.layout,
      now: this.now,
    })
    this.profileStore = new ProfileStore({
      layout: this.layout,
      configStore: this.configStore,
      now: this.now,
    })
    this.sessionIndexStore = new SessionIndexStore({
      layout: this.layout,
      configStore: this.configStore,
      gateway: this.gateway,
    })
    this.messageStore = new MessageStore({ now: this.now })
    this.toolApprovalGateway = options.toolApprovalGateway
  }

  /**
   * 订阅标准 Agent 事件。
   *
   * @param listener - 接收标准事件的回调。
   * @returns 可取消订阅的句柄。
   * @throws 此方法不会主动抛出错误。
   */
  subscribe(listener: AgentEventListener): AgentEventSubscription {
    this.listeners.add(listener)

    return {
      unsubscribe: () => {
        this.listeners.delete(listener)
      },
    }
  }

  /**
   * 读取并初始化默认 Agent Home 的运行时快照。
   *
   * @returns 包含默认 Agent、profile 状态和配置状态的快照。
   * @throws 当文件系统访问失败时，Promise 会 reject。
   */
  protected async readRuntimeSnapshot(): Promise<RuntimeSnapshot> {
    const homeStatus = await this.profileStore.ensureDefaultAgentHome()
    const [readResult, resources] = await Promise.all([
      this.configStore.read(),
      this.gateway.listProvidersAndModels(),
    ])

    const runtimeConfig = readResult.config
      ? extractAgentRuntimeConfig(
          readResult.config,
          TANGYUAN_DEFAULT_AGENT_ID,
        )
      : null
    const hasBackup = await this.configStore.hasBackup()

    // 构建按 providerId 索引的凭据配置状态，Renderer 只能读取脱敏值
    const configuredProviders: Record<string, ProviderAuthSnapshot> = {}
    if (readResult.config) {
      for (const [providerId, creds] of Object.entries(
        readResult.config.providers,
      )) {
        configuredProviders[providerId] = {
          configured: true,
          maskedValue: PiSdkDriverBase.maskApiKey(creds.apiKey),
        }
      }
    }

    return createRuntimeSnapshot({
      activeAgent: {
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        displayName: '汤圆',
        homePath: this.agentHomePath,
        profile: createAgentProfileStatus(homeStatus),
      },
      agents: await this.agentRegistry.buildAgentSummaries(readResult.config),
      providers: resources.providers,
      models: resources.models,
      settings: {
        selectedProviderId: runtimeConfig?.providerId ?? null,
        selectedModelId: runtimeConfig?.modelId ?? null,
      },
      configuredProviders,
      auth: {
        apiKey: {
          configured: Boolean(runtimeConfig?.apiKey),
          maskedValue: runtimeConfig?.apiKey
            ? PiSdkDriverBase.maskApiKey(runtimeConfig.apiKey)
            : null,
        },
      },
      configRecovery: {
        state: readResult.recoveryState,
        hasBackup,
      },
    })
  }

  /**
   * 生成适合界面展示的 API Key 脱敏值。
   *
   * @param apiKey - 原始 API Key。
   * @returns 不暴露完整密钥的字符串。
   * @throws 此方法不会主动抛出错误。
   */
  static maskApiKey(apiKey: string): string {
    const trimmed = apiKey.trim()

    if (trimmed.length <= 8) {
      return '•'.repeat(trimmed.length)
    }

    return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`
  }

  /**
   * 列出所有已配置的 Agent 摘要。
   *
   * @returns Agent 摘要列表。
   * @throws 当配置读取失败时，Promise 会 reject。
   */
  async listAgents(): Promise<AgentSummary[]> {
    return this.agentRegistry.listAgents()
  }

  /**
   * 原子创建一个新 Agent。
   *
   * @param displayName - 新 Agent 的展示名称。
   * @returns 新创建的 Agent 摘要。
   * @throws 当配置读取、目录创建、文件写入或加密失败时，Promise 会 reject。
   */
  async createAgent(displayName: string): Promise<AgentSummary> {
    return this.agentRegistry.createAgent(displayName)
  }

  /**
   * 更新指定 Agent 的默认 Provider 和 Model 配置。
   *
   * @param agentId - Agent 标识。
   * @param patch - 要更新的配置字段。
   * @returns 更新后的 AgentSummary。
   * @throws 当 Agent 不存在或配置保存失败时，Promise 会 reject。
   */
  async updateAgentConfig(
    agentId: AgentId,
    patch: Partial<Pick<AgentConfig, 'defaultProviderId' | 'defaultModelId'>>,
  ): Promise<AgentSummary> {
    return this.agentRegistry.updateAgentConfig(agentId, patch)
  }

  /**
   * 归档指定的自定义 Agent（默认汤圆不可归档）。
   *
   * @param agentId - Agent 标识。
   * @returns 归档后的 AgentSummary。
   * @throws 当 Agent 是汤圆、不存在或配置保存失败时，Promise 会 reject。
   */
  async archiveAgent(agentId: AgentId): Promise<AgentSummary> {
    return this.agentRegistry.archiveAgent(agentId)
  }

  /**
   * 恢复已归档的 Agent 到活跃状态。
   *
   * @param agentId - Agent 标识。
   * @returns 恢复后的 AgentSummary。
   * @throws 当 Agent 不存在或配置保存失败时，Promise 会 reject。
   */
  async recoverAgent(agentId: AgentId): Promise<AgentSummary> {
    return this.agentRegistry.recoverAgent(agentId)
  }

  /**
   * 执行目录对账：对照配置检查 Agent 目录存在性，扫描发现未归属目录。
   *
   * @returns 对账报告，包含更新后的 Agent 列表和未归属目录。
   * @throws 当配置读取或目录扫描失败时，Promise 会 reject。
   */
  async reconcileAgentDirectories(): Promise<{
    agents: AgentSummary[]
    unclaimedDirectories: import('@tangyuan/contracts').UnclaimedDirectory[]
  }> {
    return this.agentRegistry.reconcileAgentDirectories()
  }

  /**
   * 认领一个未归属的 Agent 目录，为其创建配置条目。
   *
   * @param agentId - 目录名称（作为 agentId）。
   * @param displayName - Agent 展示名称。
   * @returns 认领后的 AgentSummary。
   * @throws 当目录不存在或配置保存失败时，Promise 会 reject。
   */
  async claimAgentDirectory(
    agentId: string,
    displayName: string,
  ): Promise<AgentSummary> {
    return this.agentRegistry.claimAgentDirectory(agentId, displayName)
  }

  /**
   * 按固定模板重建默认汤圆的目录结构。
   *
   * @returns 重建后的 AgentSummary。
   * @throws 当目录创建或文件写入失败时，Promise 会 reject。
   */
  async rebuildTangyuanHome(): Promise<AgentSummary> {
    return this.agentRegistry.rebuildTangyuanHome()
  }

  /**
   * 读取指定 Agent 的 soul 内容。
   *
   * @param agentId - Agent 标识。
   * @returns Agent 的 soul 内容和更新时间。
   * @throws 当文件读取失败时，Promise 会 reject。
   */
  async getSoul(agentId: AgentId): Promise<SoulContent> {
    return this.profileStore.readSoul(agentId)
  }

  /**
   * 读取共享 user profile 内容。
   *
   * @returns 共享 user profile 内容和更新时间。
   * @throws 当文件读取失败时，Promise 会 reject。
   */
  async getUserProfile(): Promise<UserProfileContent> {
    return this.profileStore.readUserProfile()
  }

  /**
   * 列出指定 Agent 实际生效的 Skill 列表（含冲突诊断）。
   *
   * @param agentId - Agent 标识。
   * @returns Skill 摘要列表，专属覆盖共享后的最终结果。
   * @throws 当 Pi SDK ResourceLoader 加载失败时，Promise 会 reject。
   */
  async listAgentSkills(agentId: AgentId): Promise<SkillSummary[]> {
    return this.skillStore.listAgentSkills(agentId)
  }

  /**
   * 列出共享 Skill 列表。
   *
   * @returns 共享 Skill 摘要列表。
   * @throws 当 Pi SDK ResourceLoader 加载失败时，Promise 会 reject。
   */
  async listSharedSkills(): Promise<SkillSummary[]> {
    return this.skillStore.listSharedSkills()
  }

  /**
   * 重新加载指定 Agent 所有活跃 session 的 ResourceLoader。
   *
   * 用于 Agent 专属 Skill 变更后刷新该 Agent 的会话。
   *
   * @param agentId - Agent 标识。
   * @returns 无返回值。
   * @throws 当某个 session 的 reload 失败时，Promise 会 reject。
   */
  async reloadAgentSessions(agentId: string): Promise<void> {
    const promises: Promise<void>[] = []

    for (const [sessionId, handle] of this.sessionHandles) {
      const indexEntry = this.sessionIndexStore.getEntryOrNull(sessionId)
      if (indexEntry?.agentId === agentId && handle.reload) {
        promises.push(handle.reload())
      }
    }

    await Promise.all(promises)
  }

  /**
   * 重新加载全部活跃 session 的 ResourceLoader。
   *
   * 用于共享 Skill 变更后刷新所有 Agent 的会话。
   *
   * @returns 无返回值。
   * @throws 当某个 session 的 reload 失败时，Promise 会 reject。
   */
  async reloadAllSessions(): Promise<void> {
    const promises: Promise<void>[] = []

    for (const handle of this.sessionHandles.values()) {
      if (handle.reload) {
        promises.push(handle.reload())
      }
    }

    await Promise.all(promises)
  }

  /**
   * 安装或更新 Skill（含 SKILL.md 校验和原子写入）。
   *
   * @param params - Skill 操作参数。
   * @returns 更新后的 Skill 摘要列表。
   * @throws 当校验失败或文件操作失败时，Promise 会 reject。
   */
  async installSkill(params: SkillOperationParams): Promise<SkillSummary[]> {
    return this.skillStore.installSkill(params)
  }

  /**
   * 删除 Skill（含备份到 trash）。
   *
   * @param params - Skill 操作参数。
   * @returns 更新后的 Skill 摘要列表。
   * @throws 当文件操作失败时，Promise 会 reject。
   */
  async deleteSkill(params: SkillOperationParams): Promise<SkillSummary[]> {
    return this.skillStore.deleteSkill(params)
  }

  /**
   * 读取 Skill 安装记录。
   *
   * @returns 安装记录列表。
   * @throws 当读取失败时，Promise 会 reject。
   */
  async getSkillInstallRecords(): Promise<SkillInstallRecord[]> {
    return this.skillStore.getSkillInstallRecords()
  }

  /**
   * 更新指定 Agent 的 soul（含权限校验和备份验证）。
   *
   * @param agentId - 目标 Agent 标识。
   * @param content - 新 soul 内容。
   * @param expectedVersion - 调用方最后观察到的内容版本。
   * @returns profile 维护结果。
   * @throws 当文件操作失败时，Promise 会 reject。
   */
  async updateSoul(
    agentId: AgentId,
    content: string,
    expectedVersion: string,
  ): Promise<ProfileUpdateResult> {
    const outcome = await this.profileStore.writeSoul(
      agentId,
      content,
      expectedVersion,
    )

    // 真正写入文件时才广播事件并刷新该 Agent 会话的系统提示词。
    if (outcome.written) {
      const updatedAt =
        (await getMtimeIso(this.layout.soul(agentId))) ?? this.now()
      this.emitProfileUpdated('soul', updatedAt, agentId)
      await this.refreshAgentProfileContext(agentId).catch((error) => {
        this.emitProfileRefreshError(agentId, error)
      })
    }

    return outcome.result
  }

  /**
   * 更新共享 user profile（含备份验证和敏感信息过滤）。
   *
   * @param content - 新 user profile 内容。
   * @returns profile 维护结果。
   * @throws 当文件操作失败时，Promise 会 reject。
   */
  async updateUserProfile(content: string): Promise<ProfileUpdateResult> {
    const outcome = await this.profileStore.writeUserProfile(content)

    // 真正写入文件时才广播事件并刷新全部活跃会话。
    if (outcome.written) {
      const updatedAt =
        (await getMtimeIso(this.layout.userProfile())) ?? this.now()
      this.emitProfileUpdated('user', updatedAt)
      // profile 变化点：共享 user.md 影响所有 Agent，刷新全部活跃会话。
      await this.refreshAllProfileContext()
    }

    return outcome.result
  }

  /**
   * 读取当前 Session 的模型和 Thinking Level 信息。
   *
   * @param request - Agent 和 Session 标识。
   * @returns Session 模型信息。
   * @throws 当 Session 不存在或读取失败时，Promise 会 reject。
   */
  async getSessionModelInfo(
    request: GetSessionModelInfoRequest,
  ): Promise<SessionModelInfo> {
    this.assertKnownSession(request.sessionId, request.agentId)
    const handle = await this.ensureSessionHandle(request.sessionId)

    if (!handle.getModelInfo) {
      throw new AgentRuntimeError({
        code: 'driver-unavailable',
        message: '当前会话不支持读取模型信息。',
        recoverable: true,
      })
    }

    return handle.getModelInfo()
  }

  /**
   * 切换当前 Session 的 Provider 和 Model。
   *
   * @param request - Agent、Session 标识和目标 Provider/Model。
   * @returns 切换后的模型信息。
   * @throws 当 Session 不存在或模型切换失败时，Promise 会 reject。
   */
  async setSessionModel(
    request: SetSessionModelRequest,
  ): Promise<SessionModelInfo> {
    this.assertKnownSession(request.sessionId, request.agentId)
    const handle = await this.ensureSessionHandle(request.sessionId)

    if (!handle.setModel) {
      throw new AgentRuntimeError({
        code: 'driver-unavailable',
        message: '当前会话不支持切换模型。',
        recoverable: true,
      })
    }

    // 读取目标 Provider 的 API Key 用于跨 Provider 切换
    const indexEntry = this.sessionIndexStore.getEntry(request.sessionId)
    const configuration = await this.configStore.readRequired(
      indexEntry.agentId,
    )
    const targetApiKey =
      request.providerId !== configuration.providerId
        ? await this.configStore.readProviderApiKey(request.providerId)
        : undefined

    await handle.setModel(request.providerId, request.modelId, targetApiKey)
    await this.sessionIndexStore.updateEntry(request.sessionId, {
      provider: request.providerId,
      model: request.modelId,
    })

    if (!handle.getModelInfo) {
      throw new AgentRuntimeError({
        code: 'driver-unavailable',
        message: '当前会话不支持读取模型信息。',
        recoverable: true,
      })
    }

    return handle.getModelInfo()
  }

  /**
   * 切换当前 Session 的 Thinking Level。
   *
   * @param request - Agent、Session 标识和目标 Thinking Level。
   * @returns 切换后的模型信息。
   * @throws 当 Session 不存在或不支持 Thinking 时，Promise 会 reject。
   */
  async setSessionThinkingLevel(
    request: SetSessionThinkingLevelRequest,
  ): Promise<SessionModelInfo> {
    this.assertKnownSession(request.sessionId, request.agentId)
    const handle = await this.ensureSessionHandle(request.sessionId)

    if (!handle.setThinkingLevel) {
      throw new AgentRuntimeError({
        code: 'driver-unavailable',
        message: '当前会话不支持切换 Thinking Level。',
        recoverable: true,
      })
    }

    await handle.setThinkingLevel(request.level)

    if (!handle.getModelInfo) {
      throw new AgentRuntimeError({
        code: 'driver-unavailable',
        message: '当前会话不支持读取模型信息。',
        recoverable: true,
      })
    }

    return handle.getModelInfo()
  }

  /**
   * 从最近的备份恢复配置文件。
   *
   * @returns 恢复后的 RuntimeSnapshot。
   * @throws 当备份不存在或恢复失败时，Promise 会 reject。
   */
  async restoreFromBackup(): Promise<RuntimeSnapshot> {
    await this.configStore.restore()
    return this.readRuntimeSnapshot()
  }

  /**
   * 删除配置文件和备份（不删除 Agent 数据、用户资料或 Pi session）。
   *
   * @returns 无返回值。
   * @throws 当文件删除失败时，Promise 会 reject。
   */
  async resetConfiguration(): Promise<void> {
    await this.configStore.reset()
  }

  /**
   * 确保指定会话已从索引加载到内存。
   *
   * @param sessionId - 需要加载的会话标识。
   * @returns 无返回值。
   * @throws 当索引读取失败时，Promise 会 reject。
   */
  protected async ensureSessionLoaded(sessionId: string): Promise<void> {
    if (this.sessionIndexStore.hasSummary(sessionId)) {
      return
    }

    await this.sessionIndexStore.load()
  }

  /**
   * 确保指定会话已有 Pi SDK session handle，历史会话会通过 openSession 打开。
   *
   * @param sessionId - 需要打开的会话标识。
   * @returns 可运行 prompt 的 Pi SDK session handle。
   * @throws 当会话不存在、配置缺失或 SDK 打开失败时，Promise 会 reject。
   */
  protected async ensureSessionHandle(
    sessionId: string,
  ): Promise<PiSdkSessionHandle> {
    const existingHandle = this.sessionHandles.get(sessionId)

    if (existingHandle) {
      return existingHandle
    }

    const indexEntry = this.sessionIndexStore.getEntry(sessionId)
    const configuration = await this.configStore.readRequired(
      indexEntry.agentId,
    )
    const cwd =
      indexEntry.agentId === TANGYUAN_DEFAULT_AGENT_ID
        ? this.layout.agentHome()
        : this.layout.workspace(indexEntry.agentId)
    const openRequest = {
      ...configuration,
      sessionId,
      sdkSessionFile: indexEntry.sdkSessionFile,
      cwd,
      agentSkillsPath: this.layout.agentSkills(indexEntry.agentId),
      sharedSkillsPath: this.layout.sharedSkills(),
      onUpdateSoul: this.createSessionSoulUpdater(
        sessionId,
        indexEntry.agentId,
      ),
    }
    const soul = await this.profileStore.readSoul(indexEntry.agentId)
    this.sessionSoulVersions.set(sessionId, soul.version)
    const handle = await this.gateway.openSession(
      this.toolApprovalGateway
        ? { ...openRequest, toolApprovalGateway: this.toolApprovalGateway }
        : openRequest,
    )
    this.sessionHandles.set(sessionId, handle)
    // 身份上下文走系统提示词：重启后打开历史会话时注入并 reload 使其生效。
    if (handle.setSystemPromptContext) {
      handle.setSystemPromptContext(
        await this.profileStore.buildSystemPromptContext(indexEntry.agentId),
      )
      await handle.reload?.()
    }

    return handle
  }

  /**
   * 基于已有索引生成下一个简单递增会话标识。
   *
   * @param entries - 当前已存在的索引条目。
   * @returns 形如 session-N 的新会话标识。
   * @throws 此方法不会主动抛出错误。
   */
  protected createNextSessionId(): string {
    return crypto.randomUUID()
  }

  /** 广播 profile 更新时间，不向消息流追加系统消息。 */
  protected emitProfileUpdated(
    target: 'soul' | 'user',
    updatedAt: string,
    eventAgentId: AgentId = TANGYUAN_DEFAULT_AGENT_ID,
  ): void {
    this.emit({
      type: 'profile-updated',
      agentId: eventAgentId,
      target,
      updatedAt,
      occurredAt: this.now(),
    })
  }

  /**
   * 重算身份上下文并刷新到指定 Agent 的所有活跃会话。
   *
   * 先异步算好片段，再对每个 handle 同步 set + reload，绕开
   * appendSystemPromptOverride 同步签名无法读文件的约束。仅在 profile
   * 变化点（建会话、打开会话、回合结束、设置中修改 profile）调用。
   *
   * @param agentId - Agent 标识。
   * @returns 无返回值；无匹配 handle 时静默返回。
   * @throws 当 profile 读取或 reload 失败时，Promise 会 reject。
   */
  protected async refreshAgentProfileContext(agentId: AgentId): Promise<void> {
    const [context, soul] = await Promise.all([
      this.profileStore.buildSystemPromptContext(agentId),
      this.profileStore.readSoul(agentId),
    ])
    const promises: Promise<void>[] = []

    for (const [sessionId, handle] of this.sessionHandles) {
      if (
        this.sessionIndexStore.getEntryOrNull(sessionId)?.agentId !== agentId ||
        !handle.setSystemPromptContext
      ) {
        continue
      }
      if (this.activeRunIds.has(sessionId)) {
        this.pendingProfileRefreshes.add(sessionId)
        continue
      }
      handle.setSystemPromptContext(context)
      if (handle.reload) {
        promises.push(
          handle.reload().then(() => {
            this.sessionSoulVersions.set(sessionId, soul.version)
          }),
        )
      } else {
        this.sessionSoulVersions.set(sessionId, soul.version)
      }
    }

    await Promise.all(promises)
  }

  /** 创建绑定到单个会话及其 Agent 的受控灵魂更新回调。 */
  protected createSessionSoulUpdater(
    sessionId: string,
    agentId: AgentId,
  ): (content: string) => Promise<ProfileUpdateResult> {
    return async (content: string) => {
      const expectedVersion =
        this.sessionSoulVersions.get(sessionId) ??
        (await this.profileStore.readSoul(agentId)).version
      const result = await this.updateSoul(agentId, content, expectedVersion)

      if (result.status !== 'rejected') {
        this.sessionSoulVersions.set(sessionId, result.version)
      }

      return result
    }
  }

  /** 在生成结束后刷新单个排队会话，不影响已经完成的回复。 */
  protected async refreshSessionProfileContext(sessionId: string): Promise<void> {
    const handle = this.sessionHandles.get(sessionId)
    const agentId = this.sessionIndexStore.getEntryOrNull(sessionId)?.agentId
    if (!handle?.setSystemPromptContext || !agentId) return

    const [context, soul] = await Promise.all([
      this.profileStore.buildSystemPromptContext(agentId),
      this.profileStore.readSoul(agentId),
    ])
    handle.setSystemPromptContext(context)
    await handle.reload?.()
    this.sessionSoulVersions.set(sessionId, soul.version)
  }

  /** 上下文刷新失败只广播可恢复错误，不改变已经完成的 profile 写入结果。 */
  protected emitProfileRefreshError(agentId: AgentId, error: unknown): void {
    this.emit({
      type: 'runtime-error',
      agentId,
      error: {
        code: 'unknown',
        message: `刷新 Agent 灵魂上下文失败：${sanitizeErrorMessage(error)}`,
        recoverable: true,
      },
      occurredAt: this.now(),
    })
  }

  /**
   * 刷新全部活跃会话的身份上下文。
   *
   * 用于共享 user.md 变更后刷新所有 Agent 的会话。
   *
   * @returns 无返回值。
   * @throws 当 profile 读取或 reload 失败时，Promise 会 reject。
   */
  protected async refreshAllProfileContext(): Promise<void> {
    const agentIds = new Set<AgentId>()
    for (const sessionId of this.sessionHandles.keys()) {
      const agentId = this.sessionIndexStore.getEntryOrNull(sessionId)?.agentId
      if (agentId) {
        agentIds.add(agentId)
      }
    }

    await Promise.all(
      [...agentIds].map((agentId) => this.refreshAgentProfileContext(agentId)),
    )
  }

  /**
   * 确认会话已存在。
   *
   * @param sessionId - 需要确认的会话标识。
   * @param agentId - 会话必须归属的 Agent 标识。
   * @returns 对应的会话摘要。
   * @throws 当会话不存在时抛出 AgentRuntimeError。
   */
  protected assertKnownSession(
    sessionId: string,
    agentId = TANGYUAN_DEFAULT_AGENT_ID,
  ): AgentSessionSummary {
    const session = this.sessionIndexStore.getSummary(sessionId)

    if (!session) {
      throw new AgentRuntimeError({
        code: 'session-not-found',
        message: `找不到会话 ${sessionId}。`,
        recoverable: true,
      })
    }

    if (session.agentId !== agentId) {
      throw new AgentRuntimeError({
        code: 'session-not-found',
        message: `会话 ${sessionId} 不属于 Agent ${agentId}。`,
        recoverable: true,
      })
    }

    return session
  }

  /**
   * 向本地 transcript 追加一条标准消息。
   *
   * @param input - 消息归属、角色和文本内容。
   * @returns 已写入本地 transcript 的标准消息。
   * @throws 当会话不存在时抛出 AgentRuntimeError。
   */
  protected appendMessage(input: {
    agentId: AgentId
    sessionId: string
    role: InternalMessage['role']
    content: string
  }): InternalMessage {
    this.assertKnownSession(input.sessionId, input.agentId)

    return this.messageStore.append(input)
  }

  /**
   * 为指定会话创建单次运行标识。
   *
   * @param sessionId - 需要开始运行的会话标识。
   * @returns 当前会话下递增且稳定的运行标识。
   * @throws 此方法不会主动抛出错误。
   */
  protected createRunId(sessionId: string): string {
    const nextSequence = (this.runSequenceBySession.get(sessionId) ?? 0) + 1
    this.runSequenceBySession.set(sessionId, nextSequence)

    return `${sessionId}-run-${nextSequence}`
  }

  /**
   * 更新会话运行状态并广播状态事件。
   *
   * @param sessionId - 需要更新的会话标识。
   * @param state - 新的运行状态。
   * @returns 更新后的会话摘要。
   * @throws 当会话不存在时抛出 AgentRuntimeError。
   */
  protected updateSessionState(
    sessionId: string,
    state: AgentRunState,
  ): AgentSessionSummary {
    const nextSession = this.sessionIndexStore.setSummaryState(
      sessionId,
      state,
      this.now(),
    )
    this.emit({
      type: 'run-state-changed',
      agentId: nextSession.agentId,
      sessionId,
      state,
      occurredAt: this.now(),
    })

    return nextSession
  }

  /**
   * 向当前订阅者广播标准事件。
   *
   * @param event - 需要广播的标准 Agent 事件。
   * @returns 无返回值。
   * @throws 订阅者回调抛出的错误会透传给调用方。
   */
  protected emit(event: DriverEvent): void {
    for (const listener of this.listeners) {
      // DriverEvent is a superset of AgentEvent; listeners only process
      // the subset of events that belong to the public AgentEvent union.
      ;(listener as AgentEventListener)(event as AgentEvent)
    }
  }
}
