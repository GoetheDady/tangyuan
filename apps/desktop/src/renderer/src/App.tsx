import type { RuntimeSnapshot } from '@yuanxiao/contracts'
import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
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
import { createAgentEventBridge } from '@/lib/agent-event-bridge'
import {
  loadDesktopWorkbenchOnce,
  loadSessionsForReadyRuntime,
} from '@/lib/desktop-workbench-loader'
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

  useEffect(() => {
    let isMounted = true

    void loadDesktopWorkbenchOnce(window.api)
      .then((snapshot) => {
        if (!isMounted) return

        const store = workbenchStore.getState()
        store.loadRuntimeSnapshot(snapshot.runtime)
        store.setActiveSession(snapshot.activeSession)
        const activeAgentId =
          snapshot.activeSession?.agentId ??
          snapshot.runtime.activeAgent.agentId
        store.replaceAgentSessions(activeAgentId, snapshot.sessions)
        store.replaceArchivedSessions(activeAgentId, snapshot.archivedSessions)
        if (snapshot.transcript) {
          store.openTranscript(snapshot.transcript)
        }
        if (snapshot.sessionLoadError) {
          toast.error(`无法恢复会话：${snapshot.sessionLoadError}`)
        }

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
    const bridge = createAgentEventBridge({
      store: workbenchStore,
      api: window.api,
      notifications: toast,
      frames: {
        request: (callback) => requestAnimationFrame(callback),
        cancel: (frameId) => cancelAnimationFrame(frameId),
      },
      getActiveSessionId: () => {
        const match = window.location.hash.match(/^#\/chat\/[^/]+\/([^/?#]+)/)
        return match?.[1] ?? null
      },
    })

    return () => {
      bridge.dispose()
    }
  }, [workbenchStore])

  const handleConfigurationSaved = useCallback(
    async (nextRuntime: RuntimeSnapshot): Promise<void> => {
      const store = workbenchStore.getState()
      store.loadRuntimeSnapshot(nextRuntime)

      try {
        const { sessions, archivedSessions, activeSession, transcript } =
          await loadSessionsForReadyRuntime(window.api, nextRuntime)
        store.setActiveSession(activeSession)
        const activeAgentId =
          activeSession?.agentId ?? nextRuntime.activeAgent.agentId
        store.replaceAgentSessions(activeAgentId, sessions)
        store.replaceArchivedSessions(activeAgentId, archivedSessions)
        if (transcript) {
          store.openTranscript(transcript)
        }
      } catch (error) {
        toast.error(
          `配置已保存，但无法打开会话：${
            error instanceof Error ? error.message : '未知错误'
          }`,
        )
      }
    },
    [workbenchStore],
  )

  return (
    <Routes>
      <Route path="/" element={<StartupRedirect store={workbenchStore} />} />
      <Route
        path="/chat/:agentId?/:sessionId?"
        element={<ChatGuard store={workbenchStore} />}
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
 * @param props - 工作台 store。
 * @returns 加载态或 Navigate 路由元素。
 * @throws 此组件不会主动抛出错误。
 */
function StartupRedirect(props: {
  store: WorkbenchStoreApi
}): React.JSX.Element {
  const runtime = useStore(props.store, (state) => state.runtime)
  const isLoading = useStore(props.store, (state) => state.isInitializing)
  const activeSession = useStore(props.store, (state) => state.activeSession)

  if (isLoading) {
    return <LoadingScreen />
  }

  if (runtime?.status === 'ready') {
    return (
      <Navigate
        to={
          activeSession
            ? `/chat/${activeSession.agentId}/${activeSession.sessionId}`
            : '/chat/yuanxiao'
        }
        replace
      />
    )
  }

  return <Navigate to="/setup" replace />
}

export default App
