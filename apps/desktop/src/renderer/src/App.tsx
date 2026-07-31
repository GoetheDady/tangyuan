import type {
  AgentEvent,
  AgentSessionSummary,
  AgentSummary,
  BashApprovalRequest,
  DesktopPreloadApi,
  QuestionClarificationRequest,
  RuntimeSnapshot,
  TranscriptSnapshot,
} from '@tangyuan/contracts'
import { applyTranscriptDelta } from '@tangyuan/contracts'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import {
  HashRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router'
import { toast } from 'sonner'
import { useStore } from 'zustand'

import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { WindowShell } from '@/components/WindowShell'
import { getAgentEventSessionId } from '@/lib/agent-event-session-state'
import { ChatGuard, LoadingScreen } from '@/pages/ChatPage'
import { ConsoleProviderPage } from '@/pages/ConsoleProviderPage'
import { ConsoleAgentListPage } from '@/pages/ConsoleAgentListPage'
import { ConsoleAgentDetailPage } from '@/pages/ConsoleAgentDetailPage'
import { SettingsLayout } from '@/pages/SettingsLayout'
import { SettingsProviderPage } from '@/pages/SettingsProviderPage'
import {
  createWorkbenchStore,
  type WorkbenchStoreApi,
} from '@/stores/workbench-store'

const componentFixturesEnabled =
  import.meta.env.DEV || import.meta.env.MODE === 'test'
const BaseComponentsFixturePage = componentFixturesEnabled
  ? lazy(() => import('@/fixtures/BaseComponentsFixturePage'))
  : null
const ConversationComponentsFixturePage = componentFixturesEnabled
  ? lazy(() => import('@/fixtures/ConversationComponentsFixturePage'))
  : null
const RendererRoutes = componentFixturesEnabled
  ? FixtureAwareRendererRoutes
  : DesktopRoutes

interface DesktopWorkbenchState {
  runtime: RuntimeSnapshot | null
  agents: AgentSummary[]
  sessions: AgentSessionSummary[]
  selectedSessionId: string | null
  transcript: TranscriptSnapshot | null
  composerText: string
  isLoading: boolean
  isSendingMessage: boolean
  pendingApprovals: BashApprovalRequest[]
  pendingClarifications: QuestionClarificationRequest[]
}

interface DesktopWorkbenchAction {
  setSessions(
    value:
      | AgentSessionSummary[]
      | ((currentValue: AgentSessionSummary[]) => AgentSessionSummary[]),
  ): void
  setSelectedSessionId(
    value: string | null | ((currentValue: string | null) => string | null),
  ): void
  setTranscript(value: TranscriptSnapshot | null): void
  setComposerText(value: string): void
  setIsSendingMessage(value: boolean): void
  selectAgent(agentId: string): void
  clearSessionRequestsForSessions(sessionIds: string[]): void
  /** 将命令加入当前会话的"始终允许"列表。 */
  addAlwaysAllowedCommand(sessionId: string, command: string): void
}

export interface DesktopWorkbenchContext
  extends DesktopWorkbenchState, DesktopWorkbenchAction {}

/**
 * 渲染桌面端应用的前端路由入口。
 *
 * @returns 带 HashRouter 的 React 组件树。
 * @throws 此组件不会主动抛出错误；页面错误会写入状态并展示。
 */
function App(): React.JSX.Element {
  return (
    <HashRouter>
      <TooltipProvider>
        <WindowShell>
          <RendererRoutes />
        </WindowShell>
        <Toaster />
      </TooltipProvider>
    </HashRouter>
  )
}

/**
 * 在构建期允许的环境中截获组件夹具路由，否则进入正常桌面应用。
 *
 * @returns 组件夹具或桌面端路由树。
 * @throws 此组件不会主动抛出错误。
 */
function FixtureAwareRendererRoutes(): React.JSX.Element {
  const location = useLocation()

  if (
    location.pathname === '/__fixtures__/base-components' &&
    BaseComponentsFixturePage
  ) {
    return (
      <Suspense fallback={<LoadingScreen />}>
        <BaseComponentsFixturePage />
      </Suspense>
    )
  }

  if (
    location.pathname === '/__fixtures__/conversation-components' &&
    ConversationComponentsFixturePage
  ) {
    return (
      <Suspense fallback={<LoadingScreen />}>
        <ConversationComponentsFixturePage />
      </Suspense>
    )
  }

  return <DesktopRoutes />
}

/**
 * 加载桌面端运行时数据，并按路由展示聊天页或控制台页。
 *
 * @returns 桌面端路由组件树。
 * @throws 此组件不会主动抛出错误；Preload API 错误会通过 toast 反馈。
 */
function DesktopRoutes(): React.JSX.Element {
  const navigate = useNavigate()
  const [workbenchStore] = useState<WorkbenchStoreApi>(createWorkbenchStore)
  const workbench = useStore(workbenchStore)
  const {
    runtime,
    agents,
    activeAgentId,
    activeSessionId: selectedSessionId,
    composerDraft: composerText,
    isInitializing: isLoading,
  } = workbench
  const sessions = activeAgentId
    ? (workbench.sessionsByAgentId[activeAgentId] ?? [])
    : []
  const transcript = selectedSessionId
    ? (workbench.transcriptsBySessionId[selectedSessionId] ?? null)
    : null
  const isSendingMessage = selectedSessionId
    ? (workbench.sendingBySessionId[selectedSessionId] ?? false)
    : false
  const pendingApprovals = Object.values(
    workbench.pendingApprovalsBySessionId,
  ).flat()
  const pendingClarifications = Object.values(
    workbench.pendingClarificationsBySessionId,
  ).flat()
  // 把每帧内到达的多个 transcript-delta 合并为一次 setTranscript 调用，避免每个 token 都触发 re-render
  const pendingDeltaEventsRef = useRef<
    Extract<AgentEvent, { type: 'transcript-delta' }>[]
  >([])
  const transcriptFlushRafRef = useRef<number | null>(null)

  /**
   * 将命令加入指定会话的"始终允许"列表，后续同命令自动免审。
   *
   * @param sessionId - 会话标识。
   * @param command - 免审的 bash 命令。
   * @returns 无返回值。
   */
  function addAlwaysAllowedCommand(sessionId: string, command: string): void {
    workbench.allowCommandForProcess(sessionId, command)
  }

  // 临时兼容适配层：仅把 ChatPage 的旧调用形态映射为 store 语义 action；
  // 当聊天页在后续迁移中直接使用 selector/action 后应整体删除。
  const setSessions: DesktopWorkbenchAction['setSessions'] = (value) => {
    const agentId = workbenchStore.getState().activeAgentId
    if (!agentId) return
    const currentSessions =
      workbenchStore.getState().sessionsByAgentId[agentId] ?? []
    workbenchStore
      .getState()
      .replaceAgentSessions(
        agentId,
        typeof value === 'function' ? value(currentSessions) : value,
      )
  }
  const setSelectedSessionId: DesktopWorkbenchAction['setSelectedSessionId'] = (
    value,
  ) => {
    const state = workbenchStore.getState()
    const agentId = state.activeAgentId ?? state.runtime?.activeAgent.agentId
    if (!agentId) return
    state.selectSession(
      agentId,
      typeof value === 'function' ? value(state.activeSessionId) : value,
    )
  }
  const setTranscript = (value: TranscriptSnapshot | null): void => {
    const currentSessionId = workbenchStore.getState().activeSessionId
    if (value) {
      workbenchStore.getState().openTranscript(value)
    } else if (currentSessionId) {
      workbenchStore.getState().clearTranscript(currentSessionId)
    }
  }
  const setComposerText = (value: string): void => {
    workbenchStore.getState().updateComposerDraft(value)
  }
  const setIsSendingMessage = (value: boolean): void => {
    const state = workbenchStore.getState()
    if (!state.activeSessionId) return
    if (value) state.beginSending(state.activeSessionId)
    else state.finishSending(state.activeSessionId)
  }

  const context: DesktopWorkbenchContext = {
    runtime,
    agents,
    sessions,
    selectedSessionId,
    transcript,
    composerText,
    isLoading,
    isSendingMessage,
    pendingApprovals,
    pendingClarifications,
    setSessions,
    setSelectedSessionId,
    setTranscript,
    setComposerText,
    setIsSendingMessage,
    selectAgent: workbench.selectAgent,
    clearSessionRequestsForSessions: (sessionIds) => {
      for (const sessionId of sessionIds) {
        workbenchStore.getState().clearSessionRequests(sessionId)
      }
    },
    addAlwaysAllowedCommand,
  }

  useEffect(() => {
    let isMounted = true

    void loadDesktopWorkbench(window.api)
      .then((snapshot) => {
        if (!isMounted) return

        workbenchStore.getState().loadWorkbenchSnapshot(snapshot)

        // 启动重定向由 StartupRedirect 组件在根路由 '/' 上处理。
        // 此处不再从任意路由无条件跳转，以保留用户直接访问的深层控制台 URI。
      })
      .catch((error: unknown) => {
        if (!isMounted) return

        toast.error(
          error instanceof Error ? error.message : '无法读取桌面端运行时状态',
        )
        navigate('/setup', { replace: true })
      })
      .finally(() => {
        if (isMounted) {
          workbenchStore.getState().finishInitialization()
        }
      })

    return () => {
      isMounted = false
    }
    // 启动快照只装载一次；路由变化不得重新覆盖用户已经选择的会话。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workbenchStore])

  useEffect(() => {
    const unsubscribe = window.api.subscribeToAgentEvents((event) => {
      if (event.type === 'agent-created') {
        workbenchStore.getState().applyAgentEvent(event)
        toast.success(`已创建 Agent「${event.agent.displayName}」`)
        return
      }

      if (event.type === 'agent-archived') {
        workbenchStore.getState().applyAgentEvent(event)
        toast.success(`已归档 Agent「${event.agent.displayName}」`)
        return
      }

      if (event.type === 'agent-recovered') {
        workbenchStore.getState().applyAgentEvent(event)
        toast.success(`已恢复 Agent「${event.agent.displayName}」`)
        return
      }

      if (event.type === 'agent-config-updated') {
        workbenchStore.getState().applyAgentEvent(event)
        return
      }

      if (event.type === 'profile-updated') {
        void window.api
          .refreshRuntime()
          .then((nextRuntime) => {
            workbenchStore.getState().loadRuntimeSnapshot(nextRuntime)
          })
          .catch((error: unknown) => {
            toast.error(
              error instanceof Error ? error.message : '刷新 Profile 状态失败',
            )
          })
      }

      if (event.type === 'approval-required') {
        // 检查是否已"始终允许"此会话中的此命令
        const sessionCommands =
          workbenchStore.getState().alwaysAllowedCommandsBySessionId[
            event.sessionId
          ] ?? []
        if (sessionCommands.includes(event.approval.command)) {
          // 自动批准，不展示审批卡片
          void window.api.approveBash({ approvalId: event.approval.approvalId })
          return
        }
        workbenchStore.getState().applyAgentEvent(event)
        toast.info(
          `Bash 命令需要审批：${event.approval.command.slice(0, 60)}...`,
        )
        return
      }

      if (event.type === 'approval-resolved') {
        workbenchStore.getState().applyAgentEvent(event)
        if (event.status === 'approved') {
          toast.success('已批准 Bash 命令执行')
        } else {
          toast.info('已拒绝 Bash 命令执行')
        }
        return
      }

      if (event.type === 'clarification-required') {
        workbenchStore.getState().applyAgentEvent(event)
        toast.info(
          `Agent 需要更多信息：${event.clarification.question.slice(0, 60)}...`,
        )
        return
      }

      if (event.type === 'clarification-resolved') {
        workbenchStore.getState().applyAgentEvent(event)
        if (event.status === 'answered') {
          toast.success(`已回答：${event.answer}`)
        } else {
          toast.info('已取消澄清')
        }
        return
      }

      if (event.type !== 'transcript-delta') {
        workbenchStore.getState().applyAgentEvent(event)
      }

      const eventSessionId = getAgentEventSessionId(event)
      if (!eventSessionId || eventSessionId !== selectedSessionId) {
        return
      }

      if (event.type === 'turn-failed') {
        toast.error(event.error.message)
      }

      if (
        event.type === 'transcript-delta' &&
        event.sessionId === selectedSessionId
      ) {
        pendingDeltaEventsRef.current.push(event)
        if (transcriptFlushRafRef.current === null) {
          transcriptFlushRafRef.current = requestAnimationFrame(() => {
            transcriptFlushRafRef.current = null
            const events = pendingDeltaEventsRef.current.splice(0)
            if (events.length === 0) return
            const firstEvent = events[0]!
            const state = workbenchStore.getState()
            const current = state.transcriptsBySessionId[firstEvent.sessionId]
            if (
              state.activeSessionId !== firstEvent.sessionId ||
              (current && current.sessionId !== firstEvent.sessionId)
            ) {
              return
            }
            let snapshot: TranscriptSnapshot = current ?? {
              sessionId: firstEvent.sessionId,
              agentId: firstEvent.agentId,
              entries: [],
              updatedAt: new Date().toISOString(),
            }
            for (const ev of events) {
              snapshot = applyTranscriptDelta(snapshot, ev.delta)
            }
            state.openTranscript(snapshot)
          })
        }
      }

      if (
        event.type === 'turn-cancelled' ||
        event.type === 'turn-failed' ||
        (event.type === 'run-state-changed' && event.state !== 'running')
      ) {
        workbenchStore.getState().finishSending(event.sessionId)
      }
    })
    return () => {
      unsubscribe()
      if (transcriptFlushRafRef.current !== null) {
        cancelAnimationFrame(transcriptFlushRafRef.current)
        transcriptFlushRafRef.current = null
      }
      pendingDeltaEventsRef.current = []
    }
  }, [selectedSessionId, workbenchStore])

  const handleConfigurationSaved = useCallback(
    async (nextRuntime: RuntimeSnapshot): Promise<void> => {
      const { sessions, activeSession, transcript } =
        await loadSessionsForReadyRuntime(window.api, nextRuntime)
      workbenchStore.getState().loadWorkbenchSnapshot({
        runtime: nextRuntime,
        agents: nextRuntime.agents,
        sessions,
        activeSession,
        transcript,
      })
    },
    [workbenchStore],
  )

  return (
    <Routes>
      <Route
        path="/"
        element={
          <StartupRedirect
            runtime={runtime}
            activeSession={
              sessions.find(
                (session) => session.sessionId === selectedSessionId,
              ) ?? null
            }
            isLoading={isLoading}
          />
        }
      />
      <Route
        path="/chat/:agentId?/:sessionId?"
        element={<ChatGuard context={context} />}
      />
      <Route
        path="/setup"
        element={
          <ConsoleProviderPage
            onConfigurationSaved={handleConfigurationSaved}
          />
        }
      />
      <Route path="/settings" element={<SettingsLayout />}>
        <Route index element={<Navigate to="providers" replace />} />
        <Route path="providers" element={<SettingsProviderPage />} />
        <Route path="agents" element={<ConsoleAgentListPage />} />
        <Route path="agents/:agentId" element={<ConsoleAgentDetailPage />} />
      </Route>
      <Route
        path="/console"
        element={<Navigate to="/settings/providers" replace />}
      />
      <Route
        path="/console/providers"
        element={<Navigate to="/settings/providers" replace />}
      />
      <Route
        path="/console/agents"
        element={<Navigate to="/settings/agents" replace />}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

/**
 * 根据运行时状态把启动入口重定向到聊天页或控制台页。
 *
 * @param props - 当前运行时和加载状态。
 * @returns 加载态或 Navigate 路由元素。
 * @throws 此组件不会主动抛出错误。
 */
function StartupRedirect(props: {
  runtime: RuntimeSnapshot | null
  activeSession: AgentSessionSummary | null
  isLoading: boolean
}): React.JSX.Element {
  if (props.isLoading) {
    return <LoadingScreen />
  }

  if (props.runtime?.status === 'ready') {
    return (
      <Navigate
        to={
          props.activeSession
            ? `/chat/${props.activeSession.agentId}/${props.activeSession.sessionId}`
            : '/chat/tangyuan'
        }
        replace
      />
    )
  }

  return <Navigate to="/setup" replace />
}

/**
 * 在运行时就绪后加载会话数据：优先恢复上次激活的会话，无则新建。
 *
 * @param api - Preload 暴露给 Renderer 的桌面 API。
 * @param runtime - 状态为 ready 的运行时快照。
 * @returns 会话列表、激活会话和 transcript 快照。
 * @throws 当任一 Preload API 请求失败时，Promise 会 reject。
 */
async function loadSessionsForReadyRuntime(
  api: DesktopPreloadApi,
  runtime: RuntimeSnapshot,
): Promise<{
  sessions: AgentSessionSummary[]
  activeSession: AgentSessionSummary
  transcript: TranscriptSnapshot | null
}> {
  const lastActiveSession = await api.getLastActiveSession()
  const activeAgentId =
    lastActiveSession?.agentId ?? runtime.activeAgent.agentId
  let nextSessions = await api.listSessions({ agentId: activeAgentId })
  let activeSession: AgentSessionSummary | null = null
  let transcript: TranscriptSnapshot | null = null

  if (lastActiveSession) {
    activeSession =
      nextSessions.find(
        (session) => session.sessionId === lastActiveSession.sessionId,
      ) ??
      nextSessions[0] ??
      null
    transcript = activeSession
      ? await api.getTranscript({
          agentId: activeSession.agentId,
          sessionId: activeSession.sessionId,
        })
      : null
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

  if (!lastActiveSession) {
    await api.setLastActiveSession({
      agentId: activeSession.agentId,
      sessionId: activeSession.sessionId,
    })
  }

  return { sessions: nextSessions, activeSession, transcript }
}

/**
 * 并行读取 Renderer 首屏需要的运行时和会话数据。
 *
 * @param api - Preload 暴露给 Renderer 的桌面 API。
 * @returns 运行时快照和会话摘要列表。
 * @throws 当任一 Preload API 请求失败时，Promise 会 reject。
 */
async function loadDesktopWorkbench(api: DesktopPreloadApi): Promise<{
  runtime: RuntimeSnapshot
  agents: AgentSummary[]
  sessions: AgentSessionSummary[]
  activeSession: AgentSessionSummary | null
  transcript: TranscriptSnapshot | null
}> {
  const runtime = await api.getRuntimeSnapshot()
  const agents = runtime.agents

  if (runtime.status !== 'ready') {
    return {
      runtime,
      agents,
      sessions: [],
      activeSession: null,
      transcript: null,
    }
  }

  const { sessions, activeSession, transcript } =
    await loadSessionsForReadyRuntime(api, runtime)
  return { runtime, agents, sessions, activeSession, transcript }
}

export default App
