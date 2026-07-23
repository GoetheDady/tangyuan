import type {
  AgentSessionSummary,
  AgentSummary,
  BashApprovalRequest,
  ModelDescriptor,
  QuestionClarificationRequest,
  RuntimeSnapshot,
  SessionModelInfo,
  TranscriptSnapshot
} from '@tangyuan/contracts'
import { MessageSquarePlus, Settings } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'

import { BashApprovalCard } from '@/components/BashApprovalCard'
import { QuestionClarificationCard } from '@/components/QuestionClarificationCard'
import { Button } from '@/components/ui/button'
import { Composer } from '@/components/Composer'
import { TranscriptMessages } from '@/components/TranscriptMessages'

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

interface DesktopWorkbenchContext extends DesktopWorkbenchState, DesktopWorkbenchAction {}

function getAgentInitial(displayName: string): string {
  return Array.from(displayName.trim())[0] ?? '汤'
}

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
  // 响应等待提示信号：正在发送、排队或运行中。具体是否展示占位
  // 由 TranscriptMessages 根据本次执行尝试是否已有可见回复内容判定。
  const isAwaitingResponse =
    context.isSendingMessage ||
    selectedSession?.state === 'running' ||
    selectedSession?.state === 'queued'
  const selectedTranscript =
    context.transcript?.sessionId === selectedSession?.sessionId ? context.transcript : null

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
      context.setTranscript(null)
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
      const nextTranscript = await window.api.getTranscript({
        agentId: session.agentId,
        sessionId: session.sessionId
      })
      context.setTranscript(nextTranscript)
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

    context.setComposerText('')
    context.setIsSendingMessage(true)

    try {
      const nextTranscript = await window.api.sendMessage({
        agentId: selectedSession.agentId,
        sessionId: selectedSession.sessionId,
        content
      })
      context.setTranscript(nextTranscript)
      context.setSessions(await window.api.listSessions())
      navigate(`/chat/${activeAgentId}/${selectedSession.sessionId}`, { replace: true })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '发送消息失败')
    } finally {
      context.setIsSendingMessage(false)
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

    context.setIsSendingMessage(true)

    try {
      const nextTranscript = await window.api.retryMessage({
        agentId: selectedSession.agentId,
        sessionId: selectedSession.sessionId,
        userMessageId
      })
      context.setTranscript(nextTranscript)
      context.setSessions(await window.api.listSessions())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '重试消息失败')
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

  const sessionGroups = useMemo(() => {
    const today = new Date().toDateString()
    const groups = [
      {
        label: '今天',
        sessions: context.sessions.filter(
          (session) => new Date(session.updatedAt).toDateString() === today
        )
      },
      {
        label: '更早',
        sessions: context.sessions.filter(
          (session) => new Date(session.updatedAt).toDateString() !== today
        )
      }
    ]

    return groups.filter((group) => group.sessions.length > 0)
  }, [context.sessions])

  async function handleAgentChange(nextAgentId: string): Promise<void> {
    navigate(`/chat/${nextAgentId}`, { replace: true })
    context.setSelectedSessionId(null)
    context.setTranscript(null)

    try {
      const sessions = await window.api.listSessions()
      context.setSessions(sessions.filter((session) => session.agentId === nextAgentId))
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : '加载 Agent 会话失败')
    }
  }

  return (
    <main className="h-full overflow-hidden bg-background text-foreground">
      <h1 className="sr-only">{activeAgentDisplayName}</h1>
      <p className="sr-only">大语言模型对话</p>
      <div className="grid h-full min-h-0 grid-cols-[292px_minmax(0,1fr)]">
        <aside
          data-testid="chat-sidebar"
          className="grid min-h-0 grid-cols-[76px_216px] border-r border-border bg-sidebar"
        >
          <nav
            aria-label="Agent 切换"
            data-testid="chat-agent-rail"
            className="window-no-drag relative z-50 flex min-h-0 flex-col items-center gap-2.5 border-r border-sidebar-border bg-background px-2.5 py-2"
          >
            <div aria-hidden="true" className="h-9 shrink-0" />

            {context.agents
              .filter((agent) => agent.status === 'active')
              .map((agent) => {
                const isActive = agent.agentId === activeAgentId
                return (
                  <button
                    key={agent.agentId}
                    type="button"
                    aria-label={`切换到 Agent ${agent.displayName}`}
                    aria-current={isActive ? 'page' : undefined}
                    title={agent.displayName}
                    className={`window-no-drag grid size-9 shrink-0 place-items-center rounded-[10px] border text-label font-semibold transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
                      isActive
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-secondary text-foreground hover:bg-accent'
                    }`}
                    onClick={() => {
                      void handleAgentChange(agent.agentId)
                    }}
                  >
                    {getAgentInitial(agent.displayName)}
                  </button>
                )
              })}

            <div className="min-h-0 flex-1" />
            <button
              type="button"
              aria-label="设置"
              title="设置"
              className="window-no-drag grid size-9 shrink-0 place-items-center rounded-[10px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              onClick={() => {
                navigate('/console/providers')
              }}
            >
              <Settings size={16} aria-hidden="true" />
            </button>
          </nav>

          <section
            data-testid="chat-session-pane"
            className="flex min-h-0 min-w-0 flex-col bg-sidebar"
          >
            <div className="window-no-drag relative z-50 p-[8px_10px_10px]">
              <Button
                className="h-9 w-full gap-1.5 rounded-lg px-2 text-caption font-semibold"
                onClick={() => {
                  void createSession()
                }}
              >
                <MessageSquarePlus data-icon="inline-start" size={14} aria-hidden="true" />
                新建会话
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
              {sessionGroups.length > 0 ? (
                <div className="flex flex-col gap-0.5">
                  {sessionGroups.map((group) => (
                    <div key={group.label} role="group" aria-label={group.label}>
                      <p className="flex h-5 items-center px-2.5 font-mono text-[8px] font-semibold text-muted-foreground">
                        {group.label}
                      </p>
                      {group.sessions.map((session) => {
                        const isSelected = session.sessionId === selectedSession?.sessionId
                        const hasPendingApproval = context.pendingApprovals.some(
                          (approval) =>
                            approval.sessionId === session.sessionId &&
                            approval.status === 'pending'
                        )
                        const isRunning = session.state === 'running' || session.state === 'queued'

                        return (
                          <button
                            key={session.sessionId}
                            type="button"
                            className={`flex h-10 w-full cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-left text-caption transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
                              isSelected
                                ? 'bg-secondary text-foreground'
                                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                            }`}
                            onClick={() => {
                              void openSession(session)
                              navigate(`/chat/${activeAgentId}/${session.sessionId}`, {
                                replace: true
                              })
                            }}
                          >
                            <span
                              className={`min-w-0 flex-1 truncate text-body ${isSelected ? 'font-semibold' : 'font-medium'}`}
                            >
                              {session.title}
                            </span>
                            {(isRunning || hasPendingApproval) && (
                              <>
                                <span
                                  aria-hidden="true"
                                  title={hasPendingApproval ? '待审批' : '运行中'}
                                  className={`size-1.5 shrink-0 rounded-full ${
                                    hasPendingApproval ? 'bg-warning' : 'bg-info'
                                  }`}
                                />
                                <span className="sr-only">
                                  {hasPendingApproval ? '待审批' : '运行中'}
                                </span>
                              </>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-2.5 py-3 text-caption text-muted-foreground">
                  <p className="font-medium">暂无会话</p>
                  <p className="mt-1 text-[10px]">新建会话后会显示在这里</p>
                </div>
              )}
            </div>
          </section>
        </aside>

        <section data-testid="chat-main" className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          <header
            data-testid="chat-header"
            className="flex h-12 shrink-0 items-center border-b border-border px-[18px]"
          >
            <h2 className="truncate text-section-heading font-semibold">{selectedSession?.title ?? '新对话'}</h2>
          </header>

          <div className="min-h-0 flex-1 px-4">
            <TranscriptMessages
              key={selectedSession?.sessionId ?? 'no-session'}
              transcript={selectedTranscript}
              isStreaming={isSelectedSessionRunning}
              isAwaitingResponse={isAwaitingResponse}
              sessionId={selectedSession?.sessionId ?? null}
              onRetry={(userMessageId) => {
                void retryMessage(userMessageId)
              }}
            />
          </div>

          {selectedSession && context.pendingApprovals.length > 0 && (
            <div className="shrink-0 bg-background px-4 py-2">
              <div className="mx-auto max-w-[720px] space-y-2">
                {context.pendingApprovals
                  .filter(
                    (approval) =>
                      approval.sessionId === selectedSession.sessionId &&
                      approval.status === 'pending'
                  )
                  .map((approval) => (
                    <BashApprovalCard
                      key={approval.approvalId}
                      approval={approval}
                      onApproveOnce={async (approvalId) => {
                        await window.api.approveBash({ approvalId })
                      }}
                      onApproveAlways={async (approvalId) => {
                        context.addAlwaysAllowedCommand(approval.sessionId, approval.command)
                        await window.api.approveBash({ approvalId })
                      }}
                      onReject={async (approvalId) => {
                        await window.api.rejectBash({ approvalId })
                      }}
                    />
                  ))}
              </div>
            </div>
          )}

          {selectedSession && context.pendingClarifications.length > 0 && (
            <div className="shrink-0 bg-background px-4 py-2">
              <div className="mx-auto max-w-[720px] space-y-2">
                {context.pendingClarifications
                  .filter(
                    (clarification) =>
                      clarification.sessionId === selectedSession.sessionId &&
                      clarification.status === 'pending'
                  )
                  .map((clarification) => (
                    <QuestionClarificationCard
                      key={clarification.clarificationId}
                      clarification={clarification}
                      onAnswer={async (clarificationId, answer) => {
                        await window.api.answerClarification({ clarificationId, answer })
                      }}
                      onCancel={async (clarificationId) => {
                        await window.api.cancelClarification({ clarificationId })
                      }}
                    />
                  ))}
              </div>
            </div>
          )}

          <footer
            data-testid="chat-composer-area"
            className="shrink-0 bg-background px-4 pb-[6px] pt-[5px]"
          >
            <Composer
              value={context.composerText}
              onChange={context.setComposerText}
              onSubmit={() => {
                void sendMessage()
              }}
              placeholder={
                selectedSession ? '继续输入...' : `给${activeAgentDisplayName}发送消息...`
              }
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
    <main className="grid min-h-full place-items-center bg-background text-foreground">
      <div className="text-body text-muted-foreground">正在打开汤圆...</div>
    </main>
  )
}
