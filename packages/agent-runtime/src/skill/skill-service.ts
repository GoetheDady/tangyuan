import type {
  SkillInstallRecord,
  SkillOperationParams,
  SkillSummary,
} from '@yuanxiao/contracts'
import type { SessionModule, SkillModule } from '../runtime/runtime-modules'

/**
 * 创建 SkillService 所需的依赖。
 */
export interface SkillServiceDependencies {
  skills: SkillModule
  sessions: SessionModule
  defaultAgentId: string
}

/**
 * Skill 管理服务：承载 Skill 列出、安装、删除和安装记录读取，安装/删除后
 * 按 Skill 来源刷新对应会话。
 */
export class SkillService {
  private readonly skills: SkillModule
  private readonly sessions: SessionModule
  private readonly defaultAgentId: string

  constructor(dependencies: SkillServiceDependencies) {
    this.skills = dependencies.skills
    this.sessions = dependencies.sessions
    this.defaultAgentId = dependencies.defaultAgentId
  }

  /**
   * 列出指定 Agent 实际生效的 Skill 列表（含冲突诊断）。
   *
   * @param agentId - Agent 标识。
   * @returns Skill 摘要列表。
   * @throws 当 Skill 模块读取失败时，Promise 会 reject。
   */
  async listAgentSkills(agentId: string): Promise<SkillSummary[]> {
    return this.skills.listAgentSkills(agentId)
  }

  /**
   * 列出共享 Skill 列表。
   *
   * @returns 共享 Skill 摘要列表。
   * @throws 当 Skill 模块读取失败时，Promise 会 reject。
   */
  async listSharedSkills(): Promise<SkillSummary[]> {
    return this.skills.listSharedSkills()
  }

  /**
   * 安装或更新 Skill（含权限校验与按来源 reload）。
   *
   * @param params - 操作参数。
   * @returns 更新后的 Skill 摘要列表。
   * @throws 当权限不足、校验或 Skill 模块安装失败时，Promise 会 reject。
   */
  async install(params: SkillOperationParams): Promise<SkillSummary[]> {
    this.validatePermission(params)
    const result = await this.skills.installSkill(params)
    await this.reloadAfterOperation(params)
    return result
  }

  /**
   * 删除 Skill（含权限校验与按来源 reload）。
   *
   * @param params - 操作参数。
   * @returns 更新后的 Skill 摘要列表。
   * @throws 当权限不足或 Skill 模块删除失败时，Promise 会 reject。
   */
  async delete(params: SkillOperationParams): Promise<SkillSummary[]> {
    this.validatePermission(params)
    const result = await this.skills.deleteSkill(params)
    await this.reloadAfterOperation(params)
    return result
  }

  /**
   * 读取 Skill 安装记录。
   *
   * @returns 安装记录列表。
   * @throws 当 Skill 模块读取失败时，Promise 会 reject。
   */
  async getInstallRecords(): Promise<SkillInstallRecord[]> {
    return this.skills.getSkillInstallRecords()
  }

  /**
   * 校验 Skill 操作权限。
   *
   * @param params - 操作参数。
   * @throws 当权限不足时抛出可读错误。
   */
  private validatePermission(params: SkillOperationParams): void {
    if (params.source === 'shared') {
      // 共享 Skill 只能由元宵管理
      if (params.agentId !== this.defaultAgentId) {
        throw new Error(
          `只有默认 Agent「元宵」可以管理共享 Skill，当前 Agent "${params.agentId}" 无权操作。`,
        )
      }
      return
    }

    // 专属 Skill：只能由 Agent 自身或元宵管理
    const targetId = params.targetAgentId ?? params.agentId
    if (params.agentId !== targetId && params.agentId !== this.defaultAgentId) {
      throw new Error(
        `Agent "${params.agentId}" 无权管理 Agent "${targetId}" 的专属 Skill。只有 Agent 自身或元宵可以操作。`,
      )
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
      await this.sessions.reloadAllSessions()
    } else if (params.targetAgentId) {
      await this.sessions.reloadAgentSessions(params.targetAgentId)
    }
  }
}
