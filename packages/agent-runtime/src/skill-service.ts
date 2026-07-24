import type {
  AgentEvent,
  SkillApprovalRequest,
  SkillInstallRecord,
  SkillOperationParams,
  SkillSummary,
} from '@tangyuan/contracts'
import type { AgentSessionDriver } from './index'
import { SkillApprovalRegistry } from './skill-approval-registry'

/**
 * 创建 SkillService 所需的依赖。
 */
export interface SkillServiceDependencies {
  sessionDriver: AgentSessionDriver
  defaultAgentId: string
  emit: (event: AgentEvent) => void
  now: () => string
}

/**
 * Skill 管理服务：承载「Skill 如何列出、安装/删除（含权限校验、审批、
 * 按来源 reload 会话）、读取安装记录」这一族操作，并持有 Skill 审批登记表。
 * 编排 sessionDriver 与 SkillApprovalRegistry，安装/删除后按 Skill 来源
 * 决定刷新范围（共享 → 全部 session；专属 → 目标 Agent 的 session）。
 */
export class SkillService {
  private readonly sessionDriver: AgentSessionDriver
  private readonly defaultAgentId: string
  private readonly approvals: SkillApprovalRegistry
  private readonly now: () => string

  constructor(dependencies: SkillServiceDependencies) {
    this.sessionDriver = dependencies.sessionDriver
    this.defaultAgentId = dependencies.defaultAgentId
    this.now = dependencies.now
    this.approvals = new SkillApprovalRegistry({
      emit: dependencies.emit,
      now: dependencies.now,
    })
  }

  /**
   * 列出指定 Agent 实际生效的 Skill 列表（含冲突诊断）。
   *
   * @param agentId - Agent 标识。
   * @returns Skill 摘要列表。
   * @throws 当 Driver 不支持或读取失败时，Promise 会 reject。
   */
  async listAgentSkills(agentId: string): Promise<SkillSummary[]> {
    if (!this.sessionDriver.listAgentSkills) {
      throw new Error('当前运行时不支持读取 Agent Skills。')
    }
    return this.sessionDriver.listAgentSkills(agentId)
  }

  /**
   * 列出共享 Skill 列表。
   *
   * @returns 共享 Skill 摘要列表。
   * @throws 当 Driver 不支持或读取失败时，Promise 会 reject。
   */
  async listSharedSkills(): Promise<SkillSummary[]> {
    if (!this.sessionDriver.listSharedSkills) {
      throw new Error('当前运行时不支持读取共享 Skills。')
    }
    return this.sessionDriver.listSharedSkills()
  }

  /**
   * 安装或更新 Skill（含权限校验、审批与按来源 reload）。
   *
   * @param params - 操作参数。
   * @returns 更新后的 Skill 摘要列表。
   * @throws 当权限不足、用户拒绝、校验失败或 Driver 不支持时，Promise 会 reject。
   */
  async install(params: SkillOperationParams): Promise<SkillSummary[]> {
    this.validatePermission(params)
    if (!this.sessionDriver.installSkill) {
      throw new Error('当前运行时不支持安装 Skill。')
    }
    await this.requireApproval(params)
    const result = await this.sessionDriver.installSkill(params)
    await this.reloadAfterOperation(params)
    return result
  }

  /**
   * 删除 Skill（含权限校验、审批与按来源 reload）。
   *
   * @param params - 操作参数。
   * @returns 更新后的 Skill 摘要列表。
   * @throws 当权限不足、用户拒绝或 Driver 不支持时，Promise 会 reject。
   */
  async delete(params: SkillOperationParams): Promise<SkillSummary[]> {
    this.validatePermission(params)
    if (!this.sessionDriver.deleteSkill) {
      throw new Error('当前运行时不支持删除 Skill。')
    }
    await this.requireApproval(params)
    const result = await this.sessionDriver.deleteSkill(params)
    await this.reloadAfterOperation(params)
    return result
  }

