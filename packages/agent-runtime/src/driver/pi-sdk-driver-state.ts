import { homedir } from 'node:os'
import { join } from 'node:path'
import { RealPiSdkGateway } from '../runtime/gateway'
import { DefaultProfileModule } from '../runtime/default-profile-module'
import { DefaultRuntimeConfiguration } from '../runtime/runtime-configuration'
import { ConfigStore, DirectoryLayout } from '../core'
import { AgentRegistry } from '../agent'
import { SkillStore } from '../skill'
import { ProfileStore } from '../profile'
import { SessionIndexStore } from '../session/session-index-store'
import { MessageStore } from '../session/message-store'
import { AgentRuntimeError, sanitizeErrorMessage } from '../core'
import {
  YUANXIAO_DEFAULT_AGENT_ID,
  type AgentEvent,
  type AgentEventListener,
  type AgentId,
  type AgentRunState,
  type AgentSessionSummary,
  type ConfigEncryptionAdapter,
  type ProfileUpdateResult,
  type RuntimeConfiguration,
  type TranscriptSnapshot,
} from '@yuanxiao/contracts'
import type {
  DriverEvent,
  InternalMessage,
  PersistedSessionIndexEntry,
  PiSdkDriverOptions,
  PiSdkGateway,
  PiSdkSessionHandle,
  ToolApprovalGateway,
} from './pi-sdk-driver-contracts'

