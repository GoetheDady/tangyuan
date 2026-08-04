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
      await api.resumeSession()
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
