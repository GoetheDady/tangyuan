import type { AgentSessionSummary } from '@tangyuan/contracts'

/**
 * 会话状态记事本：持有当前已知会话摘要列表，
 * 承载「会话如何写入、更新运行状态、按最近更新排序、查找」这一条状态知识。
 * 纯状态容器，不感知运行调度（activeRunIds/runQueue 留在编排层），
 * 也不感知事件广播；状态回填由调用方在写入前完成。
 */
export class SessionCache {
  private sessions: AgentSessionSummary[] = []

  /**
   * 整体替换会话列表（用于从 Driver 刷新）。
   *
   * @param sessions - 新的会话摘要列表（调用方已完成运行状态回填）。
   */
  replace(sessions: AgentSessionSummary[]): void {
    this.sessions = sessions
  }

  /**
   * 读取当前全部会话摘要。
   *
   * @returns 会话摘要列表。
   */
  list(): AgentSessionSummary[] {
    return this.sessions
  }

  /**
   * 查找指定会话摘要。
   *
   * @param sessionId - 会话标识。
   * @returns 找到时返回摘要，否则返回 undefined。
   */
  find(sessionId: string): AgentSessionSummary | undefined {
    return this.sessions.find((session) => session.sessionId === sessionId)
  }

  /**
   * 新增或替换会话摘要，并保持最近更新会话排在前面。
   *
   * @param session - 需要写入缓存的会话摘要。
   */
  upsert(session: AgentSessionSummary): void {
    this.sessions = [
      session,
      ...this.sessions.filter(
        (candidate) => candidate.sessionId !== session.sessionId,
      ),
    ]
  }

  /**
   * 更新指定会话的运行状态。
   *
   * @param sessionId - 需要更新的会话标识。
   * @param state - 新运行状态。
   * @param updatedAt - 状态更新时间。
   */
  updateState(
    sessionId: string,
    state: AgentSessionSummary['state'],
    updatedAt: string,
  ): void {
    this.sessions = this.sessions.map((session) =>
      session.sessionId === sessionId
        ? { ...session, state, updatedAt }
        : session,
    )
  }
}
