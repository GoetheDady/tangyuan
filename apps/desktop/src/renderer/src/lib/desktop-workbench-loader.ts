import type {
  AgentSessionSummary,
  AgentSummary,
  DesktopPreloadApi,
  RuntimeSnapshot,
  TranscriptSnapshot,
} from '@yuanxiao/contracts'

/**
 * Renderer 启动快照 single-flight。
 *
 * React StrictMode 会在开发环境重复挂载 effect；这里共享同一个 Promise，避免
 * 两次启动流程并发创建两个默认会话。
 */
let desktopWorkbenchLoadPromise: ReturnType<
  typeof loadDesktopWorkbench
> | null = null

/** 返回当前进程唯一的桌面工作台启动 Promise。 */
export function loadDesktopWorkbenchOnce(
  api: DesktopPreloadApi,
): ReturnType<typeof loadDesktopWorkbench> {
  desktopWorkbenchLoadPromise ??= loadDesktopWorkbench(api)
  return desktopWorkbenchLoadPromise
}

/** 测试卸载后清空 single-flight，避免跨测试复用旧的 preload API。 */
export function resetDesktopWorkbenchLoadForTest(): void {
  desktopWorkbenchLoadPromise = null
}

/**
 * 在运行时就绪后加载会话数据：优先恢复上次激活会话；没有记录时创建新会话。
 */
export async function loadSessionsForReadyRuntime(
  api: DesktopPreloadApi,
  runtime: RuntimeSnapshot,
): Promise<{
  sessions: AgentSessionSummary[]
  archivedSessions: AgentSessionSummary[]
  activeSession: AgentSessionSummary
  transcript: TranscriptSnapshot | null
}> {
  const lastActiveSession = await api.getLastActiveSession()
  const activeAgentId =
    lastActiveSession?.agentId ?? runtime.activeAgent.agentId
  // 一次 includeArchived 查询同时取活跃与归档列表，按归档状态分片。
  const allSessions = await api.listSessions({
    agentId: activeAgentId,
    includeArchived: true,
  })
  const archivedSessions = allSessions.filter(
    (session) => session.archivedAt !== undefined,
  )
  let nextSessions = allSessions.filter(
    (session) => session.archivedAt === undefined,
  )
  let activeSession: AgentSessionSummary | null = null
  let transcript: TranscriptSnapshot | null = null

  if (lastActiveSession) {
    const preferredSession = nextSessions.find(
      (session) => session.sessionId === lastActiveSession.sessionId,
    )
    const candidates = [
      ...(preferredSession ? [preferredSession] : []),
      ...nextSessions.filter(
        (session) => session.sessionId !== preferredSession?.sessionId,
      ),
    ]

    for (const candidate of candidates) {
      if (candidate.lineageUnavailable) continue

      try {
        transcript = await api.getTranscript({
          agentId: candidate.agentId,
          sessionId: candidate.sessionId,
        })
        activeSession = candidate
        break
      } catch {
        // 会话可能在 Runtime 校验后被移除或损坏，继续尝试下一个候选。
      }
    }
  }

  if (!activeSession) {
    activeSession = await api.createSession({
      agentId: activeAgentId,
      title: runtime.activeAgent.profile.bootstrapRequired
        ? 'Bootstrap 初始化'
        : '新会话',
    })
    nextSessions = [
      activeSession,
      ...nextSessions.filter(
        (session) => session.sessionId !== activeSession!.sessionId,
      ),
    ]
    transcript = await api.getTranscript({
      agentId: activeSession.agentId,
      sessionId: activeSession.sessionId,
    })
  }

  if (
    lastActiveSession?.agentId !== activeSession.agentId ||
    lastActiveSession.sessionId !== activeSession.sessionId
  ) {
    await api.setLastActiveSession({
      agentId: activeSession.agentId,
      sessionId: activeSession.sessionId,
    })
  }

  return {
    sessions: nextSessions,
    archivedSessions,
    activeSession,
    transcript,
  }
}

/** 并行读取 Renderer 首屏需要的运行时和会话数据。 */
export async function loadDesktopWorkbench(api: DesktopPreloadApi): Promise<{
  runtime: RuntimeSnapshot
  agents: AgentSummary[]
  sessions: AgentSessionSummary[]
  archivedSessions: AgentSessionSummary[]
  activeSession: AgentSessionSummary | null
  transcript: TranscriptSnapshot | null
  sessionLoadError: string | null
}> {
  const runtime = await api.getRuntimeSnapshot()
  const agents = runtime.agents

  if (runtime.status !== 'ready') {
    return {
      runtime,
      agents,
      sessions: [],
      archivedSessions: [],
      activeSession: null,
      transcript: null,
      sessionLoadError: null,
    }
  }

  try {
    const { sessions, archivedSessions, activeSession, transcript } =
      await loadSessionsForReadyRuntime(api, runtime)
    return {
      runtime,
      agents,
      sessions,
      archivedSessions,
      activeSession,
      transcript,
      sessionLoadError: null,
    }
  } catch (error) {
    return {
      runtime,
      agents,
      sessions: [],
      archivedSessions: [],
      activeSession: null,
      transcript: null,
      sessionLoadError:
        error instanceof Error ? error.message : '无法恢复本地会话',
    }
  }
}
