import type {
  AgentSessionSummary,
  AgentSummary,
  BashApprovalRequest,
  ModelDescriptor,
  QuestionClarificationRequest,
  SessionModelInfo,
} from '@yuanxiao/contracts'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { useStore } from 'zustand'

import { ChatSidebar } from '@/components/ChatSidebar'
import { ConversationArea } from '@/components/ConversationArea'
import {
  SessionArchiveDialog,
  SessionDeleteDialog,
} from '@/components/SessionArchiveControls'
import { useSessionArchive } from '@/hooks/useSessionArchive'
import type { WorkbenchStoreApi } from '@/stores/workbench-store'

/** 未加载时的稳定空列表，避免 selector 每次返回新引用引发重渲染循环。 */
const EMPTY_SESSIONS: AgentSessionSummary[] = []
const EMPTY_APPROVALS: BashApprovalRequest[] = []
const EMPTY_CLARIFICATIONS: QuestionClarificationRequest[] = []

/**
 * 聊天页路由守卫：运行时未就绪时重定向到控制台。
 *
 * @param props - 工作台 store。
 * @returns 聊天页、控制台重定向或加载态。
 * @throws 此组件不会主动抛出错误。
 */
export function ChatGuard(props: {
  store: WorkbenchStoreApi
}): React.JSX.Element {
  const { agentId } = useParams<{ agentId: string; sessionId: string }>()
  const isLoading = useStore(props.store, (state) => state.isInitializing)
  const runtime = useStore(props.store, (state) => state.runtime)

  if (isLoading) {
    return <LoadingScreen />
  }

  if (runtime?.status !== 'ready') {
    const redirectTarget = agentId ? `/chat/${agentId}` : '/chat/yuanxiao'
    return (
      <Navigate
        to={`/setup?redirect=${encodeURIComponent(redirectTarget)}`}
        replace
      />
    )
  }

  return <ChatPage store={props.store} />
}

/**
 * 渲染大语言模型对话主界面。
 *
 * 当前显示的 Agent 与 session 由路由参数决定：组件只按 URL 中的
 * agentId/sessionId 用细粒度 selector 读取 store 中的会话与消息数据。
 *
 * @param props - 工作台 store。
 * @returns 聊天主界面组件树。
 * @throws 此组件不会主动抛出错误；交互错误会通过 toast 反馈。
 */
