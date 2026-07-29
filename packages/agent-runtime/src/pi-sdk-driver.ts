/* eslint-disable max-lines -- PiSdkDriver 已从公共 barrel 拆出，后续按独立职责继续演进 */
import { mkdir, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import type {
  PersistedAttemptEntry,
  PersistedSessionIndexEntry,
} from './session-index-store'
import { AgentRuntimeError } from './errors'
import {
  isAbortError,
  mapPiSdkStreamEventToActivity,
  sanitizeErrorMessage,
  normalizeRuntimeConfiguration,
  buildInternalConfigForSave,
  createMessagePreview,
} from './utils'
import {
  TANGYUAN_DEFAULT_AGENT_ID,
  type AgentId,
  type AgentSessionSummary,
  type CancelConfigurationVerificationRequest,
  type CancelRunRequest,
  type CreateSessionRequest,
  type ForkSessionRequest,
  type GetSessionMessagesRequest,
  type ListSessionsRequest,
  type RuntimeConfiguration,
  type RuntimeSnapshot,
  type SendMessageRequest,
  type TranscriptSnapshot,
} from '@tangyuan/contracts'
import type {
  AgentSessionDriver,
  InternalMessage,
  PiSdkCreateSessionRequest,
  PiSdkSessionHandle,
  RuntimeResourceDriver,
} from './pi-sdk-driver-contracts'

import { PiSdkDriverResources } from './pi-sdk-driver-resources'

const CONFIGURATION_VERIFICATION_PROMPT = 'Reply with OK.'

/**
 * Pi Agent SDK 的 v1 适配器骨架。
 */
export class PiSdkDriver
  extends PiSdkDriverResources
  implements AgentSessionDriver, RuntimeResourceDriver
{
  /**
   * 读取当前运行时资源快照。
   *
   * @returns 当前 RuntimeSnapshot。
   * @throws 当默认 Agent Home 初始化失败时，Promise 会 reject。
   */
  async getSnapshot(): Promise<RuntimeSnapshot> {
    return this.readRuntimeSnapshot()
  }

  /**
   * 刷新运行时资源。
   *
   * @returns 刷新后的 RuntimeSnapshot。
   * @throws 当默认 Agent Home 初始化失败时，Promise 会 reject。
   */
  async refresh(): Promise<RuntimeSnapshot> {
    return this.readRuntimeSnapshot()
  }

  /**
   * 使用真实 Pi SDK 验证 Provider/API Key/Model 后保存配置。
   *
   * @param configuration - 用户输入的模型服务、模型和接口密钥。
   * @returns 保存后的 RuntimeSnapshot，API Key 只包含脱敏展示值。
   * @throws 当配置缺失、SDK 验证失败或写入失败时，Promise 会 reject。
   */
  async saveConfiguration(
    configuration: RuntimeConfiguration,
  ): Promise<RuntimeSnapshot> {
    const normalizedConfiguration = normalizeRuntimeConfiguration(configuration)
    const controller = new AbortController()
    this.configurationVerificationController = controller

    try {
      await this.gateway.verifyConfiguration({
        ...normalizedConfiguration,
        prompt: CONFIGURATION_VERIFICATION_PROMPT,
        signal: controller.signal,
      })
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) {
        throw new AgentRuntimeError({
          code: 'run-cancelled',
          message: '已取消配置验证。',
          recoverable: true,
        })
      }

      throw new AgentRuntimeError({
        code: 'provider-verification-failed',
        message: `配置验证失败：${sanitizeErrorMessage(error, normalizedConfiguration.apiKey)}`,
        recoverable: true,
      })
    } finally {
      if (this.configurationVerificationController === controller) {
        this.configurationVerificationController = null
      }
    }

    const readResult = await this.configStore.read()
    const internalConfig = buildInternalConfigForSave(
      readResult.config,
      normalizedConfiguration,
      this.now(),
    )
    await this.configStore.write(internalConfig)
    return this.readRuntimeSnapshot()
  }

  /**
   * 取消当前配置验证。
   *
   * @param request - 取消请求；v1 只维护一个当前验证，verificationId 用于日志和未来扩展。
   * @returns 当前 RuntimeSnapshot。
   * @throws 当快照读取失败时，Promise 会 reject。
   */
  async cancelConfigurationVerification(
    request: CancelConfigurationVerificationRequest,
  ): Promise<RuntimeSnapshot> {
    void request
    this.configurationVerificationController?.abort()
    this.configurationVerificationController = null

    return this.readRuntimeSnapshot()
  }

  /**
   * 读取指定 Agent 的会话摘要列表。
   *
   * @param request - 会话列表过滤条件。
   * @returns 该 Agent 下的会话摘要列表。
   * @throws 此骨架实现不会主动抛出错误。
   */
  async listSessions(
    request: ListSessionsRequest,
  ): Promise<AgentSessionSummary[]> {
    await this.sessionIndexStore.load()

    return this.sessionIndexStore.listSummaries(
      request.agentId,
      request.includeArchived,
    )
  }

  /** 批量更新会话归档状态，保留 Pi session 文件与索引条目。 */
  async setSessionsArchived(
    sessionIds: readonly string[],
    archivedAt: string | null,
  ): Promise<AgentSessionSummary[]> {
    await this.sessionIndexStore.load()
    return this.sessionIndexStore.setArchived(sessionIds, archivedAt)
  }

  /** 永久删除 Pi session 文件并移除索引条目。 */
  async deleteSessions(sessionIds: readonly string[]): Promise<void> {
    await this.sessionIndexStore.load()

    for (const sessionId of sessionIds) {
      const entry = this.sessionIndexStore.getEntryOrNull(sessionId)
      if (entry) {
        await rm(entry.sdkSessionFile, { force: true })
      }
      const handle = this.sessionHandles.get(sessionId)
      if (handle) {
        this.sessionHandles.delete(sessionId)
        handle.dispose()
      }
      this.transcriptCache.delete(sessionId)
      this.activeRunIds.delete(sessionId)
    }

    await this.sessionIndexStore.deleteSessions(sessionIds)
  }

  /**
   * 创建一个新的真实 Pi SDK 会话摘要。
   *
   * @param request - 新会话所属 Agent 和标题。
   * @returns 创建后的会话摘要。
   * @throws 当配置损坏、Agent 不存在或已归档、运行时配置不完整时，Promise 会 reject。
   */
  async createSession(
    request: CreateSessionRequest,
  ): Promise<AgentSessionSummary> {
    const readResult = await this.configStore.read()

    if (readResult.recoveryState !== 'ok') {
      throw new AgentRuntimeError({
        code: 'configuration-missing',
        message: '配置文件已损坏，请先恢复或重置配置。',
        recoverable: true,
      })
    }

    const agentConfig = readResult.config?.agents[request.agentId]

    if (!agentConfig || agentConfig.status === 'archived') {
      throw new AgentRuntimeError({
        code: 'session-not-found',
        message: `Agent「${request.agentId}」不存在或已归档。`,
        recoverable: true,
      })
    }

    const [configuration] = await Promise.all([
      this.configStore.readRequired(request.agentId),
      this.sessionIndexStore.load(),
    ])
    const [soul, userProfile] = await Promise.all([
      this.profileStore.readSoul(request.agentId),
      this.profileStore.readUserProfile(),
    ])
    const sessionId = this.createNextSessionId()
    const now = this.now()
    const sdkSessionFile = this.layout.sdkSessionFile(sessionId)
    const cwd =
      request.agentId === TANGYUAN_DEFAULT_AGENT_ID
        ? this.layout.agentHome()
        : this.layout.workspace(request.agentId)
    await mkdir(dirname(sdkSessionFile), { recursive: true })
    const baseRequest = {
      ...configuration,
      agentId: request.agentId,
      sessionId,
      sdkSessionFile,
      cwd,
      agentSkillsPath: this.layout.agentSkills(request.agentId),
      sharedSkillsPath: this.layout.sharedSkills(),
      onUpdateSoul: this.createSessionSoulUpdater(sessionId, request.agentId),
      onUpdateUserProfile: this.createSessionUserProfileUpdater(sessionId),
    }
    this.sessionSoulVersions.set(sessionId, soul.version)
    this.sessionUserProfileVersions.set(sessionId, userProfile.version)
    const createSessionRequest: PiSdkCreateSessionRequest = this
      .toolApprovalGateway
      ? { ...baseRequest, toolApprovalGateway: this.toolApprovalGateway }
      : baseRequest

    if (request.agentId === TANGYUAN_DEFAULT_AGENT_ID) {
      createSessionRequest.onCreateAgent = async (displayName: string) =>
        this.createAgent(displayName)
    }

    const handle = await this.gateway.createSession(createSessionRequest)
    const persistedSdkSessionFile = handle.sdkSessionFile ?? sdkSessionFile
    const session: AgentSessionSummary = {
      agentId: request.agentId,
      sessionId,
      title: request.title,
      updatedAt: now,
      state: 'idle',
    }
    const indexEntry: PersistedSessionIndexEntry = {
      sessionId,
      sdkSessionFile: persistedSdkSessionFile,
      title: request.title,
      createdAt: now,
      updatedAt: now,
      provider: configuration.providerId,
      model: configuration.modelId,
      agentId: request.agentId,
      lastMessagePreview: '',
      status: 'idle',
    }

    this.sessionIndexStore.addSession(indexEntry)
    this.messageStore.initSession(session.sessionId)
    this.sessionHandles.set(session.sessionId, handle)
    // 身份上下文走系统提示词：建会话时注入并 reload 使其生效。
    if (handle.setSystemPromptContext) {
      handle.setSystemPromptContext(
        await this.profileStore.buildSystemPromptContext(request.agentId),
      )
      await handle.reload?.()
    }
    await this.sessionIndexStore.write()
    this.emit({
      type: 'session-created',
      agentId: request.agentId,
      session,
      occurredAt: this.now(),
    })

    return session
  }

  /**
   * 读取指定会话的结构化 transcript 快照。
   *
   * @param request - 会话定位信息。
   * @returns 结构化会话快照。
   * @throws 当会话不存在时，Promise 会 reject。
   */
  async getTranscript(
    request: GetSessionMessagesRequest,
  ): Promise<TranscriptSnapshot> {
    await this.ensureSessionLoaded(request.sessionId)
    this.assertKnownSession(request.sessionId, request.agentId)

    const cached = this.transcriptCache.get(request.sessionId)
    if (cached && cached.entries.length > 0) {
      return cached
    }

    await this.ensureSessionHandle(request.sessionId)
    const indexEntry = this.sessionIndexStore.getEntry(request.sessionId)
    const snapshot = await this.gateway.readMessages({
      sessionId: request.sessionId,
      sdkSessionFile: indexEntry.sdkSessionFile,
    })

    // 填充持久化的 attempt 数据
    const attempts = this.getSessionAttempts(request.sessionId)
    const enriched = this.enrichTranscriptWithAttempts(snapshot, attempts)
    this.transcriptCache.set(request.sessionId, enriched)

    return enriched
  }

  /**
   * 读取指定会话的持久化执行尝试记录。
   */
  getSessionAttempts(sessionId: string): PersistedAttemptEntry[] {
    return this.sessionIndexStore.getAttempts(sessionId)
  }

  /**
   * 从指定会话的某个用户消息创建独立分叉会话。
   *
   * 分叉会话拥有新的 Pi session ID 与 JSONL，并继承父会话当前的
   * Provider、Model 与 Thinking Level；创建后不自动发起模型运行。
   *
   * @param request - Agent 标识、会话标识和分叉起始节点。
   * @returns 新分叉会话的会话摘要。
   * @throws 当会话不存在、父会话 Provider 缺少 API Key 或分叉失败时，Promise 会 reject。
   */
  async forkSession(request: ForkSessionRequest): Promise<AgentSessionSummary> {
    await this.sessionIndexStore.load()
    this.assertKnownSession(request.sessionId, request.agentId)

    const parentEntry = this.sessionIndexStore.getEntry(request.sessionId)
    // 分叉继承父会话的「有效」会话运行配置：父会话已打开时以运行中的
    // Provider/Model/Thinking Level 为准，否则用索引中持久化的取值。
    const parentConfig = await this.readEffectiveSessionConfig(
      request.sessionId,
      parentEntry,
    )
    const agentConfiguration = await this.configStore.readRequired(
      request.agentId,
    )
    const apiKey =
      parentConfig.providerId === agentConfiguration.providerId
        ? agentConfiguration.apiKey
        : await this.configStore.readProviderApiKey(parentConfig.providerId)

    if (!apiKey) {
      throw new AgentRuntimeError({
        code: 'configuration-missing',
        message: `模型服务「${parentConfig.providerId}」尚未配置 API Key（接口密钥），无法创建分叉会话。`,
        recoverable: true,
      })
    }

    const configuration: RuntimeConfiguration = {
      providerId: parentConfig.providerId,
      modelId: parentConfig.modelId,
      apiKey,
    }
    const forkedSession = await this.gateway.createBranchedSession({
      sdkSessionFile: parentEntry.sdkSessionFile,
      entryId: request.entryId,
    })
    const now = this.now()
    const title = `${parentEntry.title}（分叉）`
    const forkedFrom = {
      sessionId: request.sessionId,
      entryId: request.entryId,
    }
    const childEntry: PersistedSessionIndexEntry = {
      sessionId: forkedSession.sessionId,
      sdkSessionFile: forkedSession.sdkSessionFile,
      title,
      createdAt: now,
      updatedAt: now,
      provider: configuration.providerId,
      model: configuration.modelId,
      ...(parentConfig.thinkingLevel !== undefined
        ? { thinkingLevel: parentConfig.thinkingLevel }
        : {}),
      agentId: request.agentId,
      lastMessagePreview: '',
      status: 'idle',
      forkedFrom,
    }

    this.sessionIndexStore.addSession(childEntry)
    this.messageStore.initSession(forkedSession.sessionId)
    await this.openSessionHandle(forkedSession.sessionId, configuration)
    await this.sessionIndexStore.write()

    const session: AgentSessionSummary = {
      agentId: request.agentId,
      sessionId: forkedSession.sessionId,
      title,
      state: 'idle',
      updatedAt: now,
      forkedFrom,
    }
    this.emit({
      type: 'session-created',
      agentId: request.agentId,
      session,
      occurredAt: now,
    })

    return session
  }

  /**
   * 将持久化 attempt 记录填充到 transcript 快照中。
   */
  private enrichTranscriptWithAttempts(
    snapshot: TranscriptSnapshot,
    attempts: PersistedAttemptEntry[],
  ): TranscriptSnapshot {
    if (attempts.length === 0) return snapshot

    const attemptByMessageId = new Map(attempts.map((a) => [a.messageId, a]))
    const enrichedEntries = snapshot.entries.map((entry) => {
      if (entry.kind !== 'agent-reply') return entry
      const persisted = attemptByMessageId.get(entry.messageId)
      if (!persisted) return entry
      return {
        ...entry,
        attempt: {
          attemptId: persisted.attemptId,
          runId: persisted.runId,
          status: persisted.status,
          startedAt: persisted.startedAt,
          completedAt: persisted.completedAt,
          ...(persisted.error ? { error: persisted.error } : {}),
        },
        turns: entry.turns.map((turn) => ({
          ...turn,
          runId: persisted.runId,
        })),
        ...(persisted.inReplyTo ? { inReplyTo: persisted.inReplyTo } : {}),
      }
    })

    return { ...snapshot, entries: enrichedEntries }
  }

  /**
   * 向指定会话发送用户消息并启动 Agent 运行。
   *
   * @param request - 会话定位信息和消息内容。
   * @returns 无返回值。
   * @throws 当配置缺失、会话不存在或 SDK 调用失败时，Promise 会 reject。
   */
  async sendMessage(request: SendMessageRequest): Promise<void> {
    await this.ensureSessionLoaded(request.sessionId)
    const session = this.assertKnownSession(request.sessionId, request.agentId)
    const handle = await this.ensureSessionHandle(request.sessionId)

    if (
      this.activeRunIds.has(request.sessionId) ||
      session.state === 'running'
    ) {
      throw new AgentRuntimeError({
        code: 'run-already-active',
        message: '当前会话正在运行，请等待完成或先取消本次响应。',
        recoverable: true,
      })
    }

    if (!handle) {
      throw new AgentRuntimeError({
        code: 'session-not-found',
        message: `找不到会话 ${request.sessionId} 的 Pi SDK 运行器。`,
        recoverable: true,
      })
    }

    const content = request.content.trim()

    if (!content) {
      throw new AgentRuntimeError({
        code: 'unknown',
        message: '请输入要发送给汤圆的消息。',
        recoverable: true,
      })
    }

    const userMessage = this.appendMessage({
      agentId: request.agentId,
      sessionId: request.sessionId,
      role: 'user',
      content,
    })
    this.emit({
      type: 'message-appended',
      agentId: request.agentId,
      message: userMessage,
      occurredAt: this.now(),
    })
    const runId = this.createRunId(request.sessionId)
    const agentMessage = this.appendMessage({
      agentId: request.agentId,
      sessionId: request.sessionId,
      role: 'agent',
      content: '',
    })
    this.activeRunIds.set(request.sessionId, runId)
    this.updateSessionState(session.sessionId, 'running')
    await this.sessionIndexStore.updateEntry(session.sessionId, {
      lastMessagePreview: createMessagePreview(content),
      status: 'running',
      updatedAt: this.now(),
    })
    this.emit({
      type: 'attempt-started',
      agentId: request.agentId,
      sessionId: request.sessionId,
      runId,
      occurredAt: this.now(),
    })
    // 持久化执行尝试记录（运行中状态）
    await this.sessionIndexStore.upsertAttempt(request.sessionId, {
      attemptId: runId,
      runId,
      messageId: agentMessage.messageId,
      status: 'running',
      startedAt: this.now(),
      completedAt: null,
    })
    this.transcriptCache.delete(request.sessionId)

    await this.executePromptRun({
      agentId: request.agentId,
      sessionId: request.sessionId,
      runId,
      content,
      session,
      handle,
      agentMessage,
    })
  }

  /**
   * 取消指定会话正在运行的响应。
   *
   * @param request - 需要取消运行的会话定位信息。
   * @returns 无返回值。
   * @throws 当会话不存在时，Promise 会 reject。
   */
  async cancelRun(request: CancelRunRequest): Promise<void> {
    await this.ensureSessionLoaded(request.sessionId)
    this.assertKnownSession(request.sessionId, request.agentId)
    const runId = this.activeRunIds.get(request.sessionId)

    if (runId) {
      this.activeRunIds.delete(request.sessionId)
    }

    await this.sessionHandles.get(request.sessionId)?.abort()
    this.updateSessionState(request.sessionId, 'cancelled')
    await this.sessionIndexStore.updateEntry(request.sessionId, {
      status: 'cancelled',
      updatedAt: this.now(),
    })

    if (runId) {
      this.emit({
        type: 'turn-cancelled',
        agentId: request.agentId,
        sessionId: request.sessionId,
        runId,
        occurredAt: this.now(),
      })
    }
  }

  /**
   * 重试一条失败的用户消息，复用原始请求并创建新的执行尝试。
   *
   * @param request - 会话定位信息和要重试的原始用户消息标识。
   * @returns 无返回值，运行进度通过 AgentEvent 推送。
   * @throws 当配置缺失、会话不存在或 SDK 调用失败时，Promise 会 reject。
   */
  async retryMessage(
    request: import('@tangyuan/contracts').RetryRunRequest,
  ): Promise<void> {
    await this.ensureSessionLoaded(request.sessionId)
    const session = this.assertKnownSession(request.sessionId, request.agentId)
    const handle = await this.ensureSessionHandle(request.sessionId)

    if (
      this.activeRunIds.has(request.sessionId) ||
      session.state === 'running'
    ) {
      throw new AgentRuntimeError({
        code: 'run-already-active',
        message: '当前会话正在运行，请等待完成或先取消本次响应。',
        recoverable: true,
      })
    }

    if (!handle) {
      throw new AgentRuntimeError({
        code: 'session-not-found',
        message: `找不到会话 ${request.sessionId} 的 Pi SDK 运行器。`,
        recoverable: true,
      })
    }

    // 从缓存中查找原始用户消息内容
    const messages = this.messageStore.getMessages(request.sessionId)
    const userMessage = messages.find(
      (m) => m.messageId === request.userMessageId && m.role === 'user',
    )

    if (!userMessage) {
      // 尝试从 Pi SDK 加载
      const indexEntry = this.sessionIndexStore.getEntry(request.sessionId)
      const loadedMessages = await this.gateway.readMessages({
        sessionId: request.sessionId,
        sdkSessionFile: indexEntry.sdkSessionFile,
      })
      // 缓存 transcript 快照
      this.transcriptCache.set(request.sessionId, loadedMessages)
      const loadedUserMessage = loadedMessages.entries.find(
        (e) =>
          e.kind === 'user-message' && e.messageId === request.userMessageId,
      )
      if (!loadedUserMessage || loadedUserMessage.kind !== 'user-message') {
        throw new AgentRuntimeError({
          code: 'session-not-found',
          message: '找不到要重试的原始用户消息。',
          recoverable: true,
        })
      }
      return this.executeRetry(
        request,
        loadedUserMessage.content,
        session,
        handle,
      )
    }

    return this.executeRetry(request, userMessage.content, session, handle)
  }

  /**
   * 执行一次 Agent prompt 运行的公共核心：流式事件桥接、取消/失败/完成处理、
   * profile 维护编排与 attempt 持久化。sendMessage 与 retryMessage 共用。
   *
   * @param input - 运行所需的会话定位、runId、handle、已建的空 agent 消息等；
   *   inReplyTo 存在时（重试场景）会写入 attempt 与完成消息。
   * @returns 无返回值。
   * @throws 当 SDK 调用失败（非取消）时，Promise 会 reject。
   */
  private async executePromptRun(input: {
    agentId: AgentId
    sessionId: string
    runId: string
    content: string
    session: AgentSessionSummary
    handle: PiSdkSessionHandle
    agentMessage: InternalMessage
    inReplyTo?: string
  }): Promise<void> {
    const {
      agentId,
      sessionId,
      runId,
      content,
      session,
      handle,
      agentMessage,
    } = input
    const inReplyToPatch = input.inReplyTo ? { inReplyTo: input.inReplyTo } : {}
    try {
      let accumulatedReply = ''
      let turnIndex = 0
      // 惰性宣告：收到第一个真实内容事件时才 emit agent message-appended，
      // 使运行期 delta 能挂到条目上；若未产生任何内容（如立即取消）则不建空条目。
      let agentEntryAnnounced = false
      const announceAgentEntry = (): void => {
        if (agentEntryAnnounced) return
        agentEntryAnnounced = true
        this.emit({
          type: 'message-appended',
          agentId,
          message: agentMessage,
          occurredAt: this.now(),
        })
      }
      const agentReply = await handle.prompt(content, {
        onEvent: (event) => {
          if (event.type === 'thinking-started') {
            announceAgentEntry()
            this.emit({
              type: 'activity-updated',
              agentId,
              sessionId,
              runId,
              activity: mapPiSdkStreamEventToActivity(event),
              occurredAt: this.now(),
            })
            return
          }

          if (event.type === 'thinking-delta') {
            announceAgentEntry()
            this.emit({
              type: 'message-delta',
              agentId,
              sessionId,
              runId,
              messageId: agentMessage.messageId,
              delta: event.delta,
              deltaKind: 'thinking',
              occurredAt: this.now(),
            })
            return
          }

          if (event.type === 'text-delta') {
            announceAgentEntry()
            accumulatedReply += event.delta
            this.messageStore.appendDelta(agentMessage.messageId, event.delta)
            this.emit({
              type: 'message-delta',
              agentId,
              sessionId,
              runId,
              messageId: agentMessage.messageId,
              delta: event.delta,
              occurredAt: this.now(),
            })
            return
          }

          if (event.type === 'turn-started') {
            this.emit({
              type: 'turn-started',
              agentId,
              sessionId,
              runId,
              turnIndex,
              occurredAt: this.now(),
            })
            return
          }

          if (event.type === 'turn-ended') {
            this.emit({
              type: 'turn-ended',
              agentId,
              sessionId,
              runId,
              turnIndex,
              message: event.message,
              toolResults: event.toolResults,
              occurredAt: this.now(),
            })
            turnIndex++
            return
          }

          // tool-started / tool-completed / tool-failed
          announceAgentEntry()
          this.emit({
            type: 'activity-updated',
            agentId,
            sessionId,
            runId,
            activity: mapPiSdkStreamEventToActivity(event),
            occurredAt: this.now(),
          })
        },
      })

      if (this.activeRunIds.get(sessionId) !== runId) {
        this.messageStore.removeIfEmpty(agentMessage.messageId)
        await this.sessionIndexStore.upsertAttempt(sessionId, {
          attemptId: runId,
          runId,
          messageId: agentMessage.messageId,
          status: 'cancelled',
          startedAt: this.now(),
          completedAt: this.now(),
          ...inReplyToPatch,
        })
        this.updateSessionState(session.sessionId, 'cancelled')
        await this.sessionIndexStore.updateEntry(session.sessionId, {
          status: 'cancelled',
          updatedAt: this.now(),
        })
        return
      }

      if (!accumulatedReply && agentReply?.trim()) {
        accumulatedReply = agentReply.trim()
        this.messageStore.appendDelta(agentMessage.messageId, accumulatedReply)
        this.emit({
          type: 'message-delta',
          agentId,
          sessionId,
          runId,
          messageId: agentMessage.messageId,
          delta: accumulatedReply,
          occurredAt: this.now(),
        })
      }

      const completedMessage = this.messageStore.complete(
        agentMessage.messageId,
      )
      this.emit({
        type: 'message-completed',
        agentId,
        sessionId,
        runId,
        message: completedMessage,
        occurredAt: this.now(),
      })
      this.emit({
        type: 'message-appended',
        agentId,
        message: completedMessage,
        occurredAt: this.now(),
        ...inReplyToPatch,
      })
      // bootstrap 门控：受控工具写入后检查 Agent 灵魂和用户画像
      // 是否都已就绪；就绪时自动结束初始化。
      await this.profileStore.performBootstrapCompletionGating()

      await this.sessionIndexStore.upsertAttempt(sessionId, {
        attemptId: runId,
        runId,
        messageId: agentMessage.messageId,
        status: 'completed',
        startedAt: this.now(),
        completedAt: this.now(),
        ...inReplyToPatch,
      })
      this.updateSessionState(session.sessionId, 'completed')
      await this.sessionIndexStore.updateEntry(session.sessionId, {
        lastMessagePreview: createMessagePreview(completedMessage.content),
        status: 'completed',
        updatedAt: this.now(),
      })
    } catch (error) {
      if (isAbortError(error) || !this.activeRunIds.has(sessionId)) {
        this.messageStore.removeIfEmpty(agentMessage.messageId)
        await this.sessionIndexStore.upsertAttempt(sessionId, {
          attemptId: runId,
          runId,
          messageId: agentMessage.messageId,
          status: 'cancelled',
          startedAt: this.now(),
          completedAt: this.now(),
          ...inReplyToPatch,
        })
        this.updateSessionState(session.sessionId, 'cancelled')
        await this.sessionIndexStore.updateEntry(session.sessionId, {
          status: 'cancelled',
          updatedAt: this.now(),
        })
        this.emit({
          type: 'turn-cancelled',
          agentId,
          sessionId,
          runId,
          occurredAt: this.now(),
        })
        return
      }

      const runtimeError = {
        code: 'unknown' as const,
        message: sanitizeErrorMessage(error),
        recoverable: true,
      }
      this.messageStore.removeIfEmpty(agentMessage.messageId)
      await this.sessionIndexStore.upsertAttempt(sessionId, {
        attemptId: runId,
        runId,
        messageId: agentMessage.messageId,
        status: 'failed',
        startedAt: this.now(),
        completedAt: this.now(),
        error: runtimeError,
        ...inReplyToPatch,
      })
      this.updateSessionState(session.sessionId, 'failed')
      await this.sessionIndexStore.updateEntry(session.sessionId, {
        lastMessagePreview: createMessagePreview(runtimeError.message),
        status: 'failed',
        updatedAt: this.now(),
      })
      this.emit({
        type: 'turn-failed',
        agentId,
        sessionId,
        runId,
        error: runtimeError,
        occurredAt: this.now(),
      })
      this.emit({
        type: 'runtime-error',
        agentId,
        error: runtimeError,
        occurredAt: this.now(),
      })
      throw error
    } finally {
      if (this.activeRunIds.get(sessionId) === runId) {
        this.activeRunIds.delete(sessionId)
      }
      if (this.pendingProfileRefreshes.delete(sessionId)) {
        await this.refreshSessionProfileContext(sessionId).catch((error) => {
          this.emitProfileRefreshError(agentId, error)
        })
      }
    }
  }
  /**
   * 执行重试核心逻辑：创建新 InternalMessage 和 ExecutionAttempt，
   * 发送与原始用户请求相同的 prompt。
   *
   * @param request - 重试请求。
   * @param content - 原始用户消息内容。
   * @param session - 已确认的会话摘要。
   * @param handle - Pi SDK 会话运行器。
   * @returns 无返回值。
   * @throws 当 SDK 调用失败时，Promise 会 reject。
   */
  private async executeRetry(
    request: import('@tangyuan/contracts').RetryRunRequest,
    content: string,
    session: AgentSessionSummary,
    handle: PiSdkSessionHandle | undefined,
  ): Promise<void> {
    if (!handle) {
      throw new AgentRuntimeError({
        code: 'session-not-found',
        message: `找不到会话 ${request.sessionId} 的 Pi SDK 运行器。`,
        recoverable: true,
      })
    }

    if (!content.trim()) {
      throw new AgentRuntimeError({
        code: 'unknown',
        message: '原始用户消息为空，无法重试。',
        recoverable: true,
      })
    }

    const runId = this.createRunId(request.sessionId)
    const now = this.now()

    // 创建新的 InternalMessage（不创建 UserMessage）
    const agentMessage = this.appendMessage({
      agentId: request.agentId,
      sessionId: request.sessionId,
      role: 'agent',
      content: '',
    })

    this.activeRunIds.set(request.sessionId, runId)
    this.updateSessionState(session.sessionId, 'running')
    await this.sessionIndexStore.updateEntry(session.sessionId, {
      lastMessagePreview: createMessagePreview(content),
      status: 'running',
      updatedAt: now,
    })

    this.emit({
      type: 'attempt-started',
      agentId: request.agentId,
      sessionId: request.sessionId,
      runId,
      occurredAt: now,
    })

    await this.executePromptRun({
      agentId: request.agentId,
      sessionId: request.sessionId,
      runId,
      content,
      session,
      handle,
      agentMessage,
      inReplyTo: request.userMessageId,
    })
  }
}
