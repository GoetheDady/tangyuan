import type {
  AgentMessage,
  AgentRunState,
  AgentSessionSummary,
  AgentSummary,
  BashApprovalRequest,
  ModelDescriptor,
  RuntimeSnapshot,
  SessionModelInfo,
  TranscriptSnapshot
} from '@tangyuan/contracts'
import { MessageSquarePlus, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Composer } from '@/components/Composer'
import { Separator } from '@/components/ui/separator'
import { TranscriptMessages } from '@/components/TranscriptMessages'

interface DesktopWorkbenchState {
  runtime: RuntimeSnapshot | null
  agents: AgentSummary[]
  sessions: AgentSessionSummary[]
  selectedSessionId: string | null
  messages: AgentMessage[]
  transcript: TranscriptSnapshot | null
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

interface DesktopWorkbenchContext extends DesktopWorkbenchState, DesktopWorkbenchAction {}

/**
 * 聊天页路由守卫：运行时未就绪时重定向到控制台。
 *
 * @param props - 桌面工作台状态上下文。
 * @returns 聊天页、控制台重定向或加载态。
 * @throws 此组件不会主动抛出错误。
 */
export function ChatGuard(props: { context: DesktopWorkbenchContext }): React.JSX.Element {
  const { agentId } = useParams<{ agentId: string; sessionId: string }>()

  if (props.context.isLoading) {
    return <LoadingScreen />
  }

  if (props.context.runtime?.status !== 'ready') {
    const redirectTarget = agentId ? `/chat/${agentId}` : '/chat/tangyuan'
    return (
      <Navigate to={`/console/providers?redirect=${encodeURIComponent(redirectTarget)}`} replace />
    )
  }

  return <ChatPage context={props.context} />
}

/**
 * 渲染大语言模型对话主界面。
 *
 * @param props - 桌面工作台状态上下文。
 * @returns 聊天主界面组件树。
 * @throws 此组件不会主动抛出错误；交互错误会通过 toast 反馈。
 */
function ChatPage(props: { context: DesktopWorkbenchContext }): React.JSX.Element {
  const { context } = props
  const { agentId, sessionId } = useParams<{ agentId: string; sessionId: string }>()
  const navigate = useNavigate()
  const activeAgentId = agentId ?? context.runtime?.activeAgent.agentId ?? 'tangyuan'

  const activeAgent = useMemo(
    () =>
      context.agents.find((agent) => agent.agentId === activeAgentId) ??
      context.runtime?.activeAgent,
    [context.agents, activeAgentId, context.runtime?.activeAgent]
  )
  const activeAgentDisplayName =
    'displayName' in (activeAgent ?? {})
      ? (activeAgent as AgentSummary).displayName
      : ((activeAgent as { displayName?: string })?.displayName ?? '汤圆')

  // 当 URL 中无 agentId 时补充默认值
  useEffect(() => {
    if (!agentId) {
      navigate(`/chat/${activeAgentId}${sessionId ? `/${sessionId}` : ''}`, { replace: true })
    }
  }, [agentId, activeAgentId, sessionId, navigate])

  const [sessionModelInfo, setSessionModelInfo] = useState<SessionModelInfo | null>(null)
  const [isLoadingModelInfo, setIsLoadingModelInfo] = useState(false)
  const [isSwitchingModel, setIsSwitchingModel] = useState(false)

  // 当选中 session 变化时加载模型信息
  useEffect(() => {
    const currentSessionId = sessionId ?? context.selectedSessionId

    if (!currentSessionId || !activeAgentId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 依赖变化时同步重置状态是预期行为
      setSessionModelInfo(null)
      return
    }

    setIsLoadingModelInfo(true)

    void window.api
      .getSessionModelInfo({
        agentId: activeAgentId,
        sessionId: currentSessionId
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
  }, [sessionId, context.selectedSessionId, activeAgentId])

  // 根据 runtime 中的模型数据计算 selectableModels
  const selectableModels = useMemo<ModelDescriptor[]>(() => {
    if (!context.runtime || !sessionModelInfo) return []

    return context.runtime.models.filter(
      (model) => model.providerId === sessionModelInfo.providerId
    )
  }, [context.runtime, sessionModelInfo])

  async function handleSessionModelChange(providerId: string, modelId: string): Promise<void> {
    const currentSessionId = sessionId ?? context.selectedSessionId

    if (!currentSessionId || !activeAgentId) return

    setIsSwitchingModel(true)

    try {
      const info = await window.api.setSessionModel({
        agentId: activeAgentId,
        sessionId: currentSessionId,
        providerId,
        modelId
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
    const currentSessionId = sessionId ?? context.selectedSessionId

    if (!currentSessionId || !activeAgentId) return

    try {
      const info = await window.api.setSessionThinkingLevel({
        agentId: activeAgentId,
        sessionId: currentSessionId,
        level
      })
      setSessionModelInfo(info)
      toast.success(`已切换到 Thinking Level: ${level}`)
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : '切换 Thinking Level 失败')
    }
  }

  const selectedSession = useMemo(
    () =>
      context.sessions.find((session) => session.sessionId === context.selectedSessionId) ??
      context.sessions[0] ??
      null,
    [context.sessions, context.selectedSessionId]
  )
  const isSelectedSessionRunning = selectedSession?.state === 'running'

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
        title: '新会话'
      })
      context.setSessions((currentSessions) => [
        session,
        ...currentSessions.filter((candidate) => candidate.sessionId !== session.sessionId)
      ])
      context.setSelectedSessionId(session.sessionId)
      context.setMessages([])
      navigate(`/chat/${activeAgentId}/${session.sessionId}`, { replace: true })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建会话失败')
    }
  }

  /**
   * 打开指定会话并读取 transcript。
   *
   * @param session - 用户在会话列表中选择的会话摘要。
   * @returns 无返回值。
   * @throws Preload API 错误会被捕获并通过 toast 反馈。
   */
  const openSession = async (session: AgentSessionSummary): Promise<void> => {
    context.setSelectedSessionId(session.sessionId)

    try {
      const nextMessages = await window.api.getMessages({
        agentId: session.agentId,
        sessionId: session.sessionId
      })
      context.setMessages(nextMessages)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '读取会话消息失败')
    }
  }

