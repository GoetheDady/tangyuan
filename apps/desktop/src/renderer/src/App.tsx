import { createDefaultSessionSummary } from '@tangyuan/agent-runtime'
import { createRuntimeSnapshot } from '@tangyuan/shared'
import { CheckCircle2, KeyRound, MessageSquarePlus, RefreshCcw, Settings2 } from 'lucide-react'
import { animate } from 'motion'
import { motion } from 'motion/react'
import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'

/**
 * 渲染桌面端 v1 的最小可用工作台首页。
 *
 * @returns React 组件树，展示运行时状态、会话入口和基础操作按钮。
 */
function App(): React.JSX.Element {
  const statusDotRef = useRef<HTMLSpanElement>(null)
  const runtime = createRuntimeSnapshot({
    agentId: 'tangyuan',
    providerId: null,
    modelId: null,
    hasApiKey: false
  })
  const session = createDefaultSessionSummary({
    sessionId: 'welcome',
    title: '新会话',
    updatedAt: new Date().toISOString()
  })

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

  const handleRefresh = (): void => {
    void animate('#refresh-icon', { rotate: 360 }, { duration: 0.55 })
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
              <p className="text-sm text-text-muted">Desktop Agent Workbench</p>
            </div>
          </div>

          <button className="mb-5 flex h-10 w-full items-center justify-center gap-2 rounded-md bg-brand px-3 text-sm font-medium text-surface transition hover:bg-brand-soft focus:outline-none focus:ring-2 focus:ring-focus">
            <MessageSquarePlus size={16} aria-hidden="true" />
            新会话
          </button>

          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-text-muted">Sessions</p>
            <div className="rounded-md border border-border bg-surface p-3">
              <p className="text-sm font-medium">{session.title}</p>
              <p className="mt-1 text-xs text-text-muted">{session.state}</p>
            </div>
          </div>
        </aside>

        <section className="flex flex-col">
          <header className="flex items-center justify-between border-b border-border px-6 py-4">
            <div>
              <p className="text-sm text-text-muted">v1 readiness</p>
              <h2 className="text-xl font-semibold leading-7">Pi SDK 会话闭环基础</h2>
            </div>
            <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm">
              <span ref={statusDotRef} className="size-2 rounded-full bg-danger" />
              {runtime.status === 'ready' ? 'Ready' : 'Missing configuration'}
            </div>
          </header>

          <div className="grid flex-1 grid-cols-[1fr_300px] gap-0">
            <div className="flex flex-col justify-between p-6">
              <div className="space-y-4">
                <div className="rounded-md border border-border bg-surface p-4">
                  <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                    <Settings2 size={16} aria-hidden="true" />
                    RuntimeSnapshot
                  </div>
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-text-muted">Agent</dt>
                      <dd className="font-medium">{runtime.agentId}</dd>
                    </div>
                    <div>
                      <dt className="text-text-muted">Provider</dt>
                      <dd className="font-medium">未配置</dd>
                    </div>
                    <div>
                      <dt className="text-text-muted">Model</dt>
                      <dd className="font-medium">未选择</dd>
                    </div>
                    <div>
                      <dt className="text-text-muted">API Key</dt>
                      <dd className="font-medium">未保存</dd>
                    </div>
                  </dl>
                </div>

                <div className="rounded-md border border-border bg-surface p-4">
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <CheckCircle2 size={16} aria-hidden="true" />
                    Quality gate smoke path
                  </div>
                  <p className="text-sm leading-6 text-text-muted">
                    Electron, React, TypeScript, Tailwind, Motion, GSAP and Lucide are wired for the
                    first desktop slice.
                  </p>
                </div>
              </div>

              <div className="mt-6 flex min-h-24 items-center rounded-md border border-border bg-surface px-4 text-sm text-text-muted">
                配置 Provider 和模型后，这里会承载真实 Agent 会话。
              </div>
            </div>

            <aside className="border-l border-border bg-surface-soft/50 p-5">
              <p className="mb-3 text-sm font-medium">Runtime controls</p>
              <div className="space-y-3">
                <button className="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-border bg-surface px-3 text-sm font-medium transition hover:bg-surface-soft focus:outline-none focus:ring-2 focus:ring-focus">
                  <KeyRound size={16} aria-hidden="true" />
                  配置 API Key
                </button>
                <button
                  className="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-border bg-surface px-3 text-sm font-medium transition hover:bg-surface-soft focus:outline-none focus:ring-2 focus:ring-focus"
                  onClick={handleRefresh}
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

export default App
