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
import { sanitizeErrorMessage } from './utils'
import {
  TANGYUAN_DEFAULT_AGENT_ID,
  type AgentEvent,
  type AgentEventListener,
  type AgentId,
  type AgentRunState,
  type AgentSessionSummary,
  type ConfigEncryptionAdapter,
  type ProfileUpdateResult,
  type TranscriptSnapshot,
} from '@tangyuan/contracts'
import type {
  DriverEvent,
  InternalMessage,
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

  protected abstract updateSoul(
    agentId: AgentId,
    content: string,
    expectedVersion: string,
  ): Promise<ProfileUpdateResult>

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
  protected async refreshSessionProfileContext(
    sessionId: string,
  ): Promise<void> {
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
