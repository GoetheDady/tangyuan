import type { AgentSessionSummary } from '@yuanxiao/contracts'
import type { SessionModule } from '../runtime/runtime-modules'

interface SessionDirectoryDependencies {
  sessions: Pick<
    SessionModule,
    'listSessions' | 'getActiveRunId' | 'getTranscript'
  >
  isQueued(sessionId: string): boolean
}

/**
 * Runtime 的会话目录：集中按 Agent 缓存会话，并投影运行状态与谱系可用性。
 */
export class SessionDirectory {
  private readonly sessions: SessionDirectoryDependencies['sessions']
  private readonly isQueued: SessionDirectoryDependencies['isQueued']
  private readonly sessionsByAgentId = new Map<string, AgentSessionSummary[]>()

  constructor(dependencies: SessionDirectoryDependencies) {
    this.sessions = dependencies.sessions
    this.isQueued = dependencies.isQueued
  }

  async refresh(
    agentId: string,
    includeArchived = false,
  ): Promise<AgentSessionSummary[]> {
    const source = await this.sessions.listSessions({
      agentId,
      ...(includeArchived ? { includeArchived: true } : {}),
    })
    const sessions = source.map((session) => ({
      ...session,
      state:
        this.sessions.getActiveRunId(session.sessionId) !== undefined
          ? ('running' as const)
          : this.isQueued(session.sessionId)
            ? ('queued' as const)
            : session.state,
    }))

    const readability = new Map<string, boolean>()
    for (const session of sessions) {
      if (
        session.archivedAt === undefined &&
        !(await this.hasReadableLineage(session, sessions, false, readability))
      ) {
        session.lineageUnavailable = true
      }
    }

    const activeSessions = sessions.filter(
      (session) => session.archivedAt === undefined,
    )
    this.sessionsByAgentId.set(agentId, activeSessions)

    return includeArchived ? sessions : activeSessions
  }

  async isRestorable(
    session: AgentSessionSummary,
    sessions: AgentSessionSummary[],
  ): Promise<boolean> {
    return this.hasReadableLineage(session, sessions, true, new Map())
  }

  listAll(): AgentSessionSummary[] {
    return [...this.sessionsByAgentId.values()].flat()
  }

  find(sessionId: string): AgentSessionSummary | undefined {
    return this.listAll().find((session) => session.sessionId === sessionId)
  }

  upsert(session: AgentSessionSummary): void {
    this.remove(session.sessionId)
    const sessions = this.sessionsByAgentId.get(session.agentId) ?? []
    this.sessionsByAgentId.set(session.agentId, [session, ...sessions])
  }

  updateState(
    sessionId: string,
    state: AgentSessionSummary['state'],
    updatedAt: string,
  ): void {
    for (const [agentId, sessions] of this.sessionsByAgentId) {
      const index = sessions.findIndex(
        (session) => session.sessionId === sessionId,
      )
      if (index === -1) continue

      const next = [...sessions]
      next[index] = { ...sessions[index]!, state, updatedAt }
      this.sessionsByAgentId.set(agentId, next)
      return
    }
  }

  remove(sessionId: string): void {
    for (const [agentId, sessions] of this.sessionsByAgentId) {
      const remaining = sessions.filter(
        (session) => session.sessionId !== sessionId,
      )
      if (remaining.length !== sessions.length) {
        this.sessionsByAgentId.set(agentId, remaining)
      }
    }
  }

  private async hasReadableLineage(
    session: AgentSessionSummary,
    sessions: AgentSessionSummary[],
    includeSelf: boolean,
    readability: Map<string, boolean>,
  ): Promise<boolean> {
    const sessionsById = new Map(
      sessions.map((candidate) => [candidate.sessionId, candidate]),
    )
    const visited = new Set<string>()
    let candidate = includeSelf
      ? session
      : sessionsById.get(session.forkedFrom?.sessionId ?? '')

    if (!includeSelf && session.forkedFrom?.sessionId && !candidate) {
      return false
    }

    while (candidate) {
      if (
        candidate.agentId !== session.agentId ||
        visited.has(candidate.sessionId)
      ) {
        return false
      }
      visited.add(candidate.sessionId)

      let readable = readability.get(candidate.sessionId)
      if (readable === undefined) {
        try {
          await this.sessions.getTranscript({
            agentId: candidate.agentId,
            sessionId: candidate.sessionId,
          })
          readable = true
        } catch {
          readable = false
        }
        readability.set(candidate.sessionId, readable)
      }
      if (!readable) return false

      const parentSessionId = candidate.forkedFrom?.sessionId
      if (!parentSessionId) return true
      candidate = sessionsById.get(parentSessionId)
      if (!candidate) return false
    }

    return true
  }
}
