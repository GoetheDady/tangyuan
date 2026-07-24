import type {
  AgentSummary,
  UnclaimedDirectory,
  UpdateAgentConfigRequest,
} from '@tangyuan/contracts'
import type { AgentSessionDriver } from './index'
import type { RuntimeSnapshotStore } from './runtime-snapshot-store'

/**
 * 创建 AgentManager 所需的依赖。
 */
export interface AgentManagerDependencies {
  sessionDriver: AgentSessionDriver
  snapshotStore: RuntimeSnapshotStore
}

/**
 * Agent 生命周期管理：承载「Agent 如何列出、创建、改配置、归档、恢复、
 * 目录对账/认领、重建汤圆目录」这一族操作。所有会改变 Agent 配置的操作
 * 完成后都刷新运行时快照缓存，保证后续读取一致。
 * 不持有独立状态，编排 sessionDriver 与 snapshotStore。
 */
export class AgentManager {
  private readonly sessionDriver: AgentSessionDriver
  private readonly snapshotStore: RuntimeSnapshotStore

  constructor(dependencies: AgentManagerDependencies) {
    this.sessionDriver = dependencies.sessionDriver
    this.snapshotStore = dependencies.snapshotStore
  }

  /**
   * 列出所有已配置的 Agent 摘要。
   *
   * @returns Agent 摘要列表。
   * @throws 当运行时快照读取失败时，Promise 会 reject。
   */
  async list(): Promise<AgentSummary[]> {
    const snapshot = await this.snapshotStore.getOrLoad()
    return snapshot.agents
  }

  /**
   * 创建一个新 Agent，并刷新快照缓存以包含它。
   *
   * @param displayName - 新 Agent 的展示名称。
   * @returns 新创建的 Agent 摘要。
   * @throws 当 Driver 不支持创建或创建失败时，Promise 会 reject。
   */
  async create(displayName: string): Promise<AgentSummary> {
    if (!this.sessionDriver.createAgent) {
      throw new Error('当前运行时不支持创建 Agent。')
    }
    const summary = await this.sessionDriver.createAgent(displayName)
    await this.snapshotStore.reload()
    return summary
  }

  /**
   * 更新指定 Agent 的默认 Provider 和 Model 配置，并刷新快照缓存。
   *
   * @param request - Agent 标识和要更新的配置字段。
   * @returns 更新后的 AgentSummary。
   * @throws 当 Driver 不支持或更新失败时，Promise 会 reject。
   */
  async updateConfig(request: UpdateAgentConfigRequest): Promise<AgentSummary> {
    if (!this.sessionDriver.updateAgentConfig) {
      throw new Error('当前运行时不支持更新 Agent 配置。')
    }

    const summary = await this.sessionDriver.updateAgentConfig(request.agentId, {
      ...(request.defaultProviderId !== undefined
        ? { defaultProviderId: request.defaultProviderId }
        : {}),
      ...(request.defaultModelId !== undefined
        ? { defaultModelId: request.defaultModelId }
        : {}),
    })

    await this.snapshotStore.reload()
    return summary
  }

  /**
   * 归档指定的自定义 Agent（默认汤圆不可归档），并刷新快照缓存。
   *
   * @param agentId - Agent 标识。
   * @returns 归档后的 AgentSummary。
   * @throws 当 Driver 不支持或归档失败时，Promise 会 reject。
   */
  async archive(agentId: string): Promise<AgentSummary> {
    if (!this.sessionDriver.archiveAgent) {
      throw new Error('当前运行时不支持归档 Agent。')
    }

    const summary = await this.sessionDriver.archiveAgent(agentId)
    await this.snapshotStore.reload()
    return summary
  }

  /**
   * 恢复已归档的 Agent 到活跃状态，并刷新快照缓存。
   *
   * @param agentId - Agent 标识。
   * @returns 恢复后的 AgentSummary。
   * @throws 当 Driver 不支持或恢复失败时，Promise 会 reject。
   */
  async recover(agentId: string): Promise<AgentSummary> {
    if (!this.sessionDriver.recoverAgent) {
      throw new Error('当前运行时不支持恢复 Agent。')
    }

    const summary = await this.sessionDriver.recoverAgent(agentId)
    await this.snapshotStore.reload()
    return summary
  }

  /**
   * 执行目录对账：对照配置检查 Agent 目录存在性，扫描发现未归属目录。
   *
   * @returns 对账报告。
   * @throws 当 Driver 不支持或对账失败时，Promise 会 reject。
   */
  async reconcileDirectories(): Promise<{
    agents: AgentSummary[]
    unclaimedDirectories: UnclaimedDirectory[]
  }> {
    if (!this.sessionDriver.reconcileAgentDirectories) {
      throw new Error('当前运行时不支持目录对账。')
    }

    return this.sessionDriver.reconcileAgentDirectories()
  }

  /**
   * 认领未归属的 Agent 目录，并刷新快照缓存。
   *
   * @param agentId - 目录名称（作为 agentId）。
   * @param displayName - Agent 展示名称。
   * @returns 认领后的 AgentSummary。
   * @throws 当 Driver 不支持或认领失败时，Promise 会 reject。
   */
  async claimDirectory(
    agentId: string,
    displayName: string,
  ): Promise<AgentSummary> {
    if (!this.sessionDriver.claimAgentDirectory) {
      throw new Error('当前运行时不支持认领 Agent 目录。')
    }

    const summary = await this.sessionDriver.claimAgentDirectory(
      agentId,
      displayName,
    )
    await this.snapshotStore.reload()
    return summary
  }

  /**
   * 按固定模板重建默认汤圆的目录结构，并刷新快照缓存。
   *
   * @returns 重建后的 AgentSummary。
   * @throws 当 Driver 不支持或重建失败时，Promise 会 reject。
   */
  async rebuildTangyuanHome(): Promise<AgentSummary> {
    if (!this.sessionDriver.rebuildTangyuanHome) {
      throw new Error('当前运行时不支持重建汤圆目录。')
    }

    const summary = await this.sessionDriver.rebuildTangyuanHome()
    await this.snapshotStore.reload()
    return summary
  }
}
