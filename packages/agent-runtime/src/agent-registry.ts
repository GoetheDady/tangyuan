import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  TANGYUAN_DEFAULT_AGENT_ID,
  type AgentConfig,
  type AgentEvent,
  type AgentId,
  type AgentSummary,
  type InternalRuntimeConfig,
  type UnclaimedDirectory,
} from '@tangyuan/contracts'
import type { DirectoryLayout } from './directory-layout'
import type { ConfigStore } from './config-store'
import { AgentRuntimeError } from './errors'
import {
  createDefaultInternalConfig,
  extractAgentRuntimeConfig,
  pathExists,
} from './utils'

/**
 * 创建 AgentRegistry 所需的依赖。
 */
export interface AgentRegistryDependencies {
  layout: DirectoryLayout
  configStore: ConfigStore
  now: () => string
  emit: (event: AgentEvent) => void
  /** 默认 Agent 的原始 home 路径字符串（用于摘要展示，保持既有行为）。 */
  agentHomePath: string
}

/**
 * Agent 生命周期管理：创建、更新配置、归档、恢复、目录对账与认领、重建默认 Agent。
 * 承载「Agent 的增删改档与目录归属」这一条知识，不涉及会话簇或 profile 维护。
 */
export class AgentRegistry {
  private readonly layout: DirectoryLayout
  private readonly configStore: ConfigStore
  private readonly now: () => string
  private readonly emit: (event: AgentEvent) => void
  private readonly agentHomePath: string

  constructor(dependencies: AgentRegistryDependencies) {
    this.layout = dependencies.layout
    this.configStore = dependencies.configStore
    this.now = dependencies.now
    this.emit = dependencies.emit
    this.agentHomePath = dependencies.agentHomePath
  }

  /**
   * 列出所有已配置的 Agent 摘要。
   *
   * @returns Agent 摘要列表。
   * @throws 当配置读取失败时，Promise 会 reject。
   */
  async listAgents(): Promise<AgentSummary[]> {
    const readResult = await this.configStore.read()
    return await this.buildAgentSummaries(readResult.config)
  }

  /**
   * 原子创建一个新 Agent。
   *
   * @param displayName - 新 Agent 的展示名称。
   * @returns 新创建的 Agent 摘要。
   * @throws 当配置读取、目录创建、文件写入或加密失败时，Promise 会 reject。
   */
  async createAgent(displayName: string): Promise<AgentSummary> {
    const agentId = crypto.randomUUID()
    const now = this.now()
    const homePath = this.layout.agentHome(agentId)
    const workspacePath = this.layout.workspace(agentId)

    // 1. 读取当前配置并继承 tangyuan 的 Provider/Model
    const readResult = await this.configStore.read()
    const config = readResult.config ?? createDefaultInternalConfig()
    const tangyuanConfig = extractAgentRuntimeConfig(
      config,
      TANGYUAN_DEFAULT_AGENT_ID,
    )

    // 2. 原子创建目录和初始文件
    await mkdir(homePath, { recursive: true })

    try {
      await Promise.all([
        mkdir(join(homePath, 'soul.history'), { recursive: true }),
        mkdir(join(homePath, 'memory'), { recursive: true }),
        mkdir(join(homePath, 'skills'), { recursive: true }),
        mkdir(workspacePath, { recursive: true }),
      ])

      const soulContent = [
        `# ${displayName}`,
        '',
        `创建时间：${now}`,
        '',
        '## 身份',
        `${displayName}是用户创建的 Agent。`,
        '',
        '## 职责',
        '待用户在对话中定义。',
        '',
        '## 规则',
        '遵循用户指令，在执行危险操作前先确认。',
        '使用中文回复，简洁清晰。',
        '',
      ].join('\n')
      await writeFile(join(homePath, 'soul.md'), soulContent, 'utf8')

      // 3. 更新配置
      config.agents[agentId] = {
        displayName,
        defaultProviderId: tangyuanConfig?.providerId ?? null,
        defaultModelId: tangyuanConfig?.modelId ?? null,
        status: 'active',
        archivedAt: null,
      }
      await this.configStore.write(config)

      const summary: AgentSummary = {
        agentId,
        displayName,
        status: 'active',
        defaultProviderId: tangyuanConfig?.providerId ?? null,
        defaultModelId: tangyuanConfig?.modelId ?? null,
        homePath,
        archivedAt: null,
        directoryStatus: 'healthy',
      }

      this.emit({
        type: 'agent-created',
        agentId,
        agent: summary,
        occurredAt: now,
      })

      return summary
    } catch (error) {
      // 失败回滚：清理已创建的目录
      await rm(homePath, { recursive: true, force: true })
      throw error
    }
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
    const readResult = await this.configStore.read()
    const config = readResult.config

    if (!config || !config.agents[agentId]) {
      throw new AgentRuntimeError({
        code: 'session-not-found',
        message: `Agent ${agentId} 不存在或已归档。`,
        recoverable: true,
      })
    }

    const currentAgent = config.agents[agentId]

    if (currentAgent.status !== 'active') {
      throw new AgentRuntimeError({
        code: 'session-not-found',
        message: `Agent ${agentId} 已归档，无法修改配置。`,
        recoverable: true,
      })
    }

    const updatedAgent = {
      ...currentAgent,
      ...(patch.defaultProviderId !== undefined
        ? { defaultProviderId: patch.defaultProviderId }
        : {}),
      ...(patch.defaultModelId !== undefined
        ? { defaultModelId: patch.defaultModelId }
        : {}),
    }
    config.agents[agentId] = updatedAgent
    await this.configStore.write(config)

    const homePath = this.layout.agentHome(agentId)
    const soulExists = await pathExists(join(homePath, 'soul.md'))

    const summary: AgentSummary = {
      agentId,
      displayName: updatedAgent.displayName,
      status: updatedAgent.status,
      defaultProviderId: updatedAgent.defaultProviderId,
      defaultModelId: updatedAgent.defaultModelId,
      homePath,
      archivedAt: updatedAgent.archivedAt,
      directoryStatus: soulExists ? 'healthy' : 'damaged',
    }

    this.emit({
      type: 'agent-config-updated',
      agentId,
      agent: summary,
      occurredAt: this.now(),
    })

    return summary
  }

