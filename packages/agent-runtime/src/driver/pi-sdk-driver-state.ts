import { DefaultProfileModule } from '../runtime/default-profile-module'
import { DefaultRuntimeConfiguration } from '../runtime/runtime-configuration'
import { ConfigStore, DirectoryLayout } from '../core'
import { AgentRegistry } from '../agent'
import { SkillStore } from '../skill'
import { ProfileStore } from '../profile'
import { SessionIndexStore } from '../session/session-index-store'
import { MessageStore } from '../session/message-store'
import { AttemptLifecycle } from '../session/attempt-lifecycle'
import { AgentRuntimeError, sanitizeErrorMessage } from '../core'
import {
  YUANXIAO_DEFAULT_AGENT_ID,
  type AgentEvent,
  type AgentEventListener,
  type AgentId,
  type AgentRunState,
  type AgentSessionSummary,
  type AgentEventSubscription,
  type ConfigEncryptionAdapter,
  type GetSessionModelInfoRequest,
  type ProfileUpdateResult,
  type RuntimeConfiguration,
  type SessionModelInfo,
  type SetSessionModelRequest,
  type SetSessionThinkingLevelRequest,
  type TranscriptSnapshot,
} from '@yuanxiao/contracts'
import { createDefaultStores } from '../stores'
import type { DefaultStores } from '../stores'
import { EventBus } from '../stores/event-bus'
import type {
  DriverEvent,
  InternalMessage,
  PersistedSessionIndexEntry,
  PiSdkDriverOptions,
  PiSdkGateway,
  PiSdkSessionHandle,
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
  protected readonly attemptLifecycle: AttemptLifecycle
  protected readonly configurationModule: DefaultRuntimeConfiguration
  protected readonly profileModule: DefaultProfileModule
  protected readonly gateway: PiSdkGateway
  protected readonly encryptionAdapter: ConfigEncryptionAdapter | null
  /** 内部事件唯一通道：Store 与 Driver 自身事件都经 EventBus 汇聚。 */
  protected readonly eventBus: EventBus
  protected readonly listeners = new Set<AgentEventListener>()
  protected readonly transcriptCache = new Map<string, TranscriptSnapshot>()
  protected readonly sessionHandles = new Map<string, PiSdkSessionHandle>()
  protected readonly sessionSoulVersions = new Map<string, string>()
  protected readonly sessionUserProfileVersions = new Map<string, string>()
  protected readonly pendingProfileRefreshes = new Set<string>()
  protected readonly activeRunIds = new Map<string, string>()
  protected readonly runSequenceBySession = new Map<string, number>()

  /**
   * 创建 Pi SDK Driver 骨架。
   *
   * @param options - 时间函数、默认 Agent Home 路径和文件系统根目录等可替换依赖。
   * @returns PiSdkDriver 实例。
   * @throws 此构造方法不会主动抛出错误。
   */
  constructor(options: PiSdkDriverOptions = {}, stores?: DefaultStores) {
    // 生产代码由 createDefaultStores 创建并注入；未注入时（如 Driver 单测）
    // 也走同一工厂，保证只有一套 Store 装配逻辑。
    const resolved = stores ?? createDefaultStores(options)
    this.now = resolved.now
    this.agentHomePath = resolved.agentHomePath
    this.fsRoot = resolved.fsRoot
    this.userDataPath = resolved.userDataPath
    this.layout = resolved.layout
    this.gateway = resolved.gateway
    this.encryptionAdapter = resolved.encryptionAdapter
    this.configStore = resolved.configStore
    this.agentRegistry = resolved.agentRegistry
    this.skillStore = resolved.skillStore
    this.profileStore = resolved.profileStore
    this.sessionIndexStore = resolved.sessionIndexStore
    this.messageStore = resolved.messageStore
    this.attemptLifecycle = new AttemptLifecycle({
      sessionIndexStore: this.sessionIndexStore,
      messageStore: this.messageStore,
      emit: (event) => this.emit(event),
      updateSessionState: async (sessionId, state) => {
        await this.updateSessionState(sessionId, state)
      },
      invalidateTranscript: (sessionId) => {
        this.transcriptCache.delete(sessionId)
      },
      performBootstrapCompletionGating: () =>
        this.profileStore.performBootstrapCompletionGating(),
      afterRun: async (sessionId, agentId) => {
        if (this.pendingProfileRefreshes.delete(sessionId)) {
          await this.refreshSessionProfileContext(sessionId).catch((error) => {
            this.emitProfileRefreshError(agentId, error)
          })
        }
      },
      afterFirstRun: async (
        sessionId,
        agentId,
        { userMessage, assistantReply },
      ) => {
        // 仅对根会话（非分叉）生成标题。
        const indexEntry = await this.sessionIndexStore
          .resolveEntry(sessionId)
          .catch(() => null)
        if (!indexEntry || indexEntry.forkedFrom) return

        try {
          const config = await this.resolveSessionConfiguration(indexEntry)
          const prompt = buildTitleGenerationPrompt(userMessage, assistantReply)
          const raw = await this.gateway.singleTurnCompletion({
            ...config,
            prompt,
          })
          const title = sanitizeTitleResponse(raw)
          if (!title) return

          await this.sessionIndexStore.updateTitle(sessionId, title)
          this.emit({
            type: 'session-title-changed',
            agentId,
            sessionId,
            title,
            occurredAt: this.now(),
          })
        } catch {
          // fire-and-forget：标题生成失败静默忽略。
        }
      },
      now: this.now,
    })
    this.configurationModule = resolved.configurationModule
    this.profileModule = resolved.profileModule
    this.eventBus = resolved.eventBus

    // EventBus 是内部事件唯一通道：订阅后把 Store 发出的事件转发给公开订阅者
    this.eventBus.subscribe((event) => {
      for (const listener of this.listeners) {
        ;(listener as AgentEventListener)(event as AgentEvent)
      }
    })
    // Profile 变更后的会话上下文刷新绑定到 Driver 持有的活跃 session
    resolved.profileModule.setRefreshContextHandlers({
      refreshAgentContext: (agentId) =>
        this.refreshAgentProfileContext(agentId),
      refreshAllContexts: () => this.refreshAllProfileContext(),
    })
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

    const indexEntry = await this.sessionIndexStore.resolveEntry(sessionId)
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

    if (!handle) {
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
    const indexEntry = await this.sessionIndexStore.resolveEntry(sessionId)
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
    const handle = await this.gateway.openSession(openRequest)
    this.sessionHandles.set(sessionId, handle)
    // 会话运行配置属于会话：Thinking Level 由元宵索引恢复，
    // 不依赖 Pi session 文件是否记住上次取值。
    if (indexEntry.thinkingLevel) {
      await handle.setThinkingLevel(indexEntry.thinkingLevel)
    }
    // 身份上下文走系统提示词：重启后打开历史会话时注入并 reload 使其生效。
    handle.setSystemPromptContext(
      await this.profileStore.buildSystemPromptContext(indexEntry.agentId),
    )
    await handle.reload()

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
        (await this.sessionIndexStore.findEntry(sessionId))?.agentId !== agentId
      ) {
        continue
      }
      if (this.attemptLifecycle.getActiveRunId(sessionId)) {
        this.pendingProfileRefreshes.add(sessionId)
        continue
      }
      handle.setSystemPromptContext(context)
      promises.push(
        handle.reload().then(() => {
          this.sessionSoulVersions.set(sessionId, soul.version)
          this.sessionUserProfileVersions.set(sessionId, userProfile.version)
        }),
      )
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
    const agentId = (await this.sessionIndexStore.findEntry(sessionId))?.agentId
    if (!handle || !agentId) return

    const [context, soul, userProfile] = await Promise.all([
      this.profileStore.buildSystemPromptContext(agentId),
      this.profileStore.readSoul(agentId),
      this.profileStore.readUserProfile(),
    ])
    handle.setSystemPromptContext(context)
    await handle.reload()
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
      const agentId = (await this.sessionIndexStore.findEntry(sessionId))
        ?.agentId
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
  protected async assertKnownSession(
    sessionId: string,
    agentId = YUANXIAO_DEFAULT_AGENT_ID,
  ): Promise<AgentSessionSummary> {
    return this.sessionIndexStore.resolveSession(sessionId, agentId)
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
  protected async updateSessionState(
    sessionId: string,
    state: AgentRunState,
  ): Promise<AgentSessionSummary> {
    const occurredAt = this.now()
    const nextSession = await this.sessionIndexStore.setState(
      sessionId,
      state,
      occurredAt,
    )
    this.emit({
      type: 'run-state-changed',
      agentId: nextSession.agentId,
      sessionId,
      state,
      occurredAt,
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
    // DriverEvent is a superset of AgentEvent；订阅端只处理属于公开
    // AgentEvent 联合的子集。经 EventBus 汇聚后统一转发给公开订阅者。
    this.eventBus.emit(event as AgentEvent)
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
      const indexEntry = await this.sessionIndexStore.findEntry(sessionId)
      if (indexEntry?.agentId === agentId) {
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
      promises.push(handle.reload())
    }

    await Promise.all(promises)
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
    await this.assertKnownSession(request.sessionId, request.agentId)
    const handle = await this.ensureSessionHandle(request.sessionId)

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
    await this.assertKnownSession(request.sessionId, request.agentId)
    const handle = await this.ensureSessionHandle(request.sessionId)

    // 读取目标 Provider 的 API Key 用于跨 Provider 切换
    const indexEntry = await this.sessionIndexStore.resolveEntry(
      request.sessionId,
    )
    const configuration = await this.configStore.readRequired(
      indexEntry.agentId,
    )
    const targetApiKey =
      request.providerId !== (indexEntry.provider || configuration.providerId)
        ? await this.configStore.readProviderApiKey(request.providerId)
        : undefined

    await handle.setModel(request.providerId, request.modelId, targetApiKey)
    await this.sessionIndexStore.setModel(
      request.sessionId,
      request.providerId,
      request.modelId,
    )

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
    await this.assertKnownSession(request.sessionId, request.agentId)
    const handle = await this.ensureSessionHandle(request.sessionId)

    await handle.setThinkingLevel(request.level)

    const info = await handle.getModelInfo()
    // Thinking Level 属于会话运行配置：持久化后重新打开会话才能恢复，
    // 而不是静默回退到 Agent 默认配置。SDK 会按模型能力夹紧请求值，
    // 因此只保存会话实际采用的等级。
    if (info.thinkingLevel !== null) {
      await this.sessionIndexStore.setThinkingLevel(
        request.sessionId,
        info.thinkingLevel,
      )
    }

    return info
  }
}

/**
 * 构建用于生成会话标题的单轮 LLM prompt。
 *
 * 只传入用户消息和助手首句回复，各截断至 500 字符，保持 prompt 轻量。
 */
function buildTitleGenerationPrompt(
  userMessage: string,
  assistantReply: string,
): string {
  const parts = [`用户：${userMessage}`]
  if (assistantReply) {
    parts.push(`助手：${assistantReply}`)
  }
  return (
    `根据以下对话内容，用一句话概括本次会话的主题，生成一个简洁的标题。\n` +
    `要求：不超过 20 个字，不加引号、冒号或标点，直接输出标题文本。\n\n` +
    parts.join('\n')
  )
}

/**
 * 清理 LLM 返回的标题文本：去除首尾空白、引号与常见前缀。
 *
 * @returns 清理后的标题；结果为空时返回 null，让调用方保留原有标题。
 */
function sanitizeTitleResponse(raw: string | null): string | null {
  if (!raw) return null
  const cleaned = raw
    .trim()
    // 去除首尾引号（直引号与弯引号）
    .replace(/^["'""'']+|["'""'']+$/g, '')
    // 去除"标题："前缀
    .replace(/^标题[：:]\s*/, '')
    .trim()
    // 截断至 40 字符上限
    .slice(0, 40)
  return cleaned || null
}
