import type { AgentEvent, SkillApprovalRequest } from '@tangyuan/contracts'

/**
 * 创建 SkillApprovalRegistry 所需的依赖。
 */
export interface SkillApprovalRegistryDependencies {
  emit: (event: AgentEvent) => void
  now: () => string
}

interface PendingSkillApproval {
  request: SkillApprovalRequest
  resolve: (result: { approved: boolean }) => void
}

/**
 * 待处理 Skill 操作审批登记表：持有等待用户决议的 Skill 安装/删除请求，
 * 承载「审批如何登记、批准/拒绝、全量清理」这一条状态知识。
 * Skill 审批不绑定会话（只属于某个 Agent），因此无按会话清理能力。
 * 事件广播通过注入的 emit 回调完成，自身不感知订阅者。
 */
export class SkillApprovalRegistry {
  private readonly emit: (event: AgentEvent) => void
  private readonly now: () => string
  private readonly pending = new Map<string, PendingSkillApproval>()

  constructor(dependencies: SkillApprovalRegistryDependencies) {
    this.emit = dependencies.emit
    this.now = dependencies.now
  }

  /**
   * 登记一次 Skill 操作审批请求并广播 skill-approval-required，等待用户决议。
   *
   * @param request - 待审批的 Skill 操作请求。
   * @returns 用户批准时 resolve `{ approved: true }`，拒绝时 `{ approved: false }`。
   */
  register(request: SkillApprovalRequest): Promise<{ approved: boolean }> {
    return new Promise<{ approved: boolean }>((resolve) => {
      this.pending.set(request.approvalId, { request, resolve })

      this.emit({
        type: 'skill-approval-required',
        agentId: request.agentId,
        approval: request,
        occurredAt: this.now(),
      })
    })
  }

  /**
   * 批准指定 Skill 操作审批请求。
   *
   * @param approvalId - 审批标识。
   * @throws 当审批不存在或已过期时抛出错误。
   */
  approve(approvalId: string): void {
    this.resolve(approvalId, 'approved')
  }

  /**
   * 拒绝指定 Skill 操作审批请求。
   *
   * @param approvalId - 审批标识。
   * @throws 当审批不存在或已过期时抛出错误。
   */
  reject(approvalId: string): void {
    this.resolve(approvalId, 'rejected')
  }

  /**
   * 读取所有待审批的 Skill 操作请求。
   *
   * @returns 待审批 Skill 操作请求列表。
   */
  list(): SkillApprovalRequest[] {
    return [...this.pending.values()].map((entry) => entry.request)
  }

  /**
   * 拒绝所有待审批 Skill 操作（用于应用退出/全部取消场景）。
   */
  rejectAll(): void {
    for (const approvalId of [...this.pending.keys()]) {
      this.resolve(approvalId, 'rejected')
    }
  }

  private resolve(approvalId: string, status: 'approved' | 'rejected'): void {
    const entry = this.pending.get(approvalId)

    if (!entry) {
      throw new Error(
        `找不到 Skill 审批请求 ${approvalId}，可能已过期或已被处理。`,
      )
    }

    this.pending.delete(approvalId)

    this.emit({
      type: 'skill-approval-resolved',
      agentId: entry.request.agentId,
      approvalId,
      status,
      occurredAt: this.now(),
    })

    entry.resolve({ approved: status === 'approved' })
  }
}
