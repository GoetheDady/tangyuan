import type {
  AgentSessionSummary,
  ArchiveSessionResult,
  DeleteSessionResult,
} from '@yuanxiao/contracts'
import { useLayoutEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

interface UseSessionArchiveOptions {
  agentId: string
  selectedSession: AgentSessionSummary | null
  /** 归档/删除/恢复后按 Agent 刷新会话列表（含已归档，由调用方分片入 store）。 */
  onListsRefreshed(agentId: string, allSessions: AgentSessionSummary[]): void
  onArchived(target: AgentSessionSummary, result: ArchiveSessionResult): void
  onDeleted(target: AgentSessionSummary, result: DeleteSessionResult): void
}

export function useSessionArchive(options: UseSessionArchiveOptions): {
  archivePreview: ArchiveSessionResult | null
  deletePreview: DeleteSessionResult | null
  isArchiving: boolean
  isDeleting: boolean
  isDeleteDialogOpen: boolean
  recoveringSessionId: string | null
  archiveSelectedSession(confirmActivityStop: boolean): Promise<void>
  requestDeleteSelectedSession(): void
  deleteSelectedSession(confirmActivityStop: boolean): Promise<void>
  recoverSession(session: AgentSessionSummary): Promise<void>
  cancelArchive(): void
  cancelDelete(): void
} {
  const [archiveTarget, setArchiveTarget] =
    useState<AgentSessionSummary | null>(null)
  const [archivePreview, setArchivePreview] =
    useState<ArchiveSessionResult | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AgentSessionSummary | null>(
    null,
  )
  const [deletePreview, setDeletePreview] =
    useState<DeleteSessionResult | null>(null)
  const [isArchiving, setIsArchiving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [recoveringSessionId, setRecoveringSessionId] = useState<string | null>(
    null,
  )
  const activeAgentIdRef = useRef(options.agentId)

  useLayoutEffect(() => {
    activeAgentIdRef.current = options.agentId
  }, [options.agentId])

  async function refreshSessionLists(agentId: string): Promise<boolean> {
    if (activeAgentIdRef.current !== agentId) return false

    const allSessions = await window.api.listSessions({
      agentId,
      includeArchived: true,
    })

    if (activeAgentIdRef.current !== agentId) return false

    options.onListsRefreshed(agentId, allSessions)
    return true
  }

  async function archiveSelectedSession(
    confirmActivityStop: boolean,
  ): Promise<void> {
    const target = confirmActivityStop ? archiveTarget : options.selectedSession
    if (!target) return

    setArchiveTarget(target)
    setIsArchiving(true)

    try {
      const result = await window.api.archiveSession({
        agentId: target.agentId,
        sessionId: target.sessionId,
        confirmActivityStop,
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
        sessionId: session.sessionId,
      })
      await refreshSessionLists(session.agentId)
      toast.success('已恢复会话谱系')
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : '恢复会话谱系失败')
    } finally {
      setRecoveringSessionId(null)
    }
  }

  async function deleteSelectedSession(
    confirmActivityStop: boolean,
  ): Promise<void> {
    const target = deleteTarget
    if (!target) return

    setIsDeleting(true)

    try {
      const result = await window.api.deleteSession({
        agentId: target.agentId,
        sessionId: target.sessionId,
        confirmActivityStop,
      })

      if (result.status === 'confirmation-required') {
        if (activeAgentIdRef.current !== target.agentId) {
          setDeleteTarget(null)
          setDeletePreview(null)
          return
        }
        setDeletePreview(result)
        return
      }

      const isTargetAgentActive = await refreshSessionLists(target.agentId)
      if (isTargetAgentActive) {
        options.onDeleted(target, result)
      }
      setDeleteTarget(null)
      setDeletePreview(null)
      toast.success('已永久删除会话谱系')
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : '删除会话谱系失败')
    } finally {
      setIsDeleting(false)
    }
  }

  return {
    archivePreview,
    deletePreview,
    isArchiving,
    isDeleting,
    isDeleteDialogOpen: deleteTarget !== null,
    recoveringSessionId,
    archiveSelectedSession,
    requestDeleteSelectedSession: () => {
      if (!options.selectedSession) return
      setDeleteTarget(options.selectedSession)
      setDeletePreview(null)
    },
    deleteSelectedSession,
    recoverSession,
    cancelArchive: () => {
      setArchiveTarget(null)
      setArchivePreview(null)
    },
    cancelDelete: () => {
      setDeleteTarget(null)
      setDeletePreview(null)
    },
  }
}
