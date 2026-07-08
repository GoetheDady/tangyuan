import type {
  AgentEvent,
  AgentMessage,
  AgentRunState,
  AgentSessionSummary,
  DesktopPreloadApi,
  RuntimeConfiguration,
  RuntimeSnapshot
} from '@tangyuan/shared'
import {
  Ban,
  CheckCircle2,
  Clock3,
  KeyRound,
  MessageSquarePlus,
  RefreshCcw,
  Settings2,
  TriangleAlert
} from 'lucide-react'
import { animate } from 'motion'
import { motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'

/**
 * 渲染桌面端 v1 的最小可用工作台首页。
 *
 * @returns React 组件树，展示运行时状态、会话入口和基础操作按钮。
 * @throws 此组件不会主动抛出错误；Preload API 错误会显示到界面状态里。
 */
function App(): React.JSX.Element {
  const statusDotRef = useRef<HTMLSpanElement>(null)
  const [runtime, setRuntime] = useState<RuntimeSnapshot | null>(null)
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [composerText, setComposerText] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSendingMessage, setIsSendingMessage] = useState(false)
  const [isVerifyingConfiguration, setIsVerifyingConfiguration] = useState(false)
  const [isConfigurationVisible, setIsConfigurationVisible] = useState(false)
  const [configurationForm, setConfigurationForm] = useState<RuntimeConfiguration>({
    providerId: '',
    modelId: '',
    apiKey: ''
  })
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!statusDotRef.current) return

    const tween = gsap.to(statusDotRef.current, {
      scale: 1.18,
      duration: 0.9,
      repeat: -1,
      yoyo: true,
      ease: 'power1.inOut'
    })

    return () => {
      tween.kill()
    }
  }, [])

  useEffect(() => {
    let isMounted = true

    void loadDesktopWorkbench(window.api)
      .then((workbench) => {
        if (!isMounted) return

        setRuntime(workbench.runtime)
        setSessions(workbench.sessions)
        setSelectedSessionId(
          (currentSessionId) => currentSessionId ?? workbench.sessions[0]?.sessionId ?? null
        )
        setMessages(workbench.messages)
        setConfigurationForm((currentForm) => ({
          providerId: currentForm.providerId || workbench.runtime.settings.selectedProviderId || '',
          modelId: currentForm.modelId || workbench.runtime.settings.selectedModelId || '',
          apiKey: ''
        }))
        setErrorMessage(null)
      })
      .catch((error: unknown) => {
        if (!isMounted) return

        setErrorMessage(error instanceof Error ? error.message : '无法读取桌面端运行时状态')
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    return window.api.subscribeToAgentEvents((event) => {
      if (event.type === 'profile-updated') {
        void window.api
          .refreshRuntime()
          .then((nextRuntime) => {
            setRuntime(nextRuntime)
          })
          .catch((error: unknown) => {
            setErrorMessage(error instanceof Error ? error.message : '刷新 Profile 状态失败')
          })
      }

      applyAgentEventToSessions(event, setSessions)

      const eventSessionId = getAgentEventSessionId(event)
      if (!eventSessionId || eventSessionId !== selectedSessionId) {
        return
      }

      applyAgentEventToMessages(event, setMessages)

      if (
        event.type === 'turn-cancelled' ||
        event.type === 'turn-failed' ||
        (event.type === 'run-state-changed' && event.state !== 'running')
      ) {
        setIsSendingMessage(false)
      }
    })
  }, [selectedSessionId])

  /**
   * 刷新运行时资源并更新界面状态。
   *
   * @returns 无返回值。
   * @throws Preload API 错误会被捕获并写入 errorMessage。
   */
  const refreshRuntime = async (): Promise<void> => {
    void animate('#refresh-icon', { rotate: 360 }, { duration: 0.55 })

    try {
      const nextRuntime = await window.api.refreshRuntime()
      setRuntime(nextRuntime)
      setErrorMessage(null)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '刷新运行时资源失败')
    }
  }

  /**
   * 保存配置前调用 Main 侧真实 Pi SDK 验证流程。
   *
   * @returns 无返回值。
   * @throws Preload API 错误会被捕获并写入 errorMessage。
   */
  const saveConfiguration = async (): Promise<void> => {
    setIsVerifyingConfiguration(true)
    setErrorMessage(null)

    try {
      const nextRuntime = await window.api.saveRuntimeConfiguration(configurationForm)
      setRuntime(nextRuntime)
      setIsConfigurationVisible(false)
      setConfigurationForm({
        providerId: nextRuntime.settings.selectedProviderId ?? configurationForm.providerId,
        modelId: nextRuntime.settings.selectedModelId ?? configurationForm.modelId,
        apiKey: ''
      })
      await openBootstrapSessionIfRequired(nextRuntime)
      setErrorMessage(null)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '配置验证失败')
    } finally {
      setIsVerifyingConfiguration(false)
    }
  }

  /**
   * 取消当前配置验证。
   *
   * @returns 无返回值。
   * @throws Preload API 错误会被捕获并写入 errorMessage。
   */
  const cancelConfigurationVerification = async (): Promise<void> => {
    try {
      const nextRuntime = await window.api.cancelRuntimeConfigurationVerification({
        verificationId: 'current'
      })
      setRuntime(nextRuntime)
      setErrorMessage('已取消配置验证。')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '取消配置验证失败')
    } finally {
      setIsVerifyingConfiguration(false)
    }
  }

  /**
   * 创建默认 Agent 的新会话并放到列表顶部。
   *
   * @returns 无返回值。
   * @throws Preload API 错误会被捕获并写入 errorMessage。
   */
  const createSession = async (): Promise<void> => {
    try {
      const session = await window.api.createSession({
        agentId: runtime?.activeAgent.agentId ?? 'tangyuan',
        title: '新会话'
      })
      setSessions((currentSessions) => [
        session,
        ...currentSessions.filter((candidate) => candidate.sessionId !== session.sessionId)
      ])
      setSelectedSessionId(session.sessionId)
      setMessages([])
      setErrorMessage(null)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '创建会话失败')
    }
  }

  /**
   * 在首次 profile 尚未初始化时创建并选中 bootstrap 会话。
   *
   * @param nextRuntime - 保存配置后得到的最新运行时快照。
   * @returns 无返回值。
   * @throws Preload API 错误会透传给调用方，由保存配置流程统一展示。
   */
  const openBootstrapSessionIfRequired = async (nextRuntime: RuntimeSnapshot): Promise<void> => {
    if (nextRuntime.status !== 'ready' || !nextRuntime.activeAgent.profile.bootstrapRequired) {
      return
    }

    const existingSessions = await window.api.listSessions()

    if (existingSessions.length) {
      const [firstSession] = existingSessions
      setSessions(existingSessions)
      setSelectedSessionId(firstSession.sessionId)
      setMessages(
        await window.api.getMessages({
          agentId: firstSession.agentId,
          sessionId: firstSession.sessionId
        })
      )
      return
    }

    const bootstrapSession = await window.api.createSession({
      agentId: nextRuntime.activeAgent.agentId,
      title: 'Bootstrap 初始化'
    })
    setSessions([bootstrapSession])
    setSelectedSessionId(bootstrapSession.sessionId)
    setMessages([])
  }

  /**
   * 打开指定会话并读取 transcript。
   *
   * @param session - 用户在会话列表中选择的会话摘要。
   * @returns 无返回值。
   * @throws Preload API 错误会被捕获并写入 errorMessage。
   */
  const openSession = async (session: AgentSessionSummary): Promise<void> => {
    setSelectedSessionId(session.sessionId)

    try {
      const nextMessages = await window.api.getMessages({
        agentId: session.agentId,
        sessionId: session.sessionId
      })
      setMessages(nextMessages)
      setErrorMessage(null)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '读取会话消息失败')
    }
  }

  /**
   * 向当前会话发送用户消息。
   *
   * @returns 无返回值。
   * @throws Preload API 错误会被捕获并写入 errorMessage。
   */
  const sendMessage = async (): Promise<void> => {
    const selectedSession = sessions.find((session) => session.sessionId === selectedSessionId)
    const content = composerText.trim()

    if (!selectedSession) {
      setErrorMessage('请先创建一个新会话。')
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
    setMessages((currentMessages) => [...currentMessages, optimisticMessage])
    setComposerText('')
    setIsSendingMessage(true)
    setErrorMessage(null)

    try {
      const nextMessages = await window.api.sendMessage({
        agentId: selectedSession.agentId,
        sessionId: selectedSession.sessionId,
        content
      })
      setMessages(nextMessages)
      setSessions(await window.api.listSessions())
      setErrorMessage(null)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '发送消息失败')
    } finally {
      setIsSendingMessage(false)
    }
  }

  const selectedSession =
    sessions.find((session) => session.sessionId === selectedSessionId) ?? sessions[0] ?? null
  const statusLabel = isLoading
    ? '正在读取运行时'
    : runtime?.status === 'ready'
      ? '已就绪'
      : '缺少配置'
  const providerLabel = runtime?.settings.selectedProviderId ?? '未配置'
  const modelLabel = runtime?.settings.selectedModelId ?? '未选择'
  const apiKeyLabel = runtime?.auth.apiKey.configured
    ? (runtime.auth.apiKey.maskedValue ?? '已保存')
    : '未保存'
  const isRuntimeReady = runtime?.status === 'ready'
  const isSelectedSessionRunning = selectedSession?.state === 'running'

  if (!isRuntimeReady || isConfigurationVisible) {
    return (
      <main className="min-h-screen bg-background px-8 py-7 text-text">
        <motion.section
          className="mx-auto grid min-h-[calc(100vh-3.5rem)] max-w-5xl grid-cols-[320px_1fr] overflow-hidden rounded-lg border border-border bg-surface shadow-sm"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
        >
          <aside className="border-r border-border bg-surface-soft/70 p-6">
            <div className="mb-7 flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-md bg-brand text-surface">
                <KeyRound size={20} aria-hidden="true" />
              </div>
              <div>
                <h1 className="text-lg font-semibold leading-6">汤圆</h1>
                <p className="text-sm text-text-muted">桌面智能体工作台</p>
              </div>
            </div>

            <dl className="space-y-4 text-sm">
              <div>
                <dt className="text-text-muted">就绪状态</dt>
                <dd className="mt-1 font-medium">{statusLabel}</dd>
              </div>
              <div>
                <dt className="text-text-muted">接口密钥</dt>
                <dd className="mt-1 font-medium">{apiKeyLabel}</dd>
              </div>
              <div>
                <dt className="text-text-muted">模型服务</dt>
                <dd className="mt-1 font-medium">{providerLabel}</dd>
              </div>
              <div>
                <dt className="text-text-muted">模型</dt>
                <dd className="mt-1 font-medium">{modelLabel}</dd>
              </div>
            </dl>
          </aside>

          <section className="flex flex-col">
            <header className="flex items-center justify-between border-b border-border px-6 py-4">
              <div>
                <p className="text-sm text-text-muted">Pi SDK 验证</p>
                <h2 className="text-xl font-semibold leading-7">配置模型服务</h2>
              </div>
              <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm">
                <span
                  ref={statusDotRef}
                  className={`size-2 rounded-full ${runtime?.status === 'ready' ? 'bg-success' : 'bg-danger'}`}
                />
                {statusLabel}
              </div>
            </header>

            <div className="grid flex-1 grid-cols-[1fr_280px]">
              <form
                className="space-y-5 p-6"
                onSubmit={(event) => {
                  event.preventDefault()
                  void saveConfiguration()
                }}
              >
                <label className="block text-sm font-medium">
                  Provider
                  <input
                    className="mt-2 h-10 w-full rounded-md border border-border bg-surface px-3 text-sm outline-none focus:ring-2 focus:ring-focus"
                    list="provider-options"
                    value={configurationForm.providerId}
                    onChange={(event) => {
                      setConfigurationForm((currentForm) => ({
                        ...currentForm,
                        providerId: event.target.value
                      }))
                    }}
                    disabled={isVerifyingConfiguration}
                  />
                </label>
                <datalist id="provider-options">
                  {runtime?.providers.map((provider) => (
                    <option key={provider.providerId} value={provider.providerId}>
                      {provider.displayName}
                    </option>
                  ))}
                </datalist>

                <label className="block text-sm font-medium">
                  Model
                  <input
                    className="mt-2 h-10 w-full rounded-md border border-border bg-surface px-3 text-sm outline-none focus:ring-2 focus:ring-focus"
                    list="model-options"
                    value={configurationForm.modelId}
                    onChange={(event) => {
                      setConfigurationForm((currentForm) => ({
                        ...currentForm,
                        modelId: event.target.value
                      }))
                    }}
                    disabled={isVerifyingConfiguration}
                  />
                </label>
                <datalist id="model-options">
                  {runtime?.models
                    .filter(
                      (model) =>
                        !configurationForm.providerId ||
                        model.providerId === configurationForm.providerId
                    )
                    .map((model) => (
                      <option key={`${model.providerId}:${model.modelId}`} value={model.modelId}>
                        {model.displayName}
                      </option>
                    ))}
                </datalist>

                <label className="block text-sm font-medium">
                  API Key
                  <input
                    className="mt-2 h-10 w-full rounded-md border border-border bg-surface px-3 text-sm outline-none focus:ring-2 focus:ring-focus"
                    type="password"
                    value={configurationForm.apiKey}
                    onChange={(event) => {
                      setConfigurationForm((currentForm) => ({
                        ...currentForm,
                        apiKey: event.target.value
                      }))
                    }}
                    disabled={isVerifyingConfiguration}
                  />
                </label>

                <div className="flex gap-3">
                  <button
                    className="flex h-10 min-w-36 items-center justify-center gap-2 rounded-md bg-brand px-4 text-sm font-medium text-surface transition hover:bg-brand-soft focus:outline-none focus:ring-2 focus:ring-focus disabled:cursor-not-allowed disabled:opacity-60"
                    type="submit"
                    disabled={isVerifyingConfiguration || isLoading}
                  >
                    <CheckCircle2 size={16} aria-hidden="true" />
                    {isVerifyingConfiguration ? '验证中' : '验证并保存'}
                  </button>
                  {isVerifyingConfiguration ? (
                    <button
                      className="flex h-10 min-w-28 items-center justify-center gap-2 rounded-md border border-border bg-surface px-4 text-sm font-medium transition hover:bg-surface-soft focus:outline-none focus:ring-2 focus:ring-focus"
                      type="button"
                      onClick={() => {
                        void cancelConfigurationVerification()
                      }}
                    >
                      <Ban size={16} aria-hidden="true" />
                      取消验证
                    </button>
                  ) : null}
                </div>
              </form>

              <aside className="border-l border-border bg-surface-soft/50 p-5">
                <p className="mb-3 text-sm font-medium">运行时资源</p>
                <button
                  className="mb-4 flex h-10 w-full items-center justify-center gap-2 rounded-md border border-border bg-surface px-3 text-sm font-medium transition hover:bg-surface-soft focus:outline-none focus:ring-2 focus:ring-focus"
                  onClick={() => {
                    void refreshRuntime()
                  }}
                >
                  <RefreshCcw id="refresh-icon" size={16} aria-hidden="true" />
                  刷新资源
                </button>
                <div className="rounded-md border border-border bg-surface p-3 text-sm text-text-muted">
                  {errorMessage ?? '配置通过验证后才会保存，并进入会话工作台。'}
                </div>
              </aside>
            </div>
          </section>
        </motion.section>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-background px-8 py-7 text-text">
      <motion.section
        className="mx-auto grid min-h-[calc(100vh-3.5rem)] max-w-6xl grid-cols-[280px_1fr] overflow-hidden rounded-lg border border-border bg-surface shadow-sm"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        <aside className="border-r border-border bg-surface-soft/70 p-5">
          <div className="mb-7 flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-md bg-brand text-surface">
              <MessageSquarePlus size={20} aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-lg font-semibold leading-6">汤圆</h1>
              <p className="text-sm text-text-muted">桌面智能体工作台</p>
            </div>
          </div>

          <button
            className="mb-5 flex h-10 w-full items-center justify-center gap-2 rounded-md bg-brand px-3 text-sm font-medium text-surface transition hover:bg-brand-soft focus:outline-none focus:ring-2 focus:ring-focus"
            onClick={() => {
              void createSession()
            }}
          >
            <MessageSquarePlus size={16} aria-hidden="true" />
            新会话
          </button>

          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-text-muted">会话</p>
            {sessions.length ? (
              sessions.map((session) => (
                <button
                  key={session.sessionId}
                  className={`w-full rounded-md border p-3 text-left transition focus:outline-none focus:ring-2 focus:ring-focus ${
                    session.sessionId === selectedSession?.sessionId
                      ? 'border-brand bg-surface'
                      : 'border-border bg-surface hover:bg-surface-soft'
                  }`}
                  onClick={() => {
                    void openSession(session)
                  }}
                >
                  <p className="text-sm font-medium">{session.title}</p>
                  <p className="mt-1 text-xs text-text-muted">{formatRunState(session.state)}</p>
                </button>
              ))
            ) : (
              <div className="rounded-md border border-border bg-surface p-3 text-sm text-text-muted">
                暂无会话
              </div>
            )}
          </div>
        </aside>

        <section className="flex flex-col">
          <header className="flex items-center justify-between border-b border-border px-6 py-4">
            <div>
              <p className="text-sm text-text-muted">v1 就绪状态</p>
              <h2 className="text-xl font-semibold leading-7">Pi 智能体工具包会话闭环基础</h2>
            </div>
            <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm">
              <span
                ref={statusDotRef}
                className={`size-2 rounded-full ${runtime?.status === 'ready' ? 'bg-success' : 'bg-danger'}`}
              />
              {statusLabel}
            </div>
          </header>

          <div className="grid flex-1 grid-cols-[1fr_300px] gap-0">
            <div className="flex min-h-0 flex-col p-6">
              <div className="mb-5 grid grid-cols-2 gap-4">
                <div className="rounded-md border border-border bg-surface p-4">
                  <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                    <Settings2 size={16} aria-hidden="true" />
                    运行时快照
                  </div>
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-text-muted">智能体</dt>
                      <dd className="font-medium">{runtime?.activeAgent.agentId ?? 'tangyuan'}</dd>
                    </div>
                    <div>
                      <dt className="text-text-muted">模型服务</dt>
                      <dd className="font-medium">{providerLabel}</dd>
                    </div>
                    <div>
                      <dt className="text-text-muted">模型</dt>
                      <dd className="font-medium">{modelLabel}</dd>
                    </div>
                    <div>
                      <dt className="text-text-muted">接口密钥</dt>
                      <dd className="font-medium">{apiKeyLabel}</dd>
                    </div>
                  </dl>
                  <div className="mt-3 text-xs text-text-muted">
                    这里展示的是运行时快照，也就是给界面看的整理后数据，不直接暴露底层 SDK 细节。
                  </div>
                </div>

                <div className="rounded-md border border-border bg-surface p-4">
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <CheckCircle2 size={16} aria-hidden="true" />
                    Profile
                  </div>
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-text-muted">初始化状态</dt>
                      <dd className="font-medium">
                        {runtime?.activeAgent.profile.initialized ? '已初始化' : '未初始化'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-text-muted">Bootstrap</dt>
                      <dd className="font-medium">
                        {runtime?.activeAgent.profile.bootstrapRequired
                          ? '需要初始化'
                          : '可直接使用'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-text-muted">soul.md 更新时间</dt>
                      <dd className="font-medium">
                        {formatTimestamp(runtime?.activeAgent.profile.soulUpdatedAt)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-text-muted">user.md 更新时间</dt>
                      <dd className="font-medium">
                        {formatTimestamp(runtime?.activeAgent.profile.userUpdatedAt)}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-3 flex items-start gap-2 rounded-md border border-border bg-surface-soft px-3 py-2 text-xs text-text-muted">
                    {runtime?.activeAgent.profile.bootstrapRequired ? (
                      <TriangleAlert
                        size={14}
                        className="mt-0.5 shrink-0 text-warning"
                        aria-hidden="true"
                      />
                    ) : (
                      <Clock3
                        size={14}
                        className="mt-0.5 shrink-0 text-text-muted"
                        aria-hidden="true"
                      />
                    )}
                    <span>
                      {runtime?.activeAgent.profile.bootstrapRequired
                        ? '首次启动会生成 bootstrap.md，完成初始化后再进入普通会话。'
                        : 'bootstrap.md 已完成或不再需要，当前 profile 可以继续沿用。'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex min-h-0 flex-1 flex-col rounded-md border border-border bg-surface">
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">
                      {selectedSession?.title ?? '尚未选择会话'}
                    </p>
                    <p className="text-xs text-text-muted">
                      {selectedSession ? formatRunState(selectedSession.state) : '创建会话后开始'}
                    </p>
                  </div>
                  {selectedSession?.state === 'running' ? (
                    <button
                      className="flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-surface px-3 text-sm font-medium transition hover:bg-surface-soft focus:outline-none focus:ring-2 focus:ring-focus"
                      onClick={() => {
                        void window.api
                          .cancelRun({
                            agentId: selectedSession.agentId,
                            sessionId: selectedSession.sessionId
                          })
                          .then((nextSession) => {
                            setSessions((currentSessions) =>
                              currentSessions.map((session) =>
                                session.sessionId === nextSession.sessionId ? nextSession : session
                              )
                            )
                          })
                          .catch((error: unknown) => {
                            setErrorMessage(error instanceof Error ? error.message : '取消运行失败')
                          })
                      }}
                    >
                      <Ban size={16} aria-hidden="true" />
                      取消
                    </button>
                  ) : null}
                </div>

                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                  {messages.length ? (
                    messages.map((message) => (
                      <article
                        key={message.messageId}
                        className={`max-w-[84%] rounded-md border px-3 py-2 text-sm ${
                          message.role === 'user'
                            ? 'ml-auto border-brand bg-brand text-surface'
                            : 'border-border bg-surface-soft text-text'
                        }`}
                      >
                        <p className="mb-1 text-xs opacity-75">{formatMessageRole(message.role)}</p>
                        <p className="whitespace-pre-wrap leading-6">{message.content}</p>
                      </article>
                    ))
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-text-muted">
                      {selectedSession ? '发送第一条消息开始会话。' : '创建新会话后开始。'}
                    </div>
                  )}
                </div>

                <form
                  className="border-t border-border p-3"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void sendMessage()
                  }}
                >
                  <label className="sr-only" htmlFor="composer">
                    消息
                  </label>
                  <textarea
                    id="composer"
                    className="min-h-24 w-full resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-focus"
                    value={composerText}
                    onChange={(event) => {
                      setComposerText(event.target.value)
                    }}
                    disabled={isSendingMessage || isSelectedSessionRunning}
                    aria-busy={isSelectedSessionRunning}
                  />
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <p className="text-xs text-text-muted">
                      {errorMessage ?? '消息会通过 Preload API 进入 Main，再由 Pi SDK 会话处理。'}
                    </p>
                    <button
                      className="flex h-10 min-w-24 items-center justify-center gap-2 rounded-md bg-brand px-4 text-sm font-medium text-surface transition hover:bg-brand-soft focus:outline-none focus:ring-2 focus:ring-focus disabled:cursor-not-allowed disabled:opacity-60"
                      type="submit"
                      disabled={
                        isSendingMessage ||
                        isSelectedSessionRunning ||
                        !selectedSession ||
                        !composerText.trim()
                      }
                    >
                      <MessageSquarePlus size={16} aria-hidden="true" />
                      {isSendingMessage ? '发送中' : '发送'}
                    </button>
                  </div>
                </form>
              </div>
            </div>

            <aside className="border-l border-border bg-surface-soft/50 p-5">
              <p className="mb-3 text-sm font-medium">运行时控制</p>
              <div className="space-y-3">
                <button
                  className="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-border bg-surface px-3 text-sm font-medium transition hover:bg-surface-soft focus:outline-none focus:ring-2 focus:ring-focus"
                  onClick={() => {
                    setIsConfigurationVisible(true)
                  }}
                >
                  <KeyRound size={16} aria-hidden="true" />
                  配置接口密钥
                </button>
                <button
                  className="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-border bg-surface px-3 text-sm font-medium transition hover:bg-surface-soft focus:outline-none focus:ring-2 focus:ring-focus"
                  onClick={() => {
                    void refreshRuntime()
                  }}
                >
                  <RefreshCcw id="refresh-icon" size={16} aria-hidden="true" />
                  刷新资源
                </button>
              </div>
            </aside>
          </div>
        </section>
      </motion.section>
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
 * 把消息角色转换为用户可读中文。
 *
 * @param role - transcript 消息来源。
 * @returns 对应的中文展示文案。
 * @throws 此方法不会主动抛出错误。
 */
function formatMessageRole(role: AgentMessage['role']): string {
  const labels: Record<AgentMessage['role'], string> = {
    user: '你',
    agent: '汤圆',
    system: '系统'
  }

  return labels[role]
}

/**
 * 格式化 profile 文件更新时间。
 *
 * @param value - 文件更新时间的 ISO 字符串。
 * @returns 可展示的时间文本，缺失时显示“未记录”。
 * @throws 此方法不会主动抛出错误。
 */
function formatTimestamp(value: string | null | undefined): string {
  return value ?? '未记录'
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
    setMessages((currentMessages) => upsertTranscriptMessage(currentMessages, event.message))
    return
  }

  if (event.type === 'message-delta') {
    setMessages((currentMessages) => appendTranscriptDelta(currentMessages, event))
    return
  }

  if (event.type === 'activity-updated') {
    setMessages((currentMessages) =>
      upsertTranscriptMessage(currentMessages, {
        messageId: `${event.sessionId}-${event.runId}-${event.activity.kind}`,
        agentId: event.agentId,
        sessionId: event.sessionId,
        role: 'system',
        content: event.activity.label,
        createdAt: event.occurredAt
      })
    )
    return
  }

  if (event.type === 'turn-failed') {
    setMessages((currentMessages) =>
      upsertTranscriptMessage(currentMessages, {
        messageId: `${event.sessionId}-${event.runId}-error`,
        agentId: event.agentId,
        sessionId: event.sessionId,
        role: 'system',
        content: event.error.message,
        createdAt: event.occurredAt
      })
    )
  }
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
    event.type === 'run-state-changed'
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
function getAgentEventRunState(event: AgentEvent): AgentRunState | null {
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
  sessions: AgentSessionSummary[]
  messages: AgentMessage[]
}> {
  const [runtime, sessions] = await Promise.all([api.getRuntimeSnapshot(), api.listSessions()])
  const nextSessions =
    runtime.status === 'ready' && runtime.activeAgent.profile.bootstrapRequired && !sessions.length
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

  return { runtime, sessions: nextSessions, messages }
}

export default App
