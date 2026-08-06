import { mkdir, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import type {
  PersistedAttemptEntry,
  PersistedSessionIndexEntry,
} from '../session/session-index-store'
import { AgentRuntimeError } from '../core'
import { DefaultRuntimeConfiguration } from '../runtime/runtime-configuration'
import {
  YUANXIAO_DEFAULT_AGENT_ID,
  type AgentSessionSummary,
  type CancelRunRequest,
  type CreateSessionRequest,
  type ForkSessionRequest,
  type GetSessionMessagesRequest,
  type ListSessionsRequest,
  type RuntimeConfiguration,
  type SendMessageRequest,
  type TranscriptSnapshot,
} from '@yuanxiao/contracts'
import type {
  PiSdkCreateSessionRequest,
} from './pi-sdk-driver-contracts'
import type { SessionModule } from '../runtime/runtime-modules'
import { resolveSdkEntryId } from './sdk-entry-id-resolver'
import { PiSdkDriverState } from './pi-sdk-driver-state'

/**
 * Pi Agent SDK 的 v1 适配器骨架。
 */
export class PiSdkDriver extends PiSdkDriverState implements SessionModule {
  static maskApiKey(apiKey: string): string {
    return DefaultRuntimeConfiguration.maskApiKey(apiKey)
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
    return this.sessionIndexStore.setArchived(sessionIds, archivedAt)
  }

  /** 永久删除 Pi session 文件并移除索引条目。 */
  async deleteSessions(sessionIds: readonly string[]): Promise<void> {
    const entries = await Promise.all(
      sessionIds.map((sessionId) => this.sessionIndexStore.findEntry(sessionId)),
    )
    for (const [index, sessionId] of sessionIds.entries()) {
      const entry = entries[index]
      if (entry) {
        await rm(entry.sdkSessionFile, { force: true })
      }
      const handle = this.sessionHandles.get(sessionId)
      if (handle) {
        this.sessionHandles.delete(sessionId)
        handle.dispose()
      }
      this.transcriptCache.delete(sessionId)
      this.attemptLifecycle.removeSessions([sessionId])
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

    const configuration = await this.configStore.readRequired(request.agentId)
    const [soul, userProfile] = await Promise.all([
      this.profileStore.readSoul(request.agentId),
      this.profileStore.readUserProfile(),
    ])
    const sessionId = this.createNextSessionId()
    const now = this.now()
    const sdkSessionFile = this.layout.sdkSessionFile(sessionId)
    const cwd =
      request.agentId === YUANXIAO_DEFAULT_AGENT_ID
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
    const createSessionRequest: PiSdkCreateSessionRequest = { ...baseRequest }

    if (request.agentId === YUANXIAO_DEFAULT_AGENT_ID) {
      createSessionRequest.onCreateAgent = async (displayName: string) =>
        this.agentRegistry.createAgent(displayName)
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

    await this.sessionIndexStore.addSession(indexEntry)
    this.messageStore.initSession(session.sessionId)
    this.sessionHandles.set(session.sessionId, handle)
    // 身份上下文走系统提示词：建会话时注入并 reload 使其生效。
    if (handle.setSystemPromptContext) {
      handle.setSystemPromptContext(
        await this.profileStore.buildSystemPromptContext(request.agentId),
      )
      await handle.reload?.()
    }
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
    await this.assertKnownSession(request.sessionId, request.agentId)

    const cached = this.transcriptCache.get(request.sessionId)
    if (cached && cached.entries.length > 0) {
      return cached
    }

    await this.ensureSessionHandle(request.sessionId)
    const indexEntry = await this.sessionIndexStore.resolveEntry(
      request.sessionId,
    )
    const snapshot = await this.gateway.readMessages({
      sessionId: request.sessionId,
      sdkSessionFile: indexEntry.sdkSessionFile,
    })

    // 填充持久化的 attempt 数据
    const attempts = await this.getSessionAttempts(request.sessionId)
    const enriched = this.enrichTranscriptWithAttempts(snapshot, attempts)
    this.transcriptCache.set(request.sessionId, enriched)

    return enriched
  }

  /**
   * 读取指定会话的持久化执行尝试记录。
   */
  getSessionAttempts(sessionId: string): Promise<PersistedAttemptEntry[]> {
    return this.sessionIndexStore.resolveAttempts(sessionId)
  }

  /**
   * 重命名会话标题，原子写入索引文件。
   *
   * @param sessionId - 目标会话标识。
   * @param title - 新标题。
   * @returns 更新后的会话摘要。
   * @throws 当会话不存在或写盘失败时，Promise 会 reject。
   */
  async renameSession(
    sessionId: string,
    title: string,
  ): Promise<AgentSessionSummary> {
    return this.sessionIndexStore.updateTitle(sessionId, title)
  }

  /** 返回指定会话当前活跃运行的 runId；无活跃运行时返回 undefined。 */
  getActiveRunId(sessionId: string): string | undefined {
    return this.attemptLifecycle.getActiveRunId(sessionId)
  }

  /** 返回当前全部活跃运行的数量。 */
  getActiveRunCount(): number {
    return this.attemptLifecycle.getActiveRunCount()
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
    await this.assertKnownSession(request.sessionId, request.agentId)

    const parentEntry = await this.sessionIndexStore.resolveEntry(
      request.sessionId,
    )
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
    const sdkEntryId = await this.resolveSdkEntryId(
      request.sessionId,
      request.entryId,
      parentEntry.sdkSessionFile,
    )
    const forkedSession = await this.gateway.createBranchedSession({
      sdkSessionFile: parentEntry.sdkSessionFile,
      entryId: sdkEntryId,
      messageId: request.entryId,
    })
    const now = this.now()
    const title = `${parentEntry.title}（分叉）`
    const forkedFrom = {
      sessionId: request.sessionId,
      entryId: request.entryId,
      ...(sdkEntryId !== request.entryId ? { sdkEntryId } : {}),
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

    await this.sessionIndexStore.addSession(childEntry)
    this.messageStore.initSession(forkedSession.sessionId)
    await this.openSessionHandle(forkedSession.sessionId, configuration)

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
   * 把调用方提供的分叉源消息标识解析为 Pi SDK 文件中的真实 entry id。
   *
   * @param sessionId - 源会话标识。
   * @param driverMessageId - 调用方提供的分叉源消息标识。
   * @param sdkSessionFile - 源会话的 Pi JSONL 文件路径。
   * @returns SDK 文件中的真实 entry id；无法桥接时返回原标识。
   * @throws 此方法不会主动抛出错误。
   */
  private resolveSdkEntryId(
    sessionId: string,
    driverMessageId: string,
    sdkSessionFile: string,
  ): Promise<string> {
    return resolveSdkEntryId(
      { gateway: this.gateway, messageStore: this.messageStore },
      { sessionId, driverMessageId, sdkSessionFile },
    )
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
          ...(persisted.retryCount !== undefined
            ? { retryCount: persisted.retryCount }
            : {}),
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
    const session = await this.assertKnownSession(
      request.sessionId,
      request.agentId,
    )
    const handle = await this.ensureSessionHandle(request.sessionId)

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
        message: '请输入要发送给元宵的消息。',
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

    await this.attemptLifecycle.execute({
      agentId: request.agentId,
      sessionId: request.sessionId,
      sessionState: session.state,
      content,
      handle,
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
    await this.assertKnownSession(request.sessionId, request.agentId)
    const handle = this.sessionHandles.get(request.sessionId)
    await this.attemptLifecycle.cancel({
      agentId: request.agentId,
      sessionId: request.sessionId,
      ...(handle ? { handle } : {}),
    })
  }

  /**
   * 重试一条失败的用户消息，复用原始请求并创建新的执行尝试。
   *
   * @param request - 会话定位信息和要重试的原始用户消息标识。
   * @returns 无返回值，运行进度通过 AgentEvent 推送。
   * @throws 当配置缺失、会话不存在或 SDK 调用失败时，Promise 会 reject。
   */
  async retryMessage(
    request: import('@yuanxiao/contracts').RetryRunRequest,
  ): Promise<void> {
    const session = await this.assertKnownSession(
      request.sessionId,
      request.agentId,
    )
    const handle = await this.ensureSessionHandle(request.sessionId)

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

    let content: string
    if (!userMessage) {
      // 尝试从 Pi SDK 加载
      const indexEntry = await this.sessionIndexStore.resolveEntry(
        request.sessionId,
      )
      const loadedMessages = await this.gateway.readMessages({
        sessionId: request.sessionId,
        sdkSessionFile: indexEntry.sdkSessionFile,
      })
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
      content = loadedUserMessage.content
    } else {
      content = userMessage.content
    }

    if (!content.trim()) {
      throw new AgentRuntimeError({
        code: 'unknown',
        message: '原始用户消息为空，无法重试。',
        recoverable: true,
      })
    }

    await this.attemptLifecycle.execute({
      agentId: request.agentId,
      sessionId: request.sessionId,
      sessionState: session.state,
      content,
      handle,
      inReplyTo: request.userMessageId,
    })
  }
}