function ChatPage(props: { store: WorkbenchStoreApi }): React.JSX.Element {
  const { store } = props
  const { agentId, sessionId } = useParams<{
    agentId: string
    sessionId: string
  }>()
  const navigate = useNavigate()
  const runtime = useStore(store, (state) => state.runtime)
  const agents = useStore(store, (state) => state.agents)
  const composerText = useStore(store, (state) => state.composerDraft)
  const updateComposerDraft = useStore(
    store,
    (state) => state.updateComposerDraft,
  )
  const allowCommandForProcess = useStore(
    store,
    (state) => state.allowCommandForProcess,
  )
  const openTranscript = useStore(store, (state) => state.openTranscript)
  const replaceAgentSessions = useStore(
    store,
    (state) => state.replaceAgentSessions,
  )
  const clearSessionRequests = useStore(
    store,
    (state) => state.clearSessionRequests,
  )
  const beginSending = useStore(store, (state) => state.beginSending)
  const finishSending = useStore(store, (state) => state.finishSending)
  const activeAgentId = agentId ?? runtime?.activeAgent.agentId ?? 'yuanxiao'

  const sessions = useStore(
    store,
    (state) =>
      (activeAgentId ? state.sessionsByAgentId[activeAgentId] : undefined) ??
      EMPTY_SESSIONS,
  )
  const hasLoadedAgentSessions = useStore(store, (state) =>
    activeAgentId
      ? Object.prototype.hasOwnProperty.call(
          state.sessionsByAgentId,
          activeAgentId,
        )
      : true,
  )
  const transcript = useStore(store, (state) =>
    sessionId ? (state.transcriptsBySessionId[sessionId] ?? null) : null,
  )
  const isSendingMessage = useStore(store, (state) =>
    sessionId ? (state.sendingBySessionId[sessionId] ?? false) : false,
  )
  const sessionPendingApprovals = useStore(store, (state) =>
    sessionId
      ? (state.pendingApprovalsBySessionId[sessionId] ?? EMPTY_APPROVALS)
      : EMPTY_APPROVALS,
  )
  const sessionPendingClarifications = useStore(store, (state) =>
    sessionId
      ? (state.pendingClarificationsBySessionId[sessionId] ??
        EMPTY_CLARIFICATIONS)
      : EMPTY_CLARIFICATIONS,
  )
  const pendingApprovalSessionIds = useStore(
    store,
    (state) => state.pendingApprovalSessionIds,
  )

  const activeAgent = useMemo(
    () =>
      agents.find((agent) => agent.agentId === activeAgentId) ??
      runtime?.activeAgent,
    [agents, activeAgentId, runtime?.activeAgent],
  )
  const activeAgentDisplayName =
    'displayName' in (activeAgent ?? {})
      ? (activeAgent as AgentSummary).displayName
      : ((activeAgent as { displayName?: string })?.displayName ?? '元宵')

  // 当 URL 中无 agentId 时补充默认值
  useEffect(() => {
    if (!agentId) {
      navigate(`/chat/${activeAgentId}${sessionId ? `/${sessionId}` : ''}`, {
        replace: true,
      })
    }
  }, [agentId, activeAgentId, sessionId, navigate])

  const [sessionModelInfo, setSessionModelInfo] =
    useState<SessionModelInfo | null>(null)
  const [isLoadingModelInfo, setIsLoadingModelInfo] = useState(false)
  const [isSwitchingModel, setIsSwitchingModel] = useState(false)
  const [cancellingSessionId, setCancellingSessionId] = useState<string | null>(
    null,
  )
  const openSessionRequestIdRef = useRef(0)
  const persistLastActiveSessionQueueRef = useRef<Promise<void>>(
    Promise.resolve(),
  )
  /** 跳转后需要在父会话中定位的分叉来源消息标识。 */
  const [forkSourceMessageId, setForkSourceMessageId] = useState<string | null>(
    null,
  )

  // 当 URL 中的 session 变化时加载模型信息
  useEffect(() => {
    if (!sessionId || !activeAgentId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 依赖变化时同步重置状态是预期行为
      setSessionModelInfo(null)
      return
    }

    setIsLoadingModelInfo(true)

    void window.api
      .getSessionModelInfo({
        agentId: activeAgentId,
        sessionId,
      })
      .then((info) => {
        setSessionModelInfo(info)
      })
      .catch(() => {
        // 模型信息不可用时静默处理
        setSessionModelInfo(null)
      })
      .finally(() => {
        setIsLoadingModelInfo(false)
      })
  }, [sessionId, activeAgentId])

  // 当前 Agent 的会话列表尚未加载时按需读取；结果按 Agent 落盘，互不覆盖。
  useEffect(() => {
    if (hasLoadedAgentSessions) return

    void window.api
      .listSessions({ agentId: activeAgentId })
      .then((nextSessions) => {
        store.getState().replaceAgentSessions(activeAgentId, nextSessions)
      })
      .catch((error: unknown) => {
        toast.error(
          error instanceof Error ? error.message : '加载 Agent 会话失败',
        )
      })
    // 只在首次进入或 Agent 切换时触发一次；由 hasLoadedAgentSessions 收敛。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAgentId, hasLoadedAgentSessions])

  // URL sessionId 是当前显示会话的事实来源：每次路由变化都按需读取
  // transcript 并持久化最后激活会话，且只接纳最后一次请求的结果，
  // 避免快速切换时旧结果覆盖新会话。
  useEffect(() => {
    if (!sessionId || !activeAgentId) return

    const requestId = ++openSessionRequestIdRef.current
    void window.api
      .getTranscript({ agentId: activeAgentId, sessionId })
      .then((nextTranscript) => {
        if (requestId !== openSessionRequestIdRef.current) return

        store.getState().openTranscript(nextTranscript)
        void persistLastActiveSession(activeAgentId, sessionId)
      })
      .catch((error) => {
        if (requestId !== openSessionRequestIdRef.current) return

        toast.error(error instanceof Error ? error.message : '读取会话消息失败')
      })
    // 路由变化即会话切换；每次切换都重新读取最新 transcript。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, activeAgentId])

  const selectableModels = useMemo<ModelDescriptor[]>(() => {
    if (!runtime) return []

    return runtime.models.filter(
      (model) =>
        runtime.configuredProviders[model.providerId]?.configured === true,
    )
  }, [runtime])

  async function handleSessionModelChange(
    providerId: string,
    modelId: string,
  ): Promise<void> {
    if (!sessionId || !activeAgentId) return

    setIsSwitchingModel(true)

    try {
      const info = await window.api.setSessionModel({
        agentId: activeAgentId,
        sessionId,
        providerId,
        modelId,
      })
      setSessionModelInfo(info)
      toast.success(`已切换到 ${info.displayName}`)
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : '切换模型失败')
    } finally {
      setIsSwitchingModel(false)
    }
  }

  async function handleThinkingLevelChange(level: string): Promise<void> {
    if (!sessionId || !activeAgentId) return

    try {
      const info = await window.api.setSessionThinkingLevel({
        agentId: activeAgentId,
        sessionId,
        level,
      })
      setSessionModelInfo(info)
      toast.success(`已切换到 Thinking Level: ${level}`)
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : '切换 Thinking Level 失败',
      )
    }
  }

  const selectedSession = useMemo(() => {
    if (sessionId) {
      return sessions.find((session) => session.sessionId === sessionId) ?? null
    }
    return sessions[0] ?? null
  }, [sessions, sessionId])
  const isSelectedSessionRunning = selectedSession?.state === 'running'
  const isCancellingSelectedSession =
    cancellingSessionId === selectedSession?.sessionId
  // 响应等待提示信号：正在发送、排队或运行中。具体是否展示占位
  // 由 TranscriptMessages 根据本次执行尝试是否已有可见回复内容判定。
  const isAwaitingResponse =
    isSendingMessage ||
    selectedSession?.state === 'running' ||
    selectedSession?.state === 'queued'
  const selectedTranscript =
    transcript?.sessionId === selectedSession?.sessionId ? transcript : null

  const setIsSendingMessage = (value: boolean): void => {
    if (!sessionId) return
    if (value) beginSending(sessionId)
    else finishSending(sessionId)
  }
  const clearSessionRequestsForSessions = (sessionIds: string[]): void => {
    for (const sessionId of sessionIds) {
      clearSessionRequests(sessionId)
    }
  }

  const sessionArchive = useSessionArchive({
    agentId: activeAgentId,
    selectedSession,
    onSessionsChange: (nextSessions) => {
      replaceAgentSessions(activeAgentId, nextSessions)
    },
    onArchived: (target, result) => {
      clearSessionRequestsForSessions(result.affectedSessionIds)
      navigate(`/chat/${target.agentId}`, { replace: true })
    },
    onDeleted: (target, result) => {
      clearSessionRequestsForSessions(result.affectedSessionIds)
      navigate(`/chat/${target.agentId}`, { replace: true })
    },
  })
  const parentSession = useMemo(() => {
    const parentSessionId = selectedSession?.forkedFrom?.sessionId
    if (!parentSessionId) return null

    return (
      sessions.find((session) => session.sessionId === parentSessionId) ?? null
    )
  }, [sessions, selectedSession?.forkedFrom?.sessionId])

  /**
   * 持久化用户最后成功打开的会话。
   *
   * @param agentId - 会话所属 Agent。
   * @param sessionId - 已成功打开的会话标识。
   * @returns 无返回值。
   * @throws Preload API 错误会被捕获并通过 toast 反馈。
   */
  function persistLastActiveSession(
    agentId: string,
    sessionId: string,
  ): Promise<void> {
    persistLastActiveSessionQueueRef.current =
      persistLastActiveSessionQueueRef.current
        .then(async () => {
          await window.api.setLastActiveSession({ agentId, sessionId })
        })
        .catch((error) => {
          toast.error(
            error instanceof Error ? error.message : '无法记录最后打开的会话',
          )
        })

    return persistLastActiveSessionQueueRef.current
  }

  /**
   * 创建默认 Agent 的新会话并放到列表顶部。
   *
   * @returns 无返回值。
   * @throws Preload API 错误会被捕获并通过 toast 反馈。
   */
  const createSession = async (): Promise<void> => {
    try {
      const session = await window.api.createSession({
        agentId: activeAgentId,
        title: '新会话',
      })
      const currentSessions =
        store.getState().sessionsByAgentId[activeAgentId] ?? []
      replaceAgentSessions(activeAgentId, [
        session,
        ...currentSessions.filter(
          (candidate) => candidate.sessionId !== session.sessionId,
        ),
      ])
      navigate(`/chat/${activeAgentId}/${session.sessionId}`, { replace: true })
      await persistLastActiveSession(session.agentId, session.sessionId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建会话失败')
    }
  }

  /**
   * 向当前会话发送用户消息。
   *
   * @returns 无返回值。
   * @throws Preload API 错误会被捕获并通过 toast 反馈。
   */
  const sendMessage = async (): Promise<void> => {
    const content = composerText.trim()

    if (!selectedSession) {
      toast.error('请先创建一个新会话。')
      return
    }

    if (!content) {
      return
    }

    updateComposerDraft('')
    setIsSendingMessage(true)

    try {
      const nextTranscript = await window.api.sendMessage({
        agentId: selectedSession.agentId,
        sessionId: selectedSession.sessionId,
        content,
      })
      openTranscript(nextTranscript)
      replaceAgentSessions(
        selectedSession.agentId,
        await window.api.listSessions({ agentId: selectedSession.agentId }),
      )
      navigate(`/chat/${activeAgentId}/${selectedSession.sessionId}`, {
        replace: true,
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '发送消息失败')
    } finally {
      setIsSendingMessage(false)
    }
  }

  /**
   * 重试一条失败的用户消息，复用原始请求并创建新的执行尝试。
   *
   * @param userMessageId - 要重试的原始用户消息标识。
   * @returns 无返回值。
   * @throws Preload API 错误会被捕获并通过 toast 反馈。
   */
  const retryMessage = async (userMessageId: string): Promise<void> => {
    if (!selectedSession) {
      toast.error('请先选择一个会话。')
      return
    }

    setIsSendingMessage(true)

    try {
      const nextTranscript = await window.api.retryMessage({
        agentId: selectedSession.agentId,
        sessionId: selectedSession.sessionId,
        userMessageId,
      })
      openTranscript(nextTranscript)
      replaceAgentSessions(
        selectedSession.agentId,
        await window.api.listSessions({ agentId: selectedSession.agentId }),
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '重试消息失败')
    } finally {
      setIsSendingMessage(false)
    }
  }

  /**
   * 在当前会话的某个用户消息节点分叉出新分支。
   *
   * @param userMessageId - 分叉起始节点（用户消息标识）。
   * @returns 无返回值。
   * @throws Preload API 错误会被捕获并通过 toast 反馈。
   */
  const forkSession = async (userMessageId: string): Promise<void> => {
    if (!selectedSession) {
      toast.error('请先选择一个会话。')
      return
    }

    const sourceEntry = selectedTranscript?.entries.find(
      (entry) =>
        entry.kind === 'user-message' && entry.messageId === userMessageId,
    )
    const sourceMessageContent =
      sourceEntry?.kind === 'user-message' ? sourceEntry.content : ''

    try {
      const childSession = await window.api.forkSession({
        agentId: selectedSession.agentId,
        sessionId: selectedSession.sessionId,
        entryId: userMessageId,
      })
      const [nextSessions, childTranscript] = await Promise.all([
        window.api.listSessions({ agentId: childSession.agentId }),
        window.api.getTranscript({
          agentId: childSession.agentId,
          sessionId: childSession.sessionId,
        }),
      ])
      replaceAgentSessions(childSession.agentId, nextSessions)
      openTranscript(childTranscript)
      updateComposerDraft(sourceMessageContent)
      navigate(`/chat/${activeAgentId}/${childSession.sessionId}`, {
        replace: true,
      })
      await persistLastActiveSession(
        childSession.agentId,
        childSession.sessionId,
      )
      toast.success('已创建分叉会话')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '分叉会话失败')
    }
  }

  /**
   * 取消当前会话正在运行的模型响应。
   *
   * @returns 无返回值。
   * @throws Preload API 错误会被捕获并通过 toast 反馈。
   */
  const cancelRun = async (): Promise<void> => {
    if (!selectedSession || cancellingSessionId === selectedSession.sessionId) {
      return
    }

    const targetSessionId = selectedSession.sessionId
    setCancellingSessionId(targetSessionId)
    try {
      await window.api.cancelRun({
        agentId: selectedSession.agentId,
        sessionId: selectedSession.sessionId,
      })
      finishSending(selectedSession.sessionId)
      // 刷新 sessions 以同步取消后的状态，避免仅依赖异步推送事件
      replaceAgentSessions(
        selectedSession.agentId,
        await window.api.listSessions({ agentId: selectedSession.agentId }),
      )
      toast.success('已停止生成')
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : '取消运行失败')
      // 即使取消失败，也要重置 isSendingMessage，防止 UI 卡住
      finishSending(selectedSession.sessionId)
    } finally {
      setCancellingSessionId((current) =>
        current === targetSessionId ? null : current,
      )
    }
  }

  /**
   * 跳回当前分叉会话的父会话，并定位到分叉来源消息。
   *
   * @returns 无返回值。
   */
  function viewForkSource(): void {
    if (!parentSession || !selectedSession?.forkedFrom) return

    setForkSourceMessageId(selectedSession.forkedFrom.entryId)
    navigate(`/chat/${activeAgentId}/${parentSession.sessionId}`, {
      replace: true,
    })
  }

  return (
    <main className="bg-background text-foreground h-full overflow-hidden">
      <h1 className="sr-only">{activeAgentDisplayName}</h1>
      <p className="sr-only">大语言模型对话</p>
      <div className="grid h-full min-h-0 grid-cols-[296px_minmax(0,1fr)]">
        <ChatSidebar
          agents={agents}
          activeAgentId={activeAgentId}
          sessions={sessions}
          selectedSessionId={selectedSession?.sessionId ?? null}
          pendingApprovalSessionIds={pendingApprovalSessionIds}
          archivedSessions={sessionArchive.archivedSessions}
          recoveringSessionId={sessionArchive.recoveringSessionId}
          onAgentChange={(nextAgentId) => {
            navigate(`/chat/${nextAgentId}`, { replace: true })
          }}
          onCreateSession={() => {
            void createSession()
          }}
          onSelectSession={(session) => {
            setForkSourceMessageId(null)
            navigate(`/chat/${activeAgentId}/${session.sessionId}`, {
              replace: true,
            })
          }}
          onRecoverSession={(session) => {
            void sessionArchive.recoverSession(session)
          }}
        />
        <ConversationArea
          selectedSession={selectedSession}
          parentSession={parentSession}
          forkSourceMessageId={forkSourceMessageId}
          transcript={selectedTranscript}
          isStreaming={isSelectedSessionRunning}
          isAwaitingResponse={isAwaitingResponse}
          pendingApprovals={sessionPendingApprovals}
          pendingClarifications={sessionPendingClarifications}
          activeAgentDisplayName={activeAgentDisplayName}
          composer={{
            value: composerText,
            onChange: updateComposerDraft,
            onSubmit: () => {
              void sendMessage()
            },
            onCancel: () => {
              void cancelRun()
            },
            isRunning:
              isSelectedSessionRunning ||
              isSendingMessage ||
              isCancellingSelectedSession,
            disabled: !selectedSession,
            sessionModelInfo: selectedSession ? sessionModelInfo : null,
            isLoadingModelInfo,
            isSwitchingModel,
            providers: runtime?.providers ?? [],
            selectableModels,
            onModelChange: (providerId, modelId) => {
              void handleSessionModelChange(providerId, modelId)
            },
            onThinkingLevelChange: (level) => {
              void handleThinkingLevelChange(level)
            },
          }}
          actions={{
            onRetry: (userMessageId) => {
              void retryMessage(userMessageId)
            },
            onFork: (userMessageId) => {
              void forkSession(userMessageId)
            },
            onViewForkSource: () => {
              viewForkSource()
            },
            onArchive: () => {
              void sessionArchive.archiveSelectedSession(false)
            },
            onDelete: () => {
              sessionArchive.requestDeleteSelectedSession()
            },
          }}
          archive={{
            isArchiving: sessionArchive.isArchiving,
            isDeleting: sessionArchive.isDeleting,
          }}
          approvals={{
            onApproveOnce: (approvalId) => {
              void window.api.approveBash({ approvalId })
            },
            onApproveAlways: (approval) => {
              allowCommandForProcess(approval.sessionId, approval.command)
              void window.api.approveBash({ approvalId: approval.approvalId })
            },
            onReject: (approvalId) => {
              void window.api.rejectBash({ approvalId })
            },
          }}
          clarifications={{
            onAnswer: (clarificationId, answer) => {
              void window.api.answerClarification({
                clarificationId,
                answer,
              })
            },
            onCancel: (clarificationId) => {
              void window.api.cancelClarification({ clarificationId })
            },
          }}
        />
      </div>
      <SessionArchiveDialog
        activities={sessionArchive.archivePreview?.affectedActivities ?? []}
        isArchiving={sessionArchive.isArchiving}
        onCancel={sessionArchive.cancelArchive}
        onConfirm={() => {
          void sessionArchive.archiveSelectedSession(true)
        }}
      />
      <SessionDeleteDialog
        open={sessionArchive.isDeleteDialogOpen}
        activities={sessionArchive.deletePreview?.affectedActivities ?? []}
        isDeleting={sessionArchive.isDeleting}
        onCancel={sessionArchive.cancelDelete}
        onConfirm={() => {
          void sessionArchive.deleteSelectedSession(
            sessionArchive.deletePreview !== null,
          )
        }}
      />
    </main>
  )
}

/**
 * 渲染应用启动时的简洁加载状态。
 *
 * @returns 加载状态页面。
 * @throws 此组件不会主动抛出错误。
 */
export function LoadingScreen(): React.JSX.Element {
  return (
    <main className="bg-background text-foreground grid min-h-full place-items-center">
      <div className="text-body text-muted-foreground">正在打开元宵...</div>
    </main>
  )
}