export abstract class PiSdkDriverState {
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
  protected readonly configurationModule: DefaultRuntimeConfiguration
  protected readonly profileModule: DefaultProfileModule
  protected readonly gateway: PiSdkGateway
  protected readonly encryptionAdapter: ConfigEncryptionAdapter | null
  protected readonly listeners = new Set<AgentEventListener>()
  protected readonly transcriptCache = new Map<string, TranscriptSnapshot>()
  protected readonly sessionHandles = new Map<string, PiSdkSessionHandle>()
  protected readonly sessionSoulVersions = new Map<string, string>()
  protected readonly sessionUserProfileVersions = new Map<string, string>()
  protected readonly pendingProfileRefreshes = new Set<string>()
  protected readonly activeRunIds = new Map<string, string>()
  protected readonly runSequenceBySession = new Map<string, number>()
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
    this.agentHomePath = options.agentHomePath ?? '~/.yuanxiao/agents/yuanxiao'
    this.fsRoot = options.fsRoot ?? homedir()
    this.userDataPath = options.userDataPath ?? join(this.fsRoot, '.yuanxiao')
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
    this.configurationModule = new DefaultRuntimeConfiguration({
      agentHomePath: this.agentHomePath,
      agentRegistry: this.agentRegistry,
      configStore: this.configStore,
      gateway: this.gateway,
      now: this.now,
      profileStore: this.profileStore,
    })
    this.profileModule = new DefaultProfileModule({
      emit: (event) => this.emit(event),
      layout: this.layout,
      now: this.now,
      profileStore: this.profileStore,
      refreshAgentContext: (agentId) =>
        this.refreshAgentProfileContext(agentId),
      refreshAllContexts: () => this.refreshAllProfileContext(),
    })
    this.toolApprovalGateway = options.toolApprovalGateway
  }

  /** 返回 Runtime 使用的 Agent 生命周期模块。 */
  getAgentLifecycleModule(): AgentRegistry {
    return this.agentRegistry
  }

  /** 返回 Runtime 使用的 Skill 持久化模块。 */
  getSkillModule(): SkillStore {
    return this.skillStore
  }

  /** 返回 Runtime 使用的配置模块。 */
  getConfigurationModule(): DefaultRuntimeConfiguration {
    return this.configurationModule
  }

  /** 返回 Runtime 使用的 Profile 模块。 */
  getProfileModule(): DefaultProfileModule {
    return this.profileModule
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
    const configuration = await this.resolveSessionConfiguration(indexEntry)

    return this.openSessionHandle(sessionId, configuration)
  }

  /**
   * 读取某会话当前有效的 Provider、Model 与 Thinking Level。
   *
   * 会话已打开时以运行中的 handle 为真相（用户可能刚切过模型），
   * 否则回退到索引中持久化的会话运行配置。
   *
   * @param sessionId - 会话标识。
   * @param indexEntry - 该会话的索引条目。
   * @returns 有效的 Provider、Model 和可选 Thinking Level。
   * @throws 此方法不会主动抛出错误。
   */
  protected async readEffectiveSessionConfig(
    sessionId: string,
    indexEntry: PersistedSessionIndexEntry,
  ): Promise<{
    providerId: string
    modelId: string
    thinkingLevel?: string
  }> {
    const fallback = {
      providerId: indexEntry.provider,
      modelId: indexEntry.model,
      ...(indexEntry.thinkingLevel !== undefined
        ? { thinkingLevel: indexEntry.thinkingLevel }
        : {}),
    }
    const handle = this.sessionHandles.get(sessionId)

    if (!handle?.getModelInfo) {
      return fallback
    }

    try {
      const info = await handle.getModelInfo()

      return {
        providerId: info.providerId || fallback.providerId,
        modelId: info.modelId || fallback.modelId,
        ...(info.thinkingLevel
          ? { thinkingLevel: info.thinkingLevel }
          : fallback.thinkingLevel !== undefined
            ? { thinkingLevel: fallback.thinkingLevel }
            : {}),
      }
    } catch {
      // 运行中会话读不出模型信息时仍可按索引继承。
      return fallback
    }
  }

  /**
   * 解析某个会话应当生效的会话运行配置。
   *
   * 会话运行配置属于会话本身：索引里记录的 Provider/Model 优先于 Agent 默认配置，
   * 只在会话尚未记录时回退到 Agent 默认值。跨 Provider 时补取对应 API Key。
   *
   * @param indexEntry - 会话索引条目。
   * @returns 该会话生效的运行配置。
   * @throws 当 Agent 配置缺失或会话 Provider 未配置 API Key 时，Promise 会 reject。
   */
  protected async resolveSessionConfiguration(
    indexEntry: PersistedSessionIndexEntry,
  ): Promise<RuntimeConfiguration> {
    const agentConfiguration = await this.configStore.readRequired(
      indexEntry.agentId,
    )

    if (!indexEntry.provider || !indexEntry.model) {
      return agentConfiguration
    }

    if (indexEntry.provider === agentConfiguration.providerId) {
      return {
        providerId: indexEntry.provider,
        modelId: indexEntry.model,
        apiKey: agentConfiguration.apiKey,
      }
    }

    const apiKey = await this.configStore.readProviderApiKey(
      indexEntry.provider,
    )

    if (!apiKey) {
      throw new AgentRuntimeError({
        code: 'configuration-missing',
        message: `模型服务「${indexEntry.provider}」尚未配置 API Key（接口密钥），无法打开该会话。`,
        recoverable: true,
      })
    }

    return {
      providerId: indexEntry.provider,
      modelId: indexEntry.model,
      apiKey,
    }
  }

  /**
   * 以指定运行配置打开会话的 Pi SDK session handle 并登记到运行状态。
   *
   * @param sessionId - 已存在于会话索引中的会话标识。
   * @param configuration - 打开该会话使用的 Provider、Model 与 API Key。
   * @returns 可运行 prompt 的 Pi SDK session handle。
   * @throws 当会话索引缺失或 SDK 打开失败时，Promise 会 reject。
   */
  protected async openSessionHandle(
    sessionId: string,
    configuration: RuntimeConfiguration,
  ): Promise<PiSdkSessionHandle> {
    const indexEntry = this.sessionIndexStore.getEntry(sessionId)
    const cwd =
      indexEntry.agentId === YUANXIAO_DEFAULT_AGENT_ID
        ? this.layout.agentHome()
        : this.layout.workspace(indexEntry.agentId)
    const openRequest = {
      ...configuration,
      agentId: indexEntry.agentId,
      sessionId,
      sdkSessionFile: indexEntry.sdkSessionFile,
      cwd,
      agentSkillsPath: this.layout.agentSkills(indexEntry.agentId),
      sharedSkillsPath: this.layout.sharedSkills(),
      onUpdateSoul: this.createSessionSoulUpdater(
        sessionId,
        indexEntry.agentId,
      ),
      onUpdateUserProfile: this.createSessionUserProfileUpdater(sessionId),
    }
    const [soul, userProfile] = await Promise.all([
      this.profileStore.readSoul(indexEntry.agentId),
      this.profileStore.readUserProfile(),
    ])
    this.sessionSoulVersions.set(sessionId, soul.version)
    this.sessionUserProfileVersions.set(sessionId, userProfile.version)
    const handle = await this.gateway.openSession(
      this.toolApprovalGateway
        ? { ...openRequest, toolApprovalGateway: this.toolApprovalGateway }
        : openRequest,
    )
    this.sessionHandles.set(sessionId, handle)
    // 会话运行配置属于会话：Thinking Level 由元宵索引恢复，
    // 不依赖 Pi session 文件是否记住上次取值。
    if (indexEntry.thinkingLevel && handle.setThinkingLevel) {
      await handle.setThinkingLevel(indexEntry.thinkingLevel)
    }
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
    const [context, soul, userProfile] = await Promise.all([
      this.profileStore.buildSystemPromptContext(agentId),
      this.profileStore.readSoul(agentId),
      this.profileStore.readUserProfile(),
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
            this.sessionUserProfileVersions.set(sessionId, userProfile.version)
          }),
        )
      } else {
        this.sessionSoulVersions.set(sessionId, soul.version)
        this.sessionUserProfileVersions.set(sessionId, userProfile.version)
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
      const result = await this.profileModule.updateSoul(
        agentId,
        content,
        expectedVersion,
      )

      if (result.status !== 'rejected') {
        this.sessionSoulVersions.set(sessionId, result.version)
      }

      return result
    }
  }

  /** 创建绑定到单个会话最后观察版本的共享用户画像更新回调。 */
  protected createSessionUserProfileUpdater(
    sessionId: string,
  ): (content: string) => Promise<ProfileUpdateResult> {
    return async (content: string) => {
      const expectedVersion =
        this.sessionUserProfileVersions.get(sessionId) ??
        (await this.profileStore.readUserProfile()).version
      const result = await this.profileModule.updateUserProfile(
        content,
        expectedVersion,
      )

      if (result.status !== 'rejected') {
        this.sessionUserProfileVersions.set(sessionId, result.version)
      }

      return result
    }
  }

  /** 在生成结束后刷新单个排队会话，不影响已经完成的回复。 */
  protected async refreshSessionProfileContext(
    sessionId: string,
  ): Promise<void> {
    const handle = this.sessionHandles.get(sessionId)
    const agentId = this.sessionIndexStore.getEntryOrNull(sessionId)?.agentId
    if (!handle?.setSystemPromptContext || !agentId) return

    const [context, soul, userProfile] = await Promise.all([
      this.profileStore.buildSystemPromptContext(agentId),
      this.profileStore.readSoul(agentId),
      this.profileStore.readUserProfile(),
    ])
    handle.setSystemPromptContext(context)
    await handle.reload?.()
    this.sessionSoulVersions.set(sessionId, soul.version)
    this.sessionUserProfileVersions.set(sessionId, userProfile.version)
  }

  /** 上下文刷新失败只广播可恢复错误，不改变已经完成的 profile 写入结果。 */
  protected emitProfileRefreshError(agentId: AgentId, error: unknown): void {
    this.emit({
      type: 'runtime-error',
      agentId,
      error: {
        code: 'unknown',
        message: `刷新 Agent 身份上下文失败：${sanitizeErrorMessage(error)}`,
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
    agentId = YUANXIAO_DEFAULT_AGENT_ID,
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

    if (session.archivedAt !== undefined) {
      throw new AgentRuntimeError({
        code: 'session-not-found',
        message: `会话 ${sessionId} 已归档，请先恢复后再打开。`,
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