  // 当 URL 中有 sessionId 时自动选中对应会话
  useEffect(() => {
    if (sessionId && sessionId !== context.selectedSessionId) {
      const targetSession = context.sessions.find((s) => s.sessionId === sessionId)
      if (targetSession) {
        void openSession(targetSession)
      }
    }
  }, [sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * 向当前会话发送用户消息。
   *
   * @returns 无返回值。
   * @throws Preload API 错误会被捕获并通过 toast 反馈。
   */
  const sendMessage = async (): Promise<void> => {
    const content = context.composerText.trim()

    if (!selectedSession) {
      toast.error('请先创建一个新会话。')
      return
    }

    if (!content) {
      return
    }

    const optimisticMessage: AgentMessage = {
      messageId: `optimistic-${Date.now()}`,
      agentId: selectedSession.agentId,
      sessionId: selectedSession.sessionId,
      role: 'user',
      content,
      createdAt: new Date().toISOString()
    }

    context.setMessages((currentMessages) => [...currentMessages, optimisticMessage])
    context.setComposerText('')
    context.setIsSendingMessage(true)

    try {
      const nextMessages = await window.api.sendMessage({
        agentId: selectedSession.agentId,
        sessionId: selectedSession.sessionId,
        content
      })
      context.setMessages(nextMessages)
      context.setSessions(await window.api.listSessions())
      navigate(`/chat/${activeAgentId}/${selectedSession.sessionId}`, { replace: true })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '发送消息失败')
    } finally {
      context.setIsSendingMessage(false)
    }
  }

  /**
   * 取消当前会话正在运行的模型响应。
   *
   * @returns 无返回值。
   * @throws Preload API 错误会被捕获并通过 toast 反馈。
   */
  const cancelRun = async (): Promise<void> => {
    if (!selectedSession) {
      return
    }

    try {
      await window.api.cancelRun({
        agentId: selectedSession.agentId,
        sessionId: selectedSession.sessionId
      })
      context.setIsSendingMessage(false)
      toast.success('已停止生成')
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : '取消运行失败')
    }
  }

