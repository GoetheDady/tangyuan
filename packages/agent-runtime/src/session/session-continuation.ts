import {
  YUANXIAO_DEFAULT_AGENT_ID,
  type AgentSessionSummary,
  type LastActiveSession,
  type RuntimeSnapshot,
  type SessionResumeSnapshot,
  type SetLastActiveSessionRequest,
  type TranscriptSnapshot,
} from '@yuanxiao/contracts'
import { AgentRuntimeError } from '../core'
import type { SessionModule } from '../runtime/runtime-modules'
import type { RuntimeSnapshotStore } from '../runtime/runtime-snapshot-store'
import type { LastActiveSessionStore } from './last-active-session-store'
import type { SessionDirectory } from './session-directory'

interface SessionContinuationDependencies {
  sessions: Pick<SessionModule, 'createSession'>
  directory: Pick<SessionDirectory, 'refresh' | 'upsert'>
  snapshotStore: Pick<RuntimeSnapshotStore, 'getOrLoad'>
  lastActiveSessionStore: Pick<
    LastActiveSessionStore,
    'read' | 'write' | 'clear'
  >
  getTranscript(request: {
    agentId: string
    sessionId: string
  }): Promise<TranscriptSnapshot>
}

interface ResolvedContinuation {
  record: LastActiveSession | null
  sessions: AgentSessionSummary[]
  archivedSessions: AgentSessionSummary[]
  activeSession: AgentSessionSummary | null
  transcript: TranscriptSnapshot | null
}

/** 集中承载最后激活会话的校验、回退、续接与持久化策略。 */
export class SessionContinuation {
  private readonly sessions: SessionContinuationDependencies['sessions']
  private readonly directory: SessionContinuationDependencies['directory']
  private readonly snapshotStore: SessionContinuationDependencies['snapshotStore']
  private readonly lastActiveSessionStore: SessionContinuationDependencies['lastActiveSessionStore']
  private readonly getTranscript: SessionContinuationDependencies['getTranscript']

  constructor(dependencies: SessionContinuationDependencies) {
    this.sessions = dependencies.sessions
    this.directory = dependencies.directory
    this.snapshotStore = dependencies.snapshotStore
    this.lastActiveSessionStore = dependencies.lastActiveSessionStore
    this.getTranscript = dependencies.getTranscript
  }

  async resume(): Promise<SessionResumeSnapshot> {
    const snapshot = await this.snapshotStore.getOrLoad()
    this.assertReady(snapshot)
    const resolved = await this.resolve(snapshot)

    let { sessions, activeSession, transcript } = resolved
    if (!activeSession || !transcript) {
      activeSession = await this.sessions.createSession({
        agentId: YUANXIAO_DEFAULT_AGENT_ID,
        title: snapshot.activeAgent.profile.bootstrapRequired
          ? 'Bootstrap 初始化'
          : '新会话',
      })
      this.directory.upsert(activeSession)
      sessions = [
        activeSession,
        ...sessions.filter(
          (session) => session.sessionId !== activeSession?.sessionId,
        ),
      ]
      transcript = await this.getTranscript({
        agentId: activeSession.agentId,
        sessionId: activeSession.sessionId,
      })
    }

    await this.persistSelection(resolved.record, activeSession)
    return {
      sessions,
      archivedSessions: resolved.archivedSessions,
      activeSession,
      transcript,
    }
  }

  async setLastActive(
    request: SetLastActiveSessionRequest,
  ): Promise<LastActiveSession | null> {
    const snapshot = await this.snapshotStore.getOrLoad()
    const agent = snapshot.agents.find(
      (candidate) => candidate.agentId === request.agentId,
    )
    if (!agent || agent.status !== 'active') return null

    const sessions = await this.directory.refresh(request.agentId)
    const isAvailable = sessions.some(
      (session) => session.sessionId === request.sessionId,
    )
    return isAvailable ? this.lastActiveSessionStore.write(request) : null
  }

  private async resolve(
    snapshot: RuntimeSnapshot,
  ): Promise<ResolvedContinuation> {
    const record = await this.lastActiveSessionStore.read()
    const recordedAgent = record
      ? snapshot.agents.find((agent) => agent.agentId === record.agentId)
      : undefined

    if (record && recordedAgent?.status === 'active') {
      const recorded = await this.resolveForAgent(
        record.agentId,
        record.sessionId,
        record.agentId === YUANXIAO_DEFAULT_AGENT_ID,
      )
      if (recorded.activeSession) return { record, ...recorded }
    }

    const fallback = await this.resolveForAgent(
      YUANXIAO_DEFAULT_AGENT_ID,
      record?.agentId === YUANXIAO_DEFAULT_AGENT_ID
        ? record.sessionId
        : undefined,
    )
    return { record, ...fallback }
  }

  private async resolveForAgent(
    agentId: string,
    preferredSessionId?: string,
    includeAlternateSessions = true,
  ): Promise<Omit<ResolvedContinuation, 'record'>> {
    const allSessions = await this.directory.refresh(agentId, true)
    const sessions = allSessions.filter(
      (session) => session.archivedAt === undefined,
    )
    const archivedSessions = allSessions.filter(
      (session) => session.archivedAt !== undefined,
    )
    const preferred = preferredSessionId
      ? sessions.find((session) => session.sessionId === preferredSessionId)
      : undefined
    const candidates = [
      ...(preferred ? [preferred] : []),
      ...(includeAlternateSessions
        ? sessions.filter(
            (session) => session.sessionId !== preferred?.sessionId,
          )
        : []),
    ]

    for (const candidate of candidates) {
      if (candidate.lineageUnavailable) continue
      try {
        const transcript = await this.getTranscript({
          agentId: candidate.agentId,
          sessionId: candidate.sessionId,
        })
        return { sessions, archivedSessions, activeSession: candidate, transcript }
      } catch {
        // 会话可能在目录刷新后损坏或被移除，继续尝试下一个候选。
      }
    }

    return { sessions, archivedSessions, activeSession: null, transcript: null }
  }

  private async persistSelection(
    record: LastActiveSession | null,
    session: AgentSessionSummary,
  ): Promise<LastActiveSession> {
    if (
      record?.agentId === session.agentId &&
      record.sessionId === session.sessionId
    ) {
      return record
    }
    return this.lastActiveSessionStore.write({
      agentId: session.agentId,
      sessionId: session.sessionId,
    })
  }

  private assertReady(snapshot: RuntimeSnapshot): void {
    if (snapshot.status === 'ready') return

    const corrupted =
      snapshot.configRecovery.state === 'corrupted' ||
      snapshot.configRecovery.state === 'migration-failed'
    throw new AgentRuntimeError({
      code: 'configuration-missing',
      message: corrupted
        ? '配置文件已损坏，请先恢复或重置配置。'
        : '发送消息前，请先配置 Provider（模型服务）、Model（模型）和 API Key（接口密钥）。',
      recoverable: true,
    })
  }
}
