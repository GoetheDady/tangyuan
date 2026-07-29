import type { AgentSessionSummary, ArchiveSessionResult } from '@tangyuan/contracts'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

interface UseSessionArchiveOptions {
  agentId: string
  selectedSession: AgentSessionSummary | null
  onSessionsChange(sessions: AgentSessionSummary[]): void
  onArchived(target: AgentSessionSummary, result: ArchiveSessionResult): void
}

export function useSessionArchive(options: UseSessionArchiveOptions): {
  archivedSessions: AgentSessionSummary[]
  archivePreview: ArchiveSessionResult | null
  isArchiving: boolean
  recoveringSessionId: string | null
  archiveSelectedSession(confirmActivityStop: boolean): Promise<void>
  recoverSession(session: AgentSessionSummary): Promise<void>
  cancelArchive(): void
} {
  const [archivedSessionState, setArchivedSessionState] = useState<{
    agentId: string
    sessions: AgentSessionSummary[]
  }>({ agentId: options.agentId, sessions: [] })
  const [archiveTarget, setArchiveTarget] = useState<AgentSessionSummary | null>(null)
  const [archivePreview, setArchivePreview] = useState<ArchiveSessionResult | null>(null)
  const [isArchiving, setIsArchiving] = useState(false)
  const [recoveringSessionId, setRecoveringSessionId] = useState<string | null>(null)
  const activeAgentIdRef = useRef(options.agentId)
  const archivedSessions =
    archivedSessionState.agentId === options.agentId ? archivedSessionState.sessions : []

  useLayoutEffect(() => {
    activeAgentIdRef.current = options.agentId
  }, [options.agentId])

  useEffect(() => {
    let isMounted = true

    void window.api
      .listSessions({ agentId: options.agentId, includeArchived: true })
      .then((sessions) => {
        if (isMounted) {
          setArchivedSessionState({
            agentId: options.agentId,
            sessions: sessions.filter((session) => session.archivedAt !== undefined)
          })
        }
      })
      .catch(() => {
        if (isMounted) {
          setArchivedSessionState({ agentId: options.agentId, sessions: [] })
        }
      })

    return () => {
      isMounted = false
    }
  }, [options.agentId])

  async function refreshSessionLists(agentId: string): Promise<boolean> {
    if (activeAgentIdRef.current !== agentId) return false

    const [sessions, allSessions] = await Promise.all([
      window.api.listSessions({ agentId }),
      window.api.listSessions({ agentId, includeArchived: true })
    ])

    if (activeAgentIdRef.current !== agentId) return false

    options.onSessionsChange(sessions)
    setArchivedSessionState({
      agentId,
      sessions: allSessions.filter((session) => session.archivedAt !== undefined)
    })
    return true
  }

  async function archiveSelectedSession(confirmActivityStop: boolean): Promise<void> {
    const target = confirmActivityStop ? archiveTarget : options.selectedSession
    if (!target) return

    setArchiveTarget(target)
    setIsArchiving(true)

    try {
      const result = await window.api.archiveSession({
        agentId: target.agentId,
        sessionId: target.sessionId,
        confirmActivityStop
      })

      if (result.status === 'confirmation-required') {
        if (activeAgentIdRef.current !== target.agentId) {
          setArchiveTarget(null)
          setArchivePreview(null)
          return
        }
        setArchivePreview(result)
        return
      }

      const isTargetAgentActive = await refreshSessionLists(target.agentId)
      if (isTargetAgentActive) {
        options.onArchived(target, result)
      }
      setArchiveTarget(null)
      setArchivePreview(null)
      toast.success('已归档会话谱系')
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : '归档会话谱系失败')
    } finally {
      setIsArchiving(false)
    }
  }

  async function recoverSession(session: AgentSessionSummary): Promise<void> {
    setRecoveringSessionId(session.sessionId)

    try {
      await window.api.recoverSession({
        agentId: session.agentId,
        sessionId: session.sessionId
      })
      await refreshSessionLists(session.agentId)
      toast.success('已恢复会话谱系')
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : '恢复会话谱系失败')
    } finally {
      setRecoveringSessionId(null)
    }
  }

  return {
    archivedSessions,
    archivePreview,
    isArchiving,
    recoveringSessionId,
    archiveSelectedSession,
    recoverSession,
    cancelArchive: () => {
      setArchiveTarget(null)
      setArchivePreview(null)
    }
  }
}
