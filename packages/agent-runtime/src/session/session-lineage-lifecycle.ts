import type {
  AgentSessionSummary,
  ArchiveSessionRequest,
  ArchiveSessionResult,
  CancelRunRequest,
  DeleteSessionRequest,
  DeleteSessionResult,
  RecoverSessionRequest,
  SessionLineageActivity,
  SessionLineageActivityKind,
} from '@yuanxiao/contracts'
import type {
  RunAdmissionGate,
  SessionMutationLease,
} from '../runtime/run-admission-gate'
import type { SessionModule } from '../runtime/runtime-modules'
import type { LastActiveSessionStore } from './last-active-session-store'
import type { SessionDirectory } from './session-directory'
import type { TranscriptEmitter } from './transcript-emitter'

interface SessionLineageLifecycleDependencies {
  sessions: Pick<
    SessionModule,
    'setSessionsArchived' | 'deleteSessions'
  >
  directory: Pick<SessionDirectory, 'refresh' | 'remove'>
  admission: Pick<
    RunAdmissionGate,
    | 'acquireMutation'
    | 'assertAvailable'
    | 'trackFork'
    | 'waitForRunStart'
    | 'isRunStarting'
  >
  transcriptEmitter: Pick<TranscriptEmitter, 'deleteSession'>
  lastActiveSessionStore: Pick<LastActiveSessionStore, 'read' | 'clear'>
  cancelRun(request: CancelRunRequest): Promise<AgentSessionSummary>
  pendingApprovalSessionIds(): readonly string[]
  pendingClarificationSessionIds(): readonly string[]
  now(): string
}

interface PreparedLineageMutation {
  lease: SessionMutationLease
  subtree: AgentSessionSummary[]
  affectedSessionIds: string[]
  affectedActivities: SessionLineageActivity[]
}

/**
 * 会话谱系生命周期：集中归档、恢复、删除与并发分叉之间的完整协议。
 */
export class SessionLineageLifecycle {
  private readonly dependencies: SessionLineageLifecycleDependencies

  constructor(dependencies: SessionLineageLifecycleDependencies) {
    this.dependencies = dependencies
  }

  assertAvailable(sessionId: string): void {
    this.dependencies.admission.assertAvailable(sessionId)
  }

  async trackFork<T>(
    sourceSessionId: string,
    pendingFork: Promise<T>,
  ): Promise<T> {
    return this.dependencies.admission.trackFork(sourceSessionId, pendingFork)
  }

  async archive(
    request: ArchiveSessionRequest,
  ): Promise<ArchiveSessionResult> {
    const prepared = await this.prepareMutation(request)
    try {
      if (
        prepared.affectedActivities.length > 0 &&
        !request.confirmActivityStop
      ) {
        return this.confirmationRequired(prepared)
      }

      await this.stopCurrentActivities(request, prepared)
      await this.dependencies.sessions.setSessionsArchived(
        prepared.affectedSessionIds,
        this.dependencies.now(),
      )
      await this.dependencies.directory.refresh(request.agentId)
      return {
        status: 'archived',
        affectedSessionIds: prepared.affectedSessionIds,
        affectedActivities: prepared.affectedActivities,
      }
    } finally {
      this.finishMutation(prepared.lease)
    }
  }

  async recover(
    request: RecoverSessionRequest,
  ): Promise<AgentSessionSummary[]> {
    const sessions = await this.dependencies.directory.refresh(
      request.agentId,
      true,
    )
    const subtree = collectSessionSubtree(
      sessions,
      request.agentId,
      request.sessionId,
    )
    const recovered = await this.dependencies.sessions.setSessionsArchived(
      subtree.map((session) => session.sessionId),
      null,
    )
    await this.dependencies.directory.refresh(request.agentId)
    return recovered
  }