  /**
   * 归档指定的自定义 Agent（默认汤圆不可归档）。
   *
   * @param agentId - Agent 标识。
   * @returns 归档后的 AgentSummary。
   * @throws 当 Agent 是汤圆、不存在或配置保存失败时，Promise 会 reject。
   */
  async archiveAgent(agentId: AgentId): Promise<AgentSummary> {
    if (agentId === TANGYUAN_DEFAULT_AGENT_ID) {
      throw new AgentRuntimeError({
        code: 'session-not-found',
        message: '默认 Agent「汤圆」不可归档。',
        recoverable: true,
      })
    }

    const readResult = await this.configStore.read()
    const config = readResult.config

    if (!config || !config.agents[agentId]) {
      throw new AgentRuntimeError({
        code: 'session-not-found',
        message: `Agent ${agentId} 不存在。`,
        recoverable: true,
      })
    }

    const currentAgent = config.agents[agentId]
    const now = this.now()

    const updatedAgent: AgentConfig = {
      ...currentAgent,
      status: 'archived',
      archivedAt: now,
    }
    config.agents[agentId] = updatedAgent
    await this.configStore.write(config)

    const homePath = this.layout.agentHome(agentId)
    const soulExists = await pathExists(join(homePath, 'soul.md'))

    const summary: AgentSummary = {
      agentId,
      displayName: updatedAgent.displayName,
      status: updatedAgent.status,
      defaultProviderId: updatedAgent.defaultProviderId,
      defaultModelId: updatedAgent.defaultModelId,
      homePath,
      archivedAt: updatedAgent.archivedAt,
      directoryStatus: soulExists ? 'healthy' : 'damaged',
    }

    this.emit({
      type: 'agent-archived',
      agentId,
      agent: summary,
      occurredAt: now,
    })

    return summary
  }