  /**
   * 读取 Skill 安装记录。
   *
   * @returns 安装记录列表。
   * @throws 当 Driver 不支持或读取失败时，Promise 会 reject。
   */
  async getInstallRecords(): Promise<SkillInstallRecord[]> {
    if (!this.sessionDriver.getSkillInstallRecords) {
      throw new Error('当前运行时不支持读取 Skill 安装记录。')
    }
    return this.sessionDriver.getSkillInstallRecords()
  }

  /**
   * 批准指定 Skill 操作审批请求。
   *
   * @param approvalId - 审批标识。
   * @throws 当审批不存在或已过期时抛出错误。
   */
  approveOperation(approvalId: string): void {
    this.approvals.approve(approvalId)
  }

  /**
   * 拒绝指定 Skill 操作审批请求。
   *
   * @param approvalId - 审批标识。
   * @throws 当审批不存在或已过期时抛出错误。
   */
  rejectOperation(approvalId: string): void {
    this.approvals.reject(approvalId)
  }

  /**
   * 读取所有待审批的 Skill 操作请求。
   *
   * @returns 待审批 Skill 操作请求列表。
   */
  getPendingApprovals(): SkillApprovalRequest[] {
    return this.approvals.list()
  }

  /**
   * 拒绝所有待审批 Skill 操作（用于应用退出/全部取消场景）。
   */
  rejectAllApprovals(): void {
    this.approvals.rejectAll()
  }

  /**
   * 校验 Skill 操作权限。
   *
   * @param params - 操作参数。
   * @throws 当权限不足时抛出可读错误。
   */
  private validatePermission(params: SkillOperationParams): void {
    if (params.source === 'shared') {
      // 共享 Skill 只能由汤圆管理
      if (params.agentId !== this.defaultAgentId) {
        throw new Error(
          `只有默认 Agent「汤圆」可以管理共享 Skill，当前 Agent "${params.agentId}" 无权操作。`,
        )
      }
      return
    }

    // 专属 Skill：只能由 Agent 自身或汤圆管理
    const targetId = params.targetAgentId ?? params.agentId
    if (params.agentId !== targetId && params.agentId !== this.defaultAgentId) {
      throw new Error(
        `Agent "${params.agentId}" 无权管理 Agent "${targetId}" 的专属 Skill。只有 Agent 自身或汤圆可以操作。`,
      )
    }
  }

  /**
   * 创建 Skill 操作审批并等待用户决议，拒绝时抛错。
   *
   * @param params - 操作参数。
   * @throws 当用户拒绝时抛出错误。
   */
  private async requireApproval(params: SkillOperationParams): Promise<void> {
    const request: SkillApprovalRequest = {
      approvalId: crypto.randomUUID(),
      agentId: params.agentId,
      operation: params.operation,
      source: params.source,
      ...(params.targetAgentId !== undefined
        ? { targetAgentId: params.targetAgentId }
        : {}),
      skillName: params.skillName,
      description: '',
      hasScripts: false,
      status: 'pending',
      createdAt: this.now(),
    }

    const { approved } = await this.approvals.register(request)
    if (!approved) {
      throw new Error('用户拒绝了 Skill 操作。')
    }
  }

  /**
   * 按 Skill 来源刷新会话：共享刷新全部，专属刷新目标 Agent。
   *
   * @param params - 操作参数。
   */
  private async reloadAfterOperation(
    params: SkillOperationParams,
  ): Promise<void> {
    if (params.source === 'shared') {
      if (!this.sessionDriver.reloadAllSessions) {
        throw new Error('当前运行时不支持重新加载全部 session。')
      }
      await this.sessionDriver.reloadAllSessions()
    } else if (params.targetAgentId) {
      if (!this.sessionDriver.reloadAgentSessions) {
        throw new Error('当前运行时不支持重新加载 Agent session。')
      }
      await this.sessionDriver.reloadAgentSessions(params.targetAgentId)
    }
  }
}
