import type {
  AgentSummary,
  ModelDescriptor,
} from '@yuanxiao/contracts'
import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'
import { useStore } from 'zustand'

import { ChatSidebar } from '@/components/ChatSidebar'
import { ConversationArea } from '@/components/ConversationArea'
import {
  SessionDeleteDialog,
} from '@/components/SessionArchiveControls'
import { useChatSessionActions } from '@/hooks/useChatSessionActions'
import { useSessionArchive } from '@/hooks/useSessionArchive'
import {
  EMPTY_SESSIONS,
  type WorkbenchStoreApi,
} from '@/stores/workbench-store'

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
  const activeAgentId = agentId ?? runtime?.activeAgent.agentId ?? 'yuanxiao'

  const sessions = useStore(
    store,
    (state) =>
      (activeAgentId ? state.sessionsByAgentId[activeAgentId] : undefined) ??
      EMPTY_SESSIONS,
  )
  const archivedSessions = useStore(
    store,
    (state) =>
      (activeAgentId
        ? state.archivedSessionsByAgentId[activeAgentId]
        : undefined) ?? EMPTY_SESSIONS,
  )
  const transcript = useStore(store, (state) =>
    sessionId ? (state.transcriptsBySessionId[sessionId] ?? null) : null,
  )
  const isSendingMessage = useStore(store, (state) =>
    sessionId ? (state.sendingBySessionId[sessionId] ?? false) : false,
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

  const sessionActions = useChatSessionActions({
    store,
    activeAgentId,
    sessionId,
  })
  /** 跳转后需要在父会话中定位的分叉来源消息（双 id 并存：运行期 messageId + SDK entry id）。 */
  const [forkSource, setForkSource] = useState<{
    messageId: string
    sdkEntryId?: string
  } | null>(null)

  const selectableModels = useMemo<ModelDescriptor[]>(() => {
    if (!runtime) return []

    return runtime.models.filter(
      (model) =>
        runtime.configuredProviders[model.providerId]?.configured === true,
    )
  }, [runtime])

  const selectedSession = useMemo(() => {
    if (sessionId) {
      return sessions.find((session) => session.sessionId === sessionId) ?? null
    }
    return sessions[0] ?? null
  }, [sessions, sessionId])
  const isSelectedSessionRunning = selectedSession?.state === 'running'
  const isCancellingSelectedSession =
    sessionActions.cancellingSessionId === selectedSession?.sessionId
  // 响应等待提示信号：正在发送、排队或运行中。具体是否展示占位
  // 由 TranscriptMessages 根据本次执行尝试是否已有可见回复内容判定。
  const isAwaitingResponse =
    isSendingMessage ||
    selectedSession?.state === 'running' ||
    selectedSession?.state === 'queued'
  const selectedTranscript =
    transcript?.sessionId === selectedSession?.sessionId ? transcript : null

  const sessionArchive = useSessionArchive({
    agentId: activeAgentId,
    selectedSessionId: selectedSession?.sessionId ?? null,
    store,
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
  function viewForkSource(): void {
    if (!parentSession || !selectedSession?.forkedFrom) return

    setForkSource({
      messageId: selectedSession.forkedFrom.entryId,
      sdkEntryId: selectedSession.forkedFrom.sdkEntryId,
    })
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
          archivedSessions={archivedSessions}
          recoveringSessionId={sessionArchive.recoveringSessionId}
          onAgentChange={(nextAgentId) => {
            navigate(`/chat/${nextAgentId}`, { replace: true })
          }}
          onCreateSession={() => {
            void sessionActions.createSession()
          }}
          onSelectSession={(session) => {
            setForkSource(null)
            navigate(`/chat/${activeAgentId}/${session.sessionId}`, {
              replace: true,
            })
          }}
          onRecoverSession={(session) => {
            void sessionArchive.recoverSession(session)
          }}
          onArchiveSession={(session) => {
            void sessionArchive.archiveSession(session)
          }}
          onDeleteSession={(session) => {
            sessionArchive.requestDeleteSession(session)
          }}
          onRenameSession={(session, title) => {
            void (async () => {
              try {
                const updated = await window.api.renameSession({
                  agentId: session.agentId,
                  sessionId: session.sessionId,
                  title,
                })
                store.getState().updateSession(updated)
              } catch (error: unknown) {
                const { toast } = await import('sonner')
                toast.error(
                  error instanceof Error ? error.message : '重命名会话失败',
                )
              }
            })()
          }}
        />
        <ConversationArea
          selectedSession={selectedSession}
          parentSession={parentSession}
          forkSource={forkSource}
          transcript={selectedTranscript}
          isLoadingTranscript={sessionActions.isLoadingTranscript}
          isStreaming={isSelectedSessionRunning}
          isAwaitingResponse={isAwaitingResponse}
          activeAgentDisplayName={activeAgentDisplayName}
          composer={{
            value: composerText,
            onChange: updateComposerDraft,
            onSubmit: () => {
              void sessionActions.sendMessage()
            },
            onCancel: () => {
              void sessionActions.cancelRun()
            },
            isRunning:
              isSelectedSessionRunning ||
              isSendingMessage ||
              isCancellingSelectedSession,
            disabled: !selectedSession,
            sessionModelInfo: selectedSession
              ? sessionActions.sessionModelInfo
              : null,
            isLoadingModelInfo: sessionActions.isLoadingModelInfo,
            isSwitchingModel: sessionActions.isSwitchingModel,
            providers: runtime?.providers ?? [],
            selectableModels,
            onModelChange: (providerId, modelId) => {
              void sessionActions.handleSessionModelChange(providerId, modelId)
            },
            onThinkingLevelChange: (level) => {
              void sessionActions.handleThinkingLevelChange(level)
            },
          }}
          actions={{
            onRetry: (userMessageId) => {
              void sessionActions.retryMessage(userMessageId)
            },
            onFork: (userMessageId) => {
              void sessionActions.forkSession(userMessageId)
            },
            onViewForkSource: () => {
              viewForkSource()
            },
          }}
        />
      </div>
      <SessionDeleteDialog
        open={sessionArchive.isDeleteDialogOpen}
        activities={sessionArchive.deletePreview?.affectedActivities ?? []}
        isDeleting={sessionArchive.isDeleting}
        onCancel={sessionArchive.cancelDelete}
        onConfirm={() => {
          void sessionArchive.deleteSession(
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
