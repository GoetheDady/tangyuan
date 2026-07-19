import type {
  AgentEvent,
  AgentMessage,
  AgentSessionSummary,
  AgentSummary,
  BashApprovalRequest,
  DesktopPreloadApi,
  RuntimeSnapshot
} from '@tangyuan/contracts'
import { lazy, Suspense, useEffect, useState } from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router'
import { toast, Toaster } from 'sonner'

import { ChatGuard, LoadingScreen } from '@/pages/ChatPage'
import { ConsoleProviderPage } from '@/pages/ConsoleProviderPage'
import { ConsoleAgentListPage } from '@/pages/ConsoleAgentListPage'
import { ConsoleAgentDetailPage } from '@/pages/ConsoleAgentDetailPage'

const baseComponentsFixturesEnabled = import.meta.env.DEV || import.meta.env.MODE === 'test'
const BaseComponentsFixturePage = baseComponentsFixturesEnabled
  ? lazy(() => import('@/fixtures/BaseComponentsFixturePage'))
  : null
const RendererRoutes = baseComponentsFixturesEnabled ? FixtureAwareRendererRoutes : DesktopRoutes

interface DesktopWorkbenchState {
  runtime: RuntimeSnapshot | null
  agents: AgentSummary[]
  sessions: AgentSessionSummary[]
  selectedSessionId: string | null
  messages: AgentMessage[]
  composerText: string
  isLoading: boolean
  isSendingMessage: boolean
  pendingApprovals: BashApprovalRequest[]
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
  setMessages(value: AgentMessage[] | ((currentValue: AgentMessage[]) => AgentMessage[])): void
  setComposerText(value: string): void
  setIsLoading(value: boolean): void
  setIsSendingMessage(value: boolean): void
  setPendingApprovals(
    value: BashApprovalRequest[] | ((currentValue: BashApprovalRequest[]) => BashApprovalRequest[])
  ): void
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
      <Toaster
        position="top-center"
        closeButton
        toastOptions={{
          duration: 3000
        }}
      />
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
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [composerText, setComposerText] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSendingMessage, setIsSendingMessage] = useState(false)
  const [pendingApprovals, setPendingApprovals] = useState<BashApprovalRequest[]>([])

  const context: DesktopWorkbenchContext = {
    runtime,
    agents,
    sessions,
    selectedSessionId,
    messages,
    composerText,
    isLoading,
    isSendingMessage,
    pendingApprovals,
    setRuntime,
    setAgents,
    setSessions,
    setSelectedSessionId,
    setMessages,
    setComposerText,
    setIsLoading,
    setIsSendingMessage,
    setPendingApprovals
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
        setMessages(workbench.messages)

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

      applyAgentEventToSessions(event, setSessions)

      const eventSessionId = getAgentEventSessionId(event)
      if (!eventSessionId || eventSessionId !== selectedSessionId) {
        return
      }

      applyAgentEventToMessages(event, setMessages)

      if (event.type === 'turn-failed') {
        toast.error(event.error.message)
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
 * 把 Agent 标准事件归并到当前 transcript。
 *
 * @param event - Main 推送的标准 Agent 事件。
 * @param setMessages - React 消息状态 setter。
 * @returns 无返回值。
 * @throws 此方法不会主动抛出错误。
 */
function applyAgentEventToMessages(
  event: AgentEvent,
  setMessages: StateSetter<AgentMessage[]>
): void {
  if (event.type === 'message-appended' || event.type === 'message-completed') {
    if (isDialogMessage(event.message)) {
      setMessages((currentMessages) => upsertTranscriptMessage(currentMessages, event.message))
    }
    return
  }

  if (event.type === 'message-delta') {
    setMessages((currentMessages) => appendTranscriptDelta(currentMessages, event))
  }
}

/**
 * 判断消息是否属于聊天主界面可展示的对话消息。
 *
 * @param message - transcript 中的单条消息。
 * @returns 用户消息或模型消息返回 true，系统消息返回 false。
 * @throws 此方法不会主动抛出错误。
 */
function isDialogMessage(message: AgentMessage): boolean {
  return message.role === 'user' || message.role === 'agent'
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
    event.type === 'turn-started' ||
    event.type === 'message-delta' ||
    event.type === 'message-completed' ||
    event.type === 'turn-cancelled' ||
    event.type === 'turn-failed' ||
    event.type === 'activity-updated' ||
    event.type === 'run-state-changed' ||
    event.type === 'approval-required' ||
    event.type === 'approval-resolved'
  ) {
    return event.sessionId
  }

  if (event.type === 'message-appended') {
    return event.message.sessionId
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
  if (event.type === 'turn-started') {
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
 * 新增或替换 transcript 消息，并替换对应的乐观用户消息。
 *
 * @param messages - 当前 transcript。
 * @param message - 需要写入的消息。
 * @returns 更新后的 transcript。
 * @throws 此方法不会主动抛出错误。
 */
function upsertTranscriptMessage(messages: AgentMessage[], message: AgentMessage): AgentMessage[] {
  const exactIndex = messages.findIndex((candidate) => candidate.messageId === message.messageId)

  if (exactIndex !== -1) {
    return messages.map((candidate) =>
      candidate.messageId === message.messageId ? message : candidate
    )
  }

  if (message.role === 'user') {
    const optimisticIndex = messages.findIndex(
      (candidate) =>
        candidate.messageId.startsWith('optimistic-') &&
        candidate.role === 'user' &&
        candidate.content === message.content
    )

    if (optimisticIndex !== -1) {
      return messages.map((candidate, index) => (index === optimisticIndex ? message : candidate))
    }
  }

  return [...messages, message]
}

/**
 * 把文本增量拼接到 transcript 中的 Agent 消息。
 *
 * @param messages - 当前 transcript。
 * @param event - message-delta 标准事件。
 * @returns 更新后的 transcript。
 * @throws 此方法不会主动抛出错误。
 */
function appendTranscriptDelta(
  messages: AgentMessage[],
  event: Extract<AgentEvent, { type: 'message-delta' }>
): AgentMessage[] {
  const messageIndex = messages.findIndex((message) => message.messageId === event.messageId)

  if (messageIndex === -1) {
    return [
      ...messages,
      {
        messageId: event.messageId,
        agentId: event.agentId,
        sessionId: event.sessionId,
        role: 'agent',
        content: event.delta,
        createdAt: event.occurredAt
      }
    ]
  }

  return messages.map((message) =>
    message.messageId === event.messageId
      ? { ...message, content: `${message.content}${event.delta}` }
      : message
  )
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
  messages: AgentMessage[]
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
    return { runtime, agents, sessions: [], messages: [] }
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
  const messages = firstSession
    ? await api.getMessages({
        agentId: firstSession.agentId,
        sessionId: firstSession.sessionId
      })
    : []

  return { runtime, agents, sessions: nextSessions, messages }
}

export default App
