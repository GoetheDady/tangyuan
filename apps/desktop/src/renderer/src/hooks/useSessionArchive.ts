import type { AgentSessionSummary, DeleteSessionResult } from '@yuanxiao/contracts'
import { useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import type { WorkbenchStoreApi } from '../stores/workbench-store'

interface UseSessionArchiveOptions {
  agentId: string
  /** 当前正在查看的会话标识；归档或删除该会话后会导航离开。 */
  selectedSessionId: string | null
  store: WorkbenchStoreApi
}

/**
 * 在删除或归档目标谱系后，从剩余会话中按优先级选出下一个导航目标：
 * 兄弟会话 → 父会话 → 任意剩余会话 → null（新建会话）
 */
function pickNextSession(
  target: AgentSessionSummary,
  remaining: AgentSessionSummary[],
): AgentSessionSummary | null {
  const parentSessionId = target.forkedFrom?.sessionId

  if (parentSessionId) {
    // 兄弟：有相同父会话且不是目标本身
    const sibling = remaining.find(
      (s) =>
        s.forkedFrom?.sessionId === parentSessionId &&
        s.sessionId !== target.sessionId,
    )
    if (sibling) return sibling

    // 父会话
    const parent = remaining.find((s) => s.sessionId === parentSessionId)
    if (parent) return parent
  } else {
    // 目标是根会话 — 同级的另一根会话
    const sibling = remaining.find(
      (s) => !s.forkedFrom && s.sessionId !== target.sessionId,
    )
    if (sibling) return sibling
  }

  return remaining[0] ?? null
}

export function useSessionArchive(options: UseSessionArchiveOptions): {
  deletePreview: DeleteSessionResult | null
  isArchiving: boolean
  isDeleting: boolean
  isDeleteDialogOpen: boolean
  recoveringSessionId: string | null
  archiveSession(session: AgentSessionSummary): Promise<void>
  requestDeleteSession(session: AgentSessionSummary): void
  /** 执行删除；confirmActivityStop=true 时先停止活动。 */
  deleteSession(confirmActivityStop: boolean): Promise<void>
  recoverSession(session: AgentSessionSummary): Promise<void>
  cancelDelete(): void
} {
  const navigate = useNavigate()
  const [deleteTarget, setDeleteTarget] = useState<AgentSessionSummary | null>(null)
  const [deletePreview, setDeletePreview] = useState<DeleteSessionResult | null>(null)
  const [isArchiving, setIsArchiving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [recoveringSessionId, setRecoveringSessionId] = useState<string | null>(null)
  const activeAgentIdRef = useRef(options.agentId)
  const selectedSessionIdRef = useRef(options.selectedSessionId)

  useLayoutEffect(() => {
    activeAgentIdRef.current = options.agentId
  }, [options.agentId])

  useLayoutEffect(() => {
    selectedSessionIdRef.current = options.selectedSessionId
  }, [options.selectedSessionId])

  async function refreshSessionLists(agentId: string): Promise<AgentSessionSummary[]> {
    return window.api.listSessions({ agentId, includeArchived: true })
  }

  /**
   * 归档或删除后，若目标是当前查看的会话，按
   * 兄弟 → 父 → 任意剩余 → 新建 优先级导航离开。
   */
  function navigateAwayIfSelected(
    targetAgentId: string,
    target: AgentSessionSummary,
    allSessions: AgentSessionSummary[],
    affectedSessionIds: string[],
  ): void {
    if (activeAgentIdRef.current !== targetAgentId) return
    if (selectedSessionIdRef.current !== target.sessionId) return

    const remaining = allSessions.filter(
      (s) => !affectedSessionIds.includes(s.sessionId) && !s.archivedAt,
    )
    const next = pickNextSession(target, remaining)
    if (next) {
      navigate(`/chat/${targetAgentId}/${next.sessionId}`, { replace: true })
    } else {
      navigate(`/chat/${targetAgentId}`, { replace: true })
    }
  }

  async function archiveSession(session: AgentSessionSummary): Promise<void> {
    setIsArchiving(true)

    try {
      const result = await window.api.archiveSession({
        agentId: session.agentId,
        sessionId: session.sessionId,
        confirmActivityStop: false,
      })

      if (result.status === 'confirmation-required') {
        // UI が活動中は選択肢を無効化するので、競合条件の場合のみここに到達。
        toast.error('有活动任务，请先停止后再归档')
        return
      }

      const allSessions = await refreshSessionLists(session.agentId)
      options.store.getState().removeSessionLineage({
        agentId: session.agentId,
        allSessions,
        affectedSessionIds: result.affectedSessionIds,
      })
      navigateAwayIfSelected(session.agentId, session, allSessions, result.affectedSessionIds)
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
      options.store
        .getState()
        .replaceSessionCatalog(
          session.agentId,
          await refreshSessionLists(session.agentId),
        )
      toast.success('已恢复会话谱系')
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : '恢复会话谱系失败')
    } finally {
      setRecoveringSessionId(null)
    }
  }

  async function deleteSession(confirmActivityStop: boolean): Promise<void> {
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

      const allSessions = await refreshSessionLists(target.agentId)
      options.store.getState().removeSessionLineage({
        agentId: target.agentId,
        allSessions,
        affectedSessionIds: result.affectedSessionIds,
      })
      navigateAwayIfSelected(target.agentId, target, allSessions, result.affectedSessionIds)
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
    deletePreview,
    isArchiving,
    isDeleting,
    isDeleteDialogOpen: deleteTarget !== null,
    recoveringSessionId,
    archiveSession,
    requestDeleteSession: (session: AgentSessionSummary) => {
      setDeleteTarget(session)
      setDeletePreview(null)
    },
    deleteSession,
    recoverSession,
    cancelDelete: () => {
      setDeleteTarget(null)
      setDeletePreview(null)
    },
  }
}
