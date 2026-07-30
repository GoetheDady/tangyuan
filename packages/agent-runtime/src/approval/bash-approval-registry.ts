import type { AgentEvent, BashApprovalRequest } from '@tangyuan/contracts'

/**
 * 创建 BashApprovalRegistry 所需的依赖。
 */
export interface BashApprovalRegistryDependencies {
  emit: (event: AgentEvent) => void
  now: () => string
}

interface PendingBashApproval {
  request: BashApprovalRequest
  resolve: (result: { approved: boolean }) => void
}

/**
 * 待处理 Bash 审批登记表：持有等待用户决议的 Bash 执行请求，
 * 承载「审批如何登记、批准/拒绝、按会话或全量清理」这一条状态知识。
 * 事件广播通过注入的 emit 回调完成，自身不感知订阅者。
 */
export class BashApprovalRegistry {
  private readonly emit: (event: AgentEvent) => void
  private readonly now: () => string
  private readonly pending = new Map<string, PendingBashApproval>()

  constructor(dependencies: BashApprovalRegistryDependencies) {
    this.emit = dependencies.emit
    this.now = dependencies.now
  }

  /**
   * 登记一次 Bash 审批请求并广播 approval-required，等待用户决议。
   *
   * @param request - 待审批的 Bash 执行请求。
   * @returns 用户批准时 resolve `{ approved: true }`，拒绝时 `{ approved: false }`。
   */
  register(request: BashApprovalRequest): Promise<{ approved: boolean }> {
    return new Promise<{ approved: boolean }>((resolve) => {
      this.pending.set(request.approvalId, { request, resolve })

      this.emit({
        type: 'approval-required',
        agentId: request.agentId,
        sessionId: request.sessionId,
        approval: request,
        occurredAt: this.now(),
      })
    })
  }

  /**
   * 批准指定审批请求，使命令继续执行。
   *
   * @param approvalId - 审批标识。
   * @throws 当审批不存在或已过期时抛出错误。
   */
  approve(approvalId: string): void {
    this.resolve(approvalId, 'approved')
  }

  /**
   * 拒绝指定审批请求，向 Agent 返回拒绝结果。
   *
   * @param approvalId - 审批标识。
   * @throws 当审批不存在或已过期时抛出错误。
   */
  reject(approvalId: string): void {
    this.resolve(approvalId, 'rejected')
  }

  /**
   * 读取所有待审批请求。
   *
   * @returns 待审批请求列表。
   */
  list(): BashApprovalRequest[] {
    return [...this.pending.values()].map((entry) => entry.request)
  }

  /**
   * 拒绝指定会话的所有待审批请求（用于取消该会话的运行）。
   *
   * @param sessionId - 被取消的会话标识。
   */
  rejectSession(sessionId: string): void {
    for (const [approvalId, entry] of this.pending) {
      if (entry.request.sessionId === sessionId) {
        this.resolve(approvalId, 'rejected')
      }
    }
  }

  /**
   * 拒绝所有待审批请求（用于应用退出/全部取消场景）。
   */
  rejectAll(): void {
    for (const approvalId of [...this.pending.keys()]) {
      this.resolve(approvalId, 'rejected')
    }
  }

  private resolve(approvalId: string, status: 'approved' | 'rejected'): void {
    const entry = this.pending.get(approvalId)

    if (!entry) {
      throw new Error(`找不到审批请求 ${approvalId}，可能已过期或已被处理。`)
    }

    this.pending.delete(approvalId)

    this.emit({
      type: 'approval-resolved',
      agentId: entry.request.agentId,
      sessionId: entry.request.sessionId,
      approvalId,
      status,
      occurredAt: this.now(),
    })

    entry.resolve({ approved: status === 'approved' })
  }
}