  async delete(request: DeleteSessionRequest): Promise<DeleteSessionResult> {
    const prepared = await this.prepareMutation(request)
    try {
      if (
        prepared.affectedActivities.length > 0 &&
        !request.confirmActivityStop
      ) {
        return {
          status: 'confirmation-required',
          affectedSessionIds: prepared.affectedSessionIds,
          affectedActivities: prepared.affectedActivities,
        }
      }

      await this.stopCurrentActivities(request, prepared)
      await this.dependencies.sessions.deleteSessions(
        prepared.affectedSessionIds,
      )

      const lastActive = await this.dependencies.lastActiveSessionStore.read()
      if (
        lastActive &&
        prepared.affectedSessionIds.includes(lastActive.sessionId)
      ) {
        await this.dependencies.lastActiveSessionStore.clear()
      }

      for (const sessionId of prepared.affectedSessionIds) {
        this.dependencies.directory.remove(sessionId)
        this.dependencies.transcriptEmitter.deleteSession(sessionId)
      }

      return {
        status: 'deleted',
        affectedSessionIds: prepared.affectedSessionIds,
        affectedActivities: prepared.affectedActivities,
      }
    } finally {
      this.finishMutation(prepared.lease)
    }
  }

  private async prepareMutation(request: {
    agentId: string
    sessionId: string
  }): Promise<PreparedLineageMutation> {
    const lease = this.dependencies.admission.acquireMutation(
      request.sessionId,
    )
    try {
      let subtree: AgentSessionSummary[] = []
      while (true) {
        const sessions = await this.dependencies.directory.refresh(
          request.agentId,
          true,
        )
        subtree = collectSessionSubtree(
          sessions,
          request.agentId,
          request.sessionId,
        )
        const sessionIds = subtree.map((session) => session.sessionId)
        lease.lock(sessionIds)
        await lease.waitForPendingForks(sessionIds)

        const refreshedSessions = await this.dependencies.directory.refresh(
          request.agentId,
          true,
        )
        const refreshedSubtree = collectSessionSubtree(
          refreshedSessions,
          request.agentId,
          request.sessionId,
        )
        subtree = refreshedSubtree
        if (refreshedSubtree.every((session) => lease.owns(session.sessionId))) {
          break
        }
      }

      return {
        lease,
        subtree,
        affectedSessionIds: subtree.map((session) => session.sessionId),
        affectedActivities: this.collectActivities(subtree),
      }
    } catch (error) {
      lease.release()
      throw error
    }
  }

  private async stopCurrentActivities(
    request: { agentId: string; sessionId: string },
    prepared: PreparedLineageMutation,
  ): Promise<void> {
    await Promise.all(
      prepared.affectedSessionIds.map((sessionId) =>
        this.dependencies.admission.waitForRunStart(sessionId),
      ),
    )
    const currentSessions = await this.dependencies.directory.refresh(
      request.agentId,
      true,
    )
    const currentSubtree = collectSessionSubtree(
      currentSessions,
      request.agentId,
      request.sessionId,
    )
    const activities = this.collectActivities(currentSubtree).sort(
      (left, right) =>
        Number(right.kinds.includes('queued')) -
        Number(left.kinds.includes('queued')),
    )
    for (const activity of activities) {
      await this.dependencies.cancelRun({
        agentId: request.agentId,
        sessionId: activity.sessionId,
      })
    }
  }

  private collectActivities(
    sessions: readonly AgentSessionSummary[],
  ): SessionLineageActivity[] {
    const approvalSessionIds = new Set(
      this.dependencies.pendingApprovalSessionIds(),
    )
    const clarificationSessionIds = new Set(
      this.dependencies.pendingClarificationSessionIds(),
    )

    return sessions.flatMap((session) => {
      const kinds: SessionLineageActivityKind[] = []
      if (
        session.state === 'running' ||
        this.dependencies.admission.isRunStarting(session.sessionId)
      ) {
        kinds.push('running')
      }
      if (session.state === 'queued') kinds.push('queued')
      if (approvalSessionIds.has(session.sessionId)) {
        kinds.push('pending-approval')
      }
      if (clarificationSessionIds.has(session.sessionId)) {
        kinds.push('pending-clarification')
      }

      return kinds.length > 0
        ? [{ sessionId: session.sessionId, title: session.title, kinds }]
        : []
    })
  }

  private confirmationRequired(
    prepared: PreparedLineageMutation,
  ): ArchiveSessionResult {
    return {
      status: 'confirmation-required',
      affectedSessionIds: prepared.affectedSessionIds,
      affectedActivities: prepared.affectedActivities,
    }
  }

  private finishMutation(lease: SessionMutationLease): void {
    lease.release()
  }
}

/** 按直接父关系收集目标会话及任意深度的全部后代。 */
function collectSessionSubtree(
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
