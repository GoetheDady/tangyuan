import type {
  AgentEvent,
  AgentSessionSummary,
  AgentSummary,
  BashApprovalRequest,
  DesktopPreloadApi,
  QuestionClarificationRequest,
  RuntimeSnapshot,
  TranscriptSnapshot
} from '@tangyuan/contracts'
import { applyTranscriptDelta } from '@tangyuan/contracts'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router'
import { toast } from 'sonner'

import { Toaster } from '@/components/ui/sonner'
import { ChatGuard, LoadingScreen } from '@/pages/ChatPage'
import { ConsoleProviderPage } from '@/pages/ConsoleProviderPage'
import { ConsoleAgentListPage } from '@/pages/ConsoleAgentListPage'
import { ConsoleAgentDetailPage } from '@/pages/ConsoleAgentDetailPage'

const componentFixturesEnabled = import.meta.env.DEV || import.meta.env.MODE === 'test'
const BaseComponentsFixturePage = componentFixturesEnabled
  ? lazy(() => import('@/fixtures/BaseComponentsFixturePage'))
  : null
const ConversationComponentsFixturePage = componentFixturesEnabled
  ? lazy(() => import('@/fixtures/ConversationComponentsFixturePage'))
  : null
const RendererRoutes = componentFixturesEnabled ? FixtureAwareRendererRoutes : DesktopRoutes

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
  setRuntime(value: RuntimeSnapshot | null): void
  setAgents(value: AgentSummary[] | ((currentValue: AgentSummary[]) => AgentSummary[])): void
  setSessions(
    value: AgentSessionSummary[] | ((currentValue: AgentSessionSummary[]) => AgentSessionSummary[])
  ): void
  setSelectedSessionId(
    value: string | null | ((currentValue: string | null) => string | null)
  ): void
  setTranscript(value: TranscriptSnapshot | null): void
  setComposerText(value: string): void
  setIsLoading(value: boolean): void
  setIsSendingMessage(value: boolean): void
  setPendingApprovals(
    value: BashApprovalRequest[] | ((currentValue: BashApprovalRequest[]) => BashApprovalRequest[])
  ): void
  setPendingClarifications(
    value:
      | QuestionClarificationRequest[]
      | ((currentValue: QuestionClarificationRequest[]) => QuestionClarificationRequest[])
  ): void
  /** 将命令加入当前会话的"始终允许"列表。 */
  addAlwaysAllowedCommand(sessionId: string, command: string): void
}

export interface DesktopWorkbenchContext extends DesktopWorkbenchState, DesktopWorkbenchAction {}

/**
 * 渲染桌面端应用的前端路由入口。
 *
 * @returns 带 HashRouter 的 React 组件树。
 * @throws 此组件不会主动抛出错误；页面错误会写入状态并展示。
 */
