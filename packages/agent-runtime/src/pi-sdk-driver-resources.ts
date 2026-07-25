import { extractAgentRuntimeConfig, getMtimeIso } from './utils'
import { AgentRuntimeError } from './errors'
import {
  TANGYUAN_DEFAULT_AGENT_ID,
  createAgentProfileStatus,
  createRuntimeSnapshot,
  type AgentConfig,
  type AgentEventListener,
  type AgentEventSubscription,
  type AgentId,
  type AgentSummary,
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
  type UserProfileContent,
} from '@tangyuan/contracts'
import { PiSdkDriverState } from './pi-sdk-driver-state'

export class PiSdkDriverResources extends PiSdkDriverState {
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
      ? extractAgentRuntimeConfig(readResult.config, TANGYUAN_DEFAULT_AGENT_ID)
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
          maskedValue: PiSdkDriverResources.maskApiKey(creds.apiKey),
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
            ? PiSdkDriverResources.maskApiKey(runtimeConfig.apiKey)
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
   * @param expectedVersion - 调用方最后观察到的内容版本。
   * @returns profile 维护结果。
   * @throws 当文件操作失败时，Promise 会 reject。
   */
  async updateUserProfile(
    content: string,
    expectedVersion: string,
  ): Promise<ProfileUpdateResult> {
    const outcome = await this.profileStore.writeUserProfile(
      content,
      expectedVersion,
    )

    // 真正写入文件时才广播事件并刷新全部活跃会话。
    if (outcome.written) {
      const updatedAt =
        (await getMtimeIso(this.layout.userProfile())) ?? this.now()
      this.emitProfileUpdated('user', updatedAt)
      // profile 变化点：共享 user.md 影响所有 Agent，刷新全部活跃会话。
      await this.refreshAllProfileContext().catch((error) => {
        this.emitProfileRefreshError(TANGYUAN_DEFAULT_AGENT_ID, error)
      })
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
}
