import type {
  AgentRunState,
  AgentSessionSummary,
  DesktopPreloadApi,
  RuntimeSnapshot
} from '@tangyuan/shared'
import {
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
  const [isLoading, setIsLoading] = useState(true)
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
      setErrorMessage(null)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '创建会话失败')
    }
  }

  const selectedSession = sessions[0] ?? null
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
            {selectedSession ? (
              <div className="rounded-md border border-border bg-surface p-3">
                <p className="text-sm font-medium">{selectedSession.title}</p>
                <p className="mt-1 text-xs text-text-muted">
                  {formatRunState(selectedSession.state)}
                </p>
              </div>
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
            <div className="flex flex-col justify-between p-6">
              <div className="space-y-4">
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
                        {runtime?.activeAgent.profile.bootstrapRequired ? '需要初始化' : '可直接使用'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-text-muted">soul.md 更新时间</dt>
                      <dd className="font-medium">{formatTimestamp(runtime?.activeAgent.profile.soulUpdatedAt)}</dd>
                    </div>
                    <div>
                      <dt className="text-text-muted">user.md 更新时间</dt>
                      <dd className="font-medium">{formatTimestamp(runtime?.activeAgent.profile.userUpdatedAt)}</dd>
                    </div>
                  </dl>
                  <div className="mt-3 flex items-start gap-2 rounded-md border border-border bg-surface-soft px-3 py-2 text-xs text-text-muted">
                    {runtime?.activeAgent.profile.bootstrapRequired ? (
                      <TriangleAlert size={14} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
                    ) : (
                      <Clock3 size={14} className="mt-0.5 shrink-0 text-text-muted" aria-hidden="true" />
                    )}
                    <span>
                      {runtime?.activeAgent.profile.bootstrapRequired
                        ? '首次启动会生成 bootstrap.md，完成初始化后再进入普通会话。'
                        : 'bootstrap.md 已完成或不再需要，当前 profile 可以继续沿用。'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-6 flex min-h-24 items-center rounded-md border border-border bg-surface px-4 text-sm text-text-muted">
                {errorMessage ?? '配置模型服务和模型后，这里会承载真实智能体会话。'}
              </div>
            </div>

            <aside className="border-l border-border bg-surface-soft/50 p-5">
              <p className="mb-3 text-sm font-medium">运行时控制</p>
              <div className="space-y-3">
                <button className="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-border bg-surface px-3 text-sm font-medium transition hover:bg-surface-soft focus:outline-none focus:ring-2 focus:ring-focus">
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
 * 格式化 profile 文件更新时间。
 *
 * @param value - 文件更新时间的 ISO 字符串。
 * @returns 可展示的时间文本，缺失时显示“未记录”。
 * @throws 此方法不会主动抛出错误。
 */
function formatTimestamp(value: string | null | undefined): string {
  return value ?? '未记录'
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
}> {
  const [runtime, sessions] = await Promise.all([api.getRuntimeSnapshot(), api.listSessions()])

  return { runtime, sessions }
}

export default App
