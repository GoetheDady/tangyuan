import type { AgentSessionSummary } from '@yuanxiao/contracts'
import type { SessionModule } from './runtime-modules'

/**
 * 验证会话及其完整父链的 Pi session 内容仍可读取。
 *
 * @param sessionsModule - Session 模块（用于读取会话 transcript）。
 * @param session - 需要验证的会话摘要。
 * @param sessions - 同一 Agent 的全部可见会话。
 * @returns 谱系完整且每个 transcript 可读时返回 true。
 * @throws 此函数不会主动抛出错误（读取失败视为谱系不可恢复）。
 */
export async function canRestoreSessionLineage(
  sessionsModule: Pick<SessionModule, 'getTranscript'>,
  session: AgentSessionSummary,
  sessions: AgentSessionSummary[],
): Promise<boolean> {
  const sessionsById = new Map(
    sessions.map((candidate) => [candidate.sessionId, candidate]),
  )
  const visitedSessionIds = new Set<string>()
  let candidate: AgentSessionSummary | undefined = session

  while (candidate) {
    if (
      candidate.agentId !== session.agentId ||
      visitedSessionIds.has(candidate.sessionId)
    ) {
      return false
    }
    visitedSessionIds.add(candidate.sessionId)

    try {
      await sessionsModule.getTranscript({
        agentId: candidate.agentId,
        sessionId: candidate.sessionId,
      })
    } catch {
      return false
    }

    const parentSessionId = candidate.forkedFrom?.sessionId
    if (!parentSessionId) {
      return true
    }
    candidate = sessionsById.get(parentSessionId)
  }

  return false
}