  return (
    <main className="h-screen overflow-hidden bg-background text-foreground">
      <div className="grid h-full min-h-0 grid-cols-[280px_1fr]">
        <aside className="flex min-h-0 flex-col border-r bg-muted/35">
          <div className="border-b px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="grid size-9 place-items-center rounded-md bg-primary text-primary-foreground">
                <Sparkles size={18} aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <h1 className="truncate text-base font-semibold leading-5">
                    {activeAgentDisplayName}
                  </h1>
                </div>
                <p className="text-xs text-muted-foreground">大语言模型对话</p>
              </div>
            </div>
            {context.agents.length > 1 ? (
              <div className="mt-3">
                <select
                  className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                  value={activeAgentId}
                  onChange={(event) => {
                    const nextAgentId = event.target.value
                    navigate(`/chat/${nextAgentId}`, { replace: true })
                    context.setSelectedSessionId(null)
                    context.setMessages([])
                    void window.api.listSessions().then((sessions) => {
                      context.setSessions(sessions.filter((s) => s.agentId === nextAgentId))
                    })
                  }}
                >
                  {context.agents.map((agent) => (
                    <option key={agent.agentId} value={agent.agentId}>
                      {agent.displayName}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>

          <div className="p-4">
            <Button
              className="w-full"
              onClick={() => {
                void createSession()
              }}
            >
              <MessageSquarePlus aria-hidden="true" />
              新会话
            </Button>
          </div>

          <Separator />

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <div className="space-y-1">
              {context.sessions.length ? (
                context.sessions.map((session) => (
                  <button
                    key={session.sessionId}
                    className={`w-full rounded-md px-3 py-2 text-left text-sm transition focus:outline-none focus:ring-1 focus:ring-ring ${
                      session.sessionId === selectedSession?.sessionId
                        ? 'bg-card text-foreground shadow-sm'
                        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                    }`}
                    onClick={() => {
                      void openSession(session)
                      navigate(`/chat/${activeAgentId}/${session.sessionId}`, { replace: true })
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="block truncate font-medium">{session.title}</span>
                      {context.pendingApprovals.filter(
                        (a) => a.sessionId === session.sessionId && a.status === 'pending'
                      ).length > 0 && (
                        <span className="inline-flex size-2 shrink-0 rounded-full bg-red-500" />
                      )}
                    </div>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {formatRunState(session.state)}
                    </span>
                  </button>
                ))
              ) : (
                <div className="rounded-md border bg-card p-3 text-sm text-muted-foreground">
                  暂无会话
                </div>
              )}
            </div>
          </div>
        </aside>

        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          <header className="flex h-16 items-center border-b px-8">
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold">
                {selectedSession?.title ?? '新对话'}
              </h2>
              <p className="text-xs text-muted-foreground">
                {selectedSession ? formatRunState(selectedSession.state) : '创建新会话后开始'}
              </p>
            </div>
          </header>

          <div className="min-h-0 flex-1 px-8 py-7">
            <TranscriptMessages
              messages={context.messages}
              transcript={context.transcript}
              isStreaming={isSelectedSessionRunning}
              sessionId={selectedSession?.sessionId ?? null}
            />
          </div>

          {/* 审批卡片区域 */}
          {selectedSession && context.pendingApprovals.length > 0 && (
            <div className="border-t bg-muted/20 px-8 py-4">
              <div className="mx-auto max-w-3xl space-y-3">
                {context.pendingApprovals
                  .filter(
                    (a) => a.sessionId === selectedSession.sessionId && a.status === 'pending'
                  )
                  .map((approval) => (
                    <div
                      key={approval.approvalId}
                      className="rounded-lg border border-yellow-300 bg-yellow-50 p-4 dark:border-yellow-700 dark:bg-yellow-950"
                    >
                      <div className="mb-2 flex items-center gap-2">
                        <span className="rounded bg-yellow-200 px-2 py-0.5 text-xs font-medium text-yellow-800 dark:bg-yellow-800 dark:text-yellow-200">
                          待审批
                        </span>
                        <span className="text-sm font-medium text-foreground">
                          Bash 命令执行审批
                        </span>
                      </div>
                      <pre className="mb-2 overflow-x-auto rounded bg-muted p-2 text-xs">
                        <code>{approval.command}</code>
                      </pre>
                      <p className="mb-1 text-xs text-muted-foreground">工作目录：{approval.cwd}</p>
                      <p className="mb-3 text-xs text-muted-foreground">
                        {approval.riskDescription}
                      </p>
                      <p className="mb-3 text-xs text-red-600 dark:text-red-400">
                        此命令将以当前 macOS 用户权限执行，请确认操作安全。
                      </p>
                      <div className="flex gap-2">
                        <button
                          className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                          onClick={() => {
                            void window.api.approveBash({
                              approvalId: approval.approvalId
                            })
                          }}
                        >
                          允许本次
                        </button>
                        <button
                          className="inline-flex items-center rounded-md border bg-background px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10"
                          onClick={() => {
                            void window.api.rejectBash({
                              approvalId: approval.approvalId
                            })
                          }}
                        >
                          拒绝
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}

          <footer className="border-t bg-background px-8 py-4">
            <Composer
              value={context.composerText}
              onChange={context.setComposerText}
              onSubmit={() => {
                void sendMessage()
              }}
              placeholder={`给${activeAgentDisplayName}发送消息`}
              isRunning={isSelectedSessionRunning || context.isSendingMessage}
              onCancel={() => {
                void cancelRun()
              }}
              disabled={!selectedSession}
              sessionModelInfo={selectedSession ? sessionModelInfo : null}
              isLoadingModelInfo={isLoadingModelInfo}
              isSwitchingModel={isSwitchingModel}
              providers={context.runtime?.providers ?? []}
              selectableModels={selectableModels}
              onModelChange={(providerId, modelId) => {
                void handleSessionModelChange(providerId, modelId)
              }}
              onThinkingLevelChange={(level) => {
                void handleThinkingLevelChange(level)
              }}
            />
          </footer>
        </section>
      </div>
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
    <main className="grid min-h-screen place-items-center bg-background text-foreground">
      <div className="text-sm text-muted-foreground">正在打开汤圆...</div>
    </main>
  )
}

/**
 * 把内部运行状态枚举转换为用户可读中文。
 *
 * @param state - 会话当前运行状态。
 * @returns 对应的中文展示文案。
 * @throws 此方法不会主动抛出错误。
 */
function formatRunState(state: AgentRunState): string {
  const labels: Record<AgentRunState, string> = {
    idle: '空闲',
    queued: '排队中',
    running: '运行中',
    completed: '已完成',
    cancelled: '已取消',
    failed: '失败'
  }

  return labels[state]
}