  /**
   * 恢复已归档的 Agent 到活跃状态。
   *
   * @param agentId - Agent 标识。
   * @returns 恢复后的 AgentSummary。
   * @throws 当 Agent 不存在或配置保存失败时，Promise 会 reject。
   */
  async recoverAgent(agentId: AgentId): Promise<AgentSummary> {
    const readResult = await this.configStore.read()
    const config = readResult.config

    if (!config || !config.agents[agentId]) {
      throw new AgentRuntimeError({
        code: 'session-not-found',
        message: `Agent ${agentId} 不存在。`,
        recoverable: true,
      })
    }

    const currentAgent = config.agents[agentId]
    const now = this.now()

    const updatedAgent: AgentConfig = {
      ...currentAgent,
      status: 'active',
      archivedAt: null,
    }
    config.agents[agentId] = updatedAgent
    await this.configStore.write(config)

    const homePath = this.layout.agentHome(agentId)
    const soulExists = await pathExists(join(homePath, 'soul.md'))

    const summary: AgentSummary = {
      agentId,
      displayName: updatedAgent.displayName,
      status: updatedAgent.status,
      defaultProviderId: updatedAgent.defaultProviderId,
      defaultModelId: updatedAgent.defaultModelId,
      homePath,
      archivedAt: updatedAgent.archivedAt,
      directoryStatus: soulExists ? 'healthy' : 'damaged',
    }

    this.emit({
      type: 'agent-recovered',
      agentId,
      agent: summary,
      occurredAt: now,
    })

    return summary
  }

  /**
   * 执行目录对账：对照配置检查 Agent 目录存在性，扫描发现未归属目录。
   *
   * @returns 对账报告，包含更新后的 Agent 列表和未归属目录。
   * @throws 当配置读取或目录扫描失败时，Promise 会 reject。
   */
  async reconcileAgentDirectories(): Promise<{
    agents: AgentSummary[]
    unclaimedDirectories: UnclaimedDirectory[]
  }> {
    const readResult = await this.configStore.read()
    const config = readResult.config

    const agents = await this.buildAgentSummaries(config)

    // 扫描 agents 目录，发现磁盘上有但配置中没有的目录
    const agentsDir = dirname(this.layout.agentHome(TANGYUAN_DEFAULT_AGENT_ID))
    const unclaimedDirectories: UnclaimedDirectory[] = []

    try {
      const entries = await readdir(agentsDir, { withFileTypes: true })
      const configAgentIds = new Set(
        config?.agents ? Object.keys(config.agents) : [],
      )

      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const agentId = entry.name

        // 跳过 tangyuan（始终在配置中）
        if (agentId === TANGYUAN_DEFAULT_AGENT_ID) continue
        // 跳过已有配置条的目录
        if (configAgentIds.has(agentId)) continue

        const homePath = this.layout.agentHome(agentId)
        const hasSoul = await pathExists(join(homePath, 'soul.md'))

        unclaimedDirectories.push({
          agentId,
          homePath,
          hasSoul,
        })
      }
    } catch {
      // 目录不存在，没有未归属项
    }

    return { agents, unclaimedDirectories }
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
    const homePath = this.layout.agentHome(agentId)
    const soulExists = await pathExists(join(homePath, 'soul.md'))

    if (!soulExists) {
      throw new AgentRuntimeError({
        code: 'session-not-found',
        message: `目录 ${agentId} 不存在或缺少 soul.md，无法认领。`,
        recoverable: true,
      })
    }

    const readResult = await this.configStore.read()
    const config = readResult.config ?? createDefaultInternalConfig()

    // 继承 tangyuan 的 Provider/Model
    const tangyuanConfig = extractAgentRuntimeConfig(
      config,
      TANGYUAN_DEFAULT_AGENT_ID,
    )

    config.agents[agentId] = {
      displayName,
      defaultProviderId: tangyuanConfig?.providerId ?? null,
      defaultModelId: tangyuanConfig?.modelId ?? null,
      status: 'active',
      archivedAt: null,
    }
    await this.configStore.write(config)

    const summary: AgentSummary = {
      agentId,
      displayName,
      status: 'active',
      defaultProviderId: tangyuanConfig?.providerId ?? null,
      defaultModelId: tangyuanConfig?.modelId ?? null,
      homePath,
      archivedAt: null,
      directoryStatus: 'healthy',
    }

