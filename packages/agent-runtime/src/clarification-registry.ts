import type {
  AgentEvent,
  QuestionClarificationRequest,
} from '@tangyuan/contracts'

/**
 * 创建 ClarificationRegistry 所需的依赖。
 */
export interface ClarificationRegistryDependencies {
  emit: (event: AgentEvent) => void
  now: () => string
}

interface PendingClarification {
  request: QuestionClarificationRequest
  resolve: (result: { answer: string }) => void
}

/**
 * 待回答澄清登记表：持有等待用户回答的澄清问题，
 * 承载「澄清如何登记、回答、按会话或全量取消」这一条状态知识。
 * 事件广播通过注入的 emit 回调完成，自身不感知订阅者。
 */
export class ClarificationRegistry {
  private readonly emit: (event: AgentEvent) => void
  private readonly now: () => string
  private readonly pending = new Map<string, PendingClarification>()

  constructor(dependencies: ClarificationRegistryDependencies) {
    this.emit = dependencies.emit
    this.now = dependencies.now
  }

  /**
   * 登记一次澄清请求并广播 clarification-required，等待用户回答。
   *
   * @param request - 待回答的澄清请求。
   * @returns 用户回答或取消时 resolve `{ answer }`（取消时为空串）。
   */
  register(
    request: QuestionClarificationRequest,
  ): Promise<{ answer: string }> {
    return new Promise<{ answer: string }>((resolve) => {
      this.pending.set(request.clarificationId, { request, resolve })

      this.emit({
        type: 'clarification-required',
        agentId: request.agentId,
        sessionId: request.sessionId,
        clarification: request,
        occurredAt: this.now(),
      })
    })
  }

  /**
   * 提交澄清答案，使 Agent 从断点继续执行。
   *
   * @param clarificationId - 澄清标识。
   * @param answer - 用户选择的答案（预设选项或自定义输入）。
   * @throws 当澄清不存在或已过期时抛出错误。
   */
  answer(clarificationId: string, answer: string): void {
    this.resolve(clarificationId, 'answered', answer)
  }

  /**
   * 取消澄清问题，以取消结果结束工具调用。
   *
   * @param clarificationId - 澄清标识。
   * @throws 当澄清不存在或已过期时抛出错误。
   */
  cancel(clarificationId: string): void {
    this.resolve(clarificationId, 'cancelled', '')
  }

  /**
   * 读取所有待回答的澄清请求。
   *
   * @returns 待回答澄清请求列表。
   */
  list(): QuestionClarificationRequest[] {
    return [...this.pending.values()].map((entry) => entry.request)
  }

  /**
   * 取消指定会话的所有待回答澄清（用于取消该会话的运行）。
   *
   * @param sessionId - 被取消的会话标识。
   */
  cancelSession(sessionId: string): void {
    for (const [clarificationId, entry] of this.pending) {
      if (entry.request.sessionId === sessionId) {
        this.resolve(clarificationId, 'cancelled', '')
      }
    }
  }

  /**
   * 取消所有待回答澄清（用于应用退出/全部取消场景）。
   */
  cancelAll(): void {
    for (const clarificationId of [...this.pending.keys()]) {
      this.resolve(clarificationId, 'cancelled', '')
    }
  }

  private resolve(
    clarificationId: string,
    status: 'answered' | 'cancelled',
    answer: string,
  ): void {
    const entry = this.pending.get(clarificationId)

    if (!entry) {
      throw new Error(
        `找不到澄清请求 ${clarificationId}，可能已过期或已被处理。`,
      )
    }

    this.pending.delete(clarificationId)

    this.emit({
      type: 'clarification-resolved',
      agentId: entry.request.agentId,
      sessionId: entry.request.sessionId,
      clarificationId,
      answer,
      status,
      occurredAt: this.now(),
    })

    entry.resolve({ answer })
  }
}
