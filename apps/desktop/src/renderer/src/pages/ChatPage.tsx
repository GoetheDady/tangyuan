import type {
  AgentMessage,
  AgentRunState,
  AgentSessionSummary,
  RuntimeSnapshot
} from '@tangyuan/contracts'
import { MessageSquarePlus, Send, Sparkles, StopCircle } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'

interface DesktopWorkbenchState {
  runtime: RuntimeSnapshot | null
  sessions: AgentSessionSummary[]
  selectedSessionId: string | null
  messages: AgentMessage[]
  composerText: string
  isLoading: boolean
  isSendingMessage: boolean
}

interface DesktopWorkbenchAction {
  setRuntime(value: RuntimeSnapshot | null): void
  setSessions(
    value: AgentSessionSummary[] | ((currentValue: AgentSessionSummary[]) => AgentSessionSummary[])
  ): void
  setSelectedSessionId(value: string | null | ((currentValue: string | null) => string | null)): void
  setMessages(value: AgentMessage[] | ((currentValue: AgentMessage[]) => AgentMessage[])): void
  setComposerText(value: string): void
  setIsLoading(value: boolean): void
  setIsSendingMessage(value: boolean): void
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
    const redirectTarget = agentId
      ? `/chat/${agentId}`
      : '/chat/tangyuan'
    return <Navigate to={`/console/providers?redirect=${encodeURIComponent(redirectTarget)}`} replace />
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

  // 当 URL 中的 agentId 与运行时 activeAgent 不同时保持同步
  useEffect(() => {
    if (agentId && agentId !== context.runtime?.activeAgent.agentId) {
      // MVP 只支持当前 activeAgent，后续多 Agent 时扩展
      navigate(`/chat/${context.runtime?.activeAgent.agentId ?? 'tangyuan'}`, { replace: true })
    }
  }, [agentId, context.runtime?.activeAgent.agentId, navigate])

  // 当 URL 中无 agentId 时补充默认值
  useEffect(() => {
    if (!agentId) {
      navigate(`/chat/${activeAgentId}${sessionId ? `/${sessionId}` : ''}`, { replace: true })
    }
  }, [agentId, activeAgentId, sessionId, navigate])

  const selectedSession = useMemo(
    () =>
      context.sessions.find((session) => session.sessionId === context.selectedSessionId) ??
      context.sessions[0] ??
      null,
    [context.sessions, context.selectedSessionId]
  )
  const visibleMessages = useMemo(
    () => context.messages.filter(isDialogMessage),
    [context.messages]
  )
  const isSelectedSessionRunning = selectedSession?.state === 'running'

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
              <div>
                <h1 className="text-base font-semibold leading-5">
                  {context.runtime?.activeAgent.displayName ?? '汤圆'}
                </h1>
                <p className="text-xs text-muted-foreground">大语言模型对话</p>
              </div>
            </div>
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
                    <span className="block truncate font-medium">{session.title}</span>
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
          <header className="flex h-16 items-center justify-between border-b px-8">
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold">
                {selectedSession?.title ?? '新对话'}
              </h2>
              <p className="text-xs text-muted-foreground">
                {selectedSession ? formatRunState(selectedSession.state) : '创建新会话后开始'}
              </p>
            </div>
            {isSelectedSessionRunning ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void cancelRun()
                }}
              >
                <StopCircle aria-hidden="true" />
                停止
              </Button>
            ) : null}
          </header>

          <div
            className="min-h-0 flex-1 overflow-y-auto px-8 py-7"
            data-testid="message-scroll-area"
          >
            <div className="mx-auto flex max-w-3xl flex-col gap-5">
              {visibleMessages.length ? (
                visibleMessages.map((message) => (
                  <article
                    key={message.messageId}
                    className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[76%] min-w-0 rounded-lg px-4 py-3 text-sm leading-6 shadow-sm ${
                        message.role === 'user'
                          ? 'bg-primary text-primary-foreground'
                          : 'border bg-card text-card-foreground'
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-words">{message.content}</p>
                    </div>
                  </article>
                ))
              ) : (
                <div className="grid min-h-[45vh] place-items-center text-center">
                  <div>
                    <div className="mx-auto mb-4 grid size-11 place-items-center rounded-md border bg-card">
                      <Sparkles size={20} aria-hidden="true" />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {selectedSession ? '发送第一条消息开始会话。' : '创建新会话后开始。'}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <footer className="border-t bg-background px-8 py-4">
            <form
              className="mx-auto max-w-3xl"
              onSubmit={(event) => {
                event.preventDefault()
                void sendMessage()
              }}
            >
              <div className="rounded-lg border bg-card p-2 shadow-sm">
                <Label htmlFor="composer" className="sr-only">
                  消息
                </Label>
                <Textarea
                  id="composer"
                  className="max-h-40 min-h-20 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
                  placeholder="给汤圆发送消息"
                  value={context.composerText}
                  onChange={(event) => {
                    context.setComposerText(event.target.value)
                  }}
                  disabled={context.isSendingMessage || isSelectedSessionRunning}
                />
                <div className="flex items-center justify-end">
                  <Button
                    type="submit"
                    size="sm"
                    disabled={
                      context.isSendingMessage ||
                      isSelectedSessionRunning ||
                      !selectedSession ||
                      !context.composerText.trim()
                    }
                  >
                    <Send aria-hidden="true" />
                    {context.isSendingMessage || isSelectedSessionRunning ? '发送中' : '发送'}
                  </Button>
                </div>
              </div>
            </form>
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
    running: '运行中',
    completed: '已完成',
    cancelled: '已取消',
    failed: '失败'
  }

  return labels[state]
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