    return summary
  }

  /**
   * 按固定模板重建默认汤圆的目录结构。
   *
   * @returns 重建后的 AgentSummary。
   * @throws 当目录创建或文件写入失败时，Promise 会 reject。
   */
  async rebuildTangyuanHome(): Promise<AgentSummary> {
    const homePath = this.layout.agentHome(TANGYUAN_DEFAULT_AGENT_ID)
    const now = this.now()

    // 确保目录结构存在
    await mkdir(homePath, { recursive: true })
    await Promise.all([
      mkdir(join(homePath, 'soul.history'), { recursive: true }),
      mkdir(join(homePath, 'user.history'), { recursive: true }),
      mkdir(join(homePath, 'memory'), { recursive: true }),
      mkdir(join(homePath, 'skills'), { recursive: true }),
      mkdir(join(homePath, 'workspace'), { recursive: true }),
    ])

    // 写出模板 soul.md
    const soulContent = [
      '# 汤圆',
      '',
      `重建时间：${now}`,
      '',
      '## 身份',
      '汤圆是默认 Agent，负责凭据管理和创建其他 Agent。',
      '',
      '## 职责',
      '- 帮助用户配置模型服务凭据',
      '- 通过对话创建和管理其他 Agent',
      '- 维护共享用户资料',
      '',
      '## 规则',
      '遵循用户指令，在执行危险操作前先确认。',
      '使用中文回复，简洁清晰。',
      '',
    ].join('\n')
    await writeFile(join(homePath, 'soul.md'), soulContent, 'utf8')

    const readResult = await this.configStore.read()
    const config = readResult.config

    const summary: AgentSummary = {
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      displayName:
        config?.agents[TANGYUAN_DEFAULT_AGENT_ID]?.displayName ?? '汤圆',
      status: config?.agents[TANGYUAN_DEFAULT_AGENT_ID]?.status ?? 'active',
      defaultProviderId:
        config?.agents[TANGYUAN_DEFAULT_AGENT_ID]?.defaultProviderId ?? null,
      defaultModelId:
        config?.agents[TANGYUAN_DEFAULT_AGENT_ID]?.defaultModelId ?? null,
      homePath,
      archivedAt: config?.agents[TANGYUAN_DEFAULT_AGENT_ID]?.archivedAt ?? null,
      directoryStatus: 'healthy',
    }

    return summary
  }

  /**
   * 组装所有 Agent 的摘要，含目录健康状态诊断。
   *
   * @param config - 当前内部配置，可为空。
   * @returns Agent 摘要列表。
   * @throws 当目录检查失败时，Promise 会 reject。
   */
  async buildAgentSummaries(
    config: InternalRuntimeConfig | null,
  ): Promise<AgentSummary[]> {
    const tangyuanHomeExists = await pathExists(
      join(this.layout.agentHome(TANGYUAN_DEFAULT_AGENT_ID), 'soul.md'),
    )

    const tangyuanSummary: AgentSummary = {
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      displayName:
        config?.agents[TANGYUAN_DEFAULT_AGENT_ID]?.displayName ?? '汤圆',
      status: config?.agents[TANGYUAN_DEFAULT_AGENT_ID]?.status ?? 'active',
      defaultProviderId:
        config?.agents[TANGYUAN_DEFAULT_AGENT_ID]?.defaultProviderId ?? null,
      defaultModelId:
        config?.agents[TANGYUAN_DEFAULT_AGENT_ID]?.defaultModelId ?? null,
      homePath: this.agentHomePath,
      archivedAt: config?.agents[TANGYUAN_DEFAULT_AGENT_ID]?.archivedAt ?? null,
      directoryStatus: tangyuanHomeExists ? 'healthy' : 'damaged',
    }

    if (!config) {
      return [tangyuanSummary]
    }

    const otherAgents = await Promise.all(
      Object.entries(config.agents)
        .filter(([agentId]) => agentId !== TANGYUAN_DEFAULT_AGENT_ID)
        .map(async ([agentId, agentConfig]) => {
          const homePath = this.layout.agentHome(agentId)
          const soulExists = await pathExists(join(homePath, 'soul.md'))

          return {
            agentId,
            displayName: agentConfig.displayName,
            status: agentConfig.status,
            defaultProviderId: agentConfig.defaultProviderId,
            defaultModelId: agentConfig.defaultModelId,
            homePath,
            archivedAt: agentConfig.archivedAt,
            directoryStatus: soulExists
              ? ('healthy' as const)
              : ('damaged' as const),
          }
        }),
    )

    return [tangyuanSummary, ...otherAgents]
  }
}
