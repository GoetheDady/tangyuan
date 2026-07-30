import type { AgentSessionSummary } from '@tangyuan/contracts'

export interface SessionArchiveLease {
  lock(sessionIds: readonly string[]): void
  owns(sessionId: string): boolean
  waitForPendingForks(sessionIds: readonly string[]): Promise<void>
  release(): void
}

/** 协调会话归档门闩与归档开始前已经进入 Driver 的分叉操作。 */
export class SessionArchiveCoordinator {
  private readonly archivingSessionIds = new Set<string>()
  private readonly pendingForksBySourceSession = new Map<
    string,
    Set<Promise<unknown>>
  >()

  isArchiving(sessionId: string): boolean {
    return this.archivingSessionIds.has(sessionId)
  }

  assertAvailable(sessionId: string): void {
    if (this.isArchiving(sessionId)) {
      throw new Error('当前会话正在归档，请稍后重试。')
    }
  }

  async trackFork<T>(
    sourceSessionId: string,
    pendingFork: Promise<T>,
  ): Promise<T> {
    const pendingForSource =
      this.pendingForksBySourceSession.get(sourceSessionId) ?? new Set()
    pendingForSource.add(pendingFork)
    this.pendingForksBySourceSession.set(sourceSessionId, pendingForSource)

    try {
      return await pendingFork
    } finally {
      pendingForSource.delete(pendingFork)
      if (pendingForSource.size === 0) {
        this.pendingForksBySourceSession.delete(sourceSessionId)
      }
    }
  }

  acquire(rootSessionId: string): SessionArchiveLease {
    const ownedSessionIds = new Set<string>()
    let released = false
    const lock = (sessionIds: readonly string[]): void => {
      const conflictingSessionId = sessionIds.find(
        (sessionId) =>
          this.archivingSessionIds.has(sessionId) &&
          !ownedSessionIds.has(sessionId),
      )
      if (conflictingSessionId) {
        throw new Error(`会话 ${conflictingSessionId} 已在其他归档操作中。`)
      }

      for (const sessionId of sessionIds) {
        this.archivingSessionIds.add(sessionId)
        ownedSessionIds.add(sessionId)
      }
    }
    lock([rootSessionId])

    return {
      lock,
      owns: (sessionId) => ownedSessionIds.has(sessionId),
      waitForPendingForks: async (sessionIds) => {
        const pendingForks = sessionIds.flatMap((sessionId) => [
          ...(this.pendingForksBySourceSession.get(sessionId) ?? []),
        ])
        await Promise.allSettled(pendingForks)
      },
      release: () => {
        if (released) return
        released = true
        for (const sessionId of ownedSessionIds) {
          this.archivingSessionIds.delete(sessionId)
        }
      },
    }
  }
}

/** 按直接父关系收集目标会话及任意深度的全部后代。 */
export function collectSessionSubtree(
  sessions: readonly AgentSessionSummary[],
  agentId: string,
  rootSessionId: string,
): AgentSessionSummary[] {
  const root = sessions.find(
    (session) =>
      session.agentId === agentId && session.sessionId === rootSessionId,
  )

  if (!root) {
    throw new Error(`找不到 Agent ${agentId} 的会话 ${rootSessionId}。`)
  }

  const subtree = [root]
  const visited = new Set([root.sessionId])

  for (let index = 0; index < subtree.length; index += 1) {
    const parent = subtree[index]
    if (!parent) continue

    for (const session of sessions) {
      if (
        session.agentId === agentId &&
        session.forkedFrom?.sessionId === parent.sessionId &&
        !visited.has(session.sessionId)
      ) {
        visited.add(session.sessionId)
        subtree.push(session)
      }
    }
  }

  return subtree
}