function App(): React.JSX.Element {
  return (
    <HashRouter>
      <RendererRoutes />
      <Toaster />
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

  if (location.pathname === '/__fixtures__/base-components' && BaseComponentsFixturePage) {
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
  const [runtime, setRuntime] = useState<RuntimeSnapshot | null>(null)
  const [agents, setAgents] = useState<AgentSummary[]>([])
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const selectedSessionIdRef = useRef<string | null>(null)
  const [transcript, setTranscript] = useState<TranscriptSnapshot | null>(null)
  const [composerText, setComposerText] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSendingMessage, setIsSendingMessage] = useState(false)
  const [pendingApprovals, setPendingApprovals] = useState<BashApprovalRequest[]>([])
  const [pendingClarifications, setPendingClarifications] = useState<
    QuestionClarificationRequest[]
  >([])
  const alwaysAllowedCommandsRef = useRef<Map<string, Set<string>>>(new Map())

  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId
  }, [selectedSessionId])

  /**
   * 将命令加入指定会话的"始终允许"列表，后续同命令自动免审。
   *
   * @param sessionId - 会话标识。
   * @param command - 免审的 bash 命令。
   * @returns 无返回值。
   */
  function addAlwaysAllowedCommand(sessionId: string, command: string): void {
    const sessionCommands = alwaysAllowedCommandsRef.current.get(sessionId)
    if (sessionCommands) {
      sessionCommands.add(command)
    } else {
      alwaysAllowedCommandsRef.current.set(sessionId, new Set([command]))
    }
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
    setRuntime,
    setAgents,
    setSessions,
    setSelectedSessionId,
    setTranscript,
    setComposerText,
    setIsLoading,
    setIsSendingMessage,
    setPendingApprovals,
    setPendingClarifications,
    addAlwaysAllowedCommand
  }

  useEffect(() => {
    let isMounted = true

    void loadDesktopWorkbench(window.api)
      .then((workbench) => {
        if (!isMounted) return

        setRuntime(workbench.runtime)
        setAgents(workbench.agents)
        setSessions(workbench.sessions)
        setSelectedSessionId(
          (currentSessionId) => currentSessionId ?? workbench.sessions[0]?.sessionId ?? null
        )
        setTranscript((currentTranscript) => {
          const activeSessionId = selectedSessionIdRef.current
          if (
            activeSessionId &&
            workbench.transcript &&
            workbench.transcript.sessionId !== activeSessionId
          ) {
            return currentTranscript
          }
          return workbench.transcript
        })

        // 启动重定向由 StartupRedirect 组件在根路由 '/' 上处理。
        // 此处不再从任意路由无条件跳转，以保留用户直接访问的深层控制台 URI。
      })
      .catch((error: unknown) => {
        if (!isMounted) return

        toast.error(error instanceof Error ? error.message : '无法读取桌面端运行时状态')
        navigate('/console/providers', { replace: true })
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [navigate])

  useEffect(() => {
    return window.api.subscribeToAgentEvents((event) => {
      if (event.type === 'agent-created') {
        setAgents((currentAgents) => {
          const exists = currentAgents.some((agent) => agent.agentId === event.agent.agentId)
          if (exists) {
            return currentAgents.map((agent) =>
              agent.agentId === event.agent.agentId ? event.agent : agent
            )
          }
          return [...currentAgents, event.agent]
        })
        toast.success(`已创建 Agent「${event.agent.displayName}」`)
        return
      }

      if (event.type === 'agent-archived') {
        setAgents((currentAgents) =>
          currentAgents.map((agent) =>
            agent.agentId === event.agent.agentId ? event.agent : agent
          )
        )
        toast.success(`已归档 Agent「${event.agent.displayName}」`)
        return
      }

      if (event.type === 'agent-recovered') {
        setAgents((currentAgents) =>
          currentAgents.map((agent) =>
            agent.agentId === event.agent.agentId ? event.agent : agent
          )
        )
        toast.success(`已恢复 Agent「${event.agent.displayName}」`)
        return
      }

      if (event.type === 'agent-config-updated') {
        setAgents((currentAgents) =>
          currentAgents.map((agent) =>
            agent.agentId === event.agent.agentId ? event.agent : agent
          )
        )
        return
      }

      if (event.type === 'profile-updated') {
        void window.api
          .refreshRuntime()
          .then((nextRuntime) => {
            setRuntime(nextRuntime)
          })
          .catch((error: unknown) => {
            toast.error(error instanceof Error ? error.message : '刷新 Profile 状态失败')
          })
      }

      if (event.type === 'approval-required') {
        // 检查是否已"始终允许"此会话中的此命令
        const sessionCommands = alwaysAllowedCommandsRef.current.get(event.sessionId)
        if (sessionCommands?.has(event.approval.command)) {
          // 自动批准，不展示审批卡片
          void window.api.approveBash({ approvalId: event.approval.approvalId })
          return
        }
        setPendingApprovals((current) => [...current, event.approval])
        toast.info(`Bash 命令需要审批：${event.approval.command.slice(0, 60)}...`)
        return
      }

      if (event.type === 'approval-resolved') {
        setPendingApprovals((current) => current.filter((a) => a.approvalId !== event.approvalId))
        if (event.status === 'approved') {
          toast.success('已批准 Bash 命令执行')
        } else {
          toast.info('已拒绝 Bash 命令执行')
        }
        return
      }

      if (event.type === 'clarification-required') {
        setPendingClarifications((current) => [...current, event.clarification])
        toast.info(`Agent 需要更多信息：${event.clarification.question.slice(0, 60)}...`)
        return
      }

      if (event.type === 'clarification-resolved') {
        setPendingClarifications((current) =>
          current.filter((c) => c.clarificationId !== event.clarificationId)
        )
        if (event.status === 'answered') {
          toast.success(`已回答：${event.answer}`)
        } else {
          toast.info('已取消澄清')
        }
        return
      }

      applyAgentEventToSessions(event, setSessions)

      const eventSessionId = getAgentEventSessionId(event)
      if (!eventSessionId || eventSessionId !== selectedSessionId) {
        return
      }

      if (event.type === 'turn-failed') {
        toast.error(event.error.message)
      }

      if (event.type === 'transcript-delta' && event.sessionId === selectedSessionId) {
        setTranscript((current) => {
          if (!current || current.sessionId !== event.sessionId) return current
          return applyTranscriptDelta(current, event.delta)
        })
      }

      if (
        event.type === 'turn-cancelled' ||
        event.type === 'turn-failed' ||
        (event.type === 'run-state-changed' && event.state !== 'running')
      ) {
        setIsSendingMessage(false)
      }
    })
  }, [selectedSessionId])

  return (
    <Routes>
      <Route path="/" element={<StartupRedirect runtime={runtime} isLoading={isLoading} />} />
      <Route path="/chat/:agentId?/:sessionId?" element={<ChatGuard context={context} />} />
      <Route path="/console" element={<Navigate to="/console/providers" replace />} />
      <Route path="/console/providers" element={<ConsoleProviderPage />} />
      <Route path="/console/agents" element={<ConsoleAgentListPage />} />
      <Route path="/console/agents/:agentId" element={<ConsoleAgentDetailPage />} />
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
  isLoading: boolean
}): React.JSX.Element {
  if (props.isLoading) {
    return <LoadingScreen />
  }

  return (
    <Navigate
      to={props.runtime?.status === 'ready' ? '/chat/tangyuan' : '/console/providers'}
      replace
    />
  )
}

type StateSetter<T> = (value: T | ((currentValue: T) => T)) => void

/**
 * 把 Agent 标准事件归并到会话列表状态。
 *
 * @param event - Main 推送的标准 Agent 事件。
 * @param setSessions - React 会话状态 setter。
 * @returns 无返回值。
 * @throws 此方法不会主动抛出错误。
 */
function applyAgentEventToSessions(
  event: AgentEvent,
  setSessions: StateSetter<AgentSessionSummary[]>
): void {
  if (event.type === 'session-created') {
    setSessions((currentSessions) => [
      event.session,
      ...currentSessions.filter((session) => session.sessionId !== event.session.sessionId)
    ])
    return
  }

  const sessionId = getAgentEventSessionId(event)
  const nextState = getAgentEventRunState(event)

  if (!sessionId || !nextState) {
    return
  }

  setSessions((currentSessions) =>
    currentSessions.map((session) =>
      session.sessionId === sessionId
        ? { ...session, state: nextState, updatedAt: event.occurredAt }
        : session
    )
  )
}

/**
 * 从 Agent 事件中读取所属会话标识。
 *
 * @param event - 标准 Agent 事件。
 * @returns 有会话归属时返回 sessionId，否则返回 null。
 * @throws 此方法不会主动抛出错误。
 */
function getAgentEventSessionId(event: AgentEvent): string | null {
  if (event.type === 'session-created') {
    return event.session.sessionId
  }

  if (
    event.type === 'attempt-started' ||
    event.type === 'turn-cancelled' ||
    event.type === 'turn-failed' ||
    event.type === 'run-state-changed' ||
    event.type === 'approval-required' ||
    event.type === 'approval-resolved' ||
    event.type === 'clarification-required' ||
    event.type === 'clarification-resolved' ||
    event.type === 'transcript-delta'
  ) {
    return event.sessionId
  }

  return null
}

/**
 * 从 Agent 事件中读取会话的新运行状态。
 *
 * @param event - 标准 Agent 事件。
 * @returns 可用于会话摘要的新状态；无状态变化时返回 null。
 * @throws 此方法不会主动抛出错误。
 */
function getAgentEventRunState(
  event: AgentEvent
): 'idle' | 'queued' | 'running' | 'completed' | 'cancelled' | 'failed' | null {
  if (event.type === 'attempt-started') {
    return 'running'
  }

  if (event.type === 'turn-cancelled') {
    return 'cancelled'
  }

  if (event.type === 'turn-failed') {
    return 'failed'
  }

  if (event.type === 'run-state-changed') {
    return event.state
  }

  return null
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
  transcript: TranscriptSnapshot | null
}> {
  const runtime = await api.getRuntimeSnapshot()
  const agents = runtime.agents ?? [
    {
      agentId: runtime.activeAgent.agentId,
      displayName: runtime.activeAgent.displayName,
      status: 'active' as const,
      defaultProviderId: runtime.settings.selectedProviderId,
      defaultModelId: runtime.settings.selectedModelId,
      homePath: runtime.activeAgent.homePath,
      archivedAt: null
    }
  ]

  if (runtime.status !== 'ready') {
    return { runtime, agents, sessions: [], transcript: null }
  }

  const sessions = await api.listSessions()
  const nextSessions =
    runtime.activeAgent.profile.bootstrapRequired && !sessions.length
      ? [
          await api.createSession({
            agentId: runtime.activeAgent.agentId,
            title: 'Bootstrap 初始化'
          })
        ]
      : sessions
  const [firstSession] = nextSessions
  const transcript = firstSession
    ? await api.getTranscript({
        agentId: firstSession.agentId,
        sessionId: firstSession.sessionId
      })
    : null

  return { runtime, agents, sessions: nextSessions, transcript }
}

export default App
