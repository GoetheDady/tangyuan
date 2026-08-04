import type {
  AgentSessionSummary,
  SessionModelInfo,
  TranscriptSnapshot,
} from '@yuanxiao/contracts'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { useStore } from 'zustand'

import {
  EMPTY_SESSIONS,
  type WorkbenchStoreApi,
} from '@/stores/workbench-store'
import { useSessionModelController } from './useSessionModelController'

/** 会话操作组合层所需的 store 与路由上下文。 */
export interface UseChatSessionActionsOptions {
  store: WorkbenchStoreApi
  /** 当前路由的 Agent 标识（无参数时已回退默认 Agent）。 */
  activeAgentId: string
  /** 当前路由的会话标识；无会话时为 undefined。 */
  sessionId: string | undefined
}

/**
 * 把「变更会话并刷新」的固定编排顺序收敛为单点组合层。
 *
 * createSession / sendMessage / retryMessage / forkSession / cancelRun 等动作
 * 共享同一批 store 写、IPC 刷新、导航与 toast 顺序；模型信息加载与 transcript
 * 按需读取也在此收敛，ChatPage 只剩 selector 与 JSX。useSessionArchive 是
 * 同模式的先例。
 *
 * @param options - store、路由 Agent 与会话标识。
 * @returns 会话操作动作与它们使用的局部状态。
 */
export function useChatSessionActions(options: UseChatSessionActionsOptions): {
  sessionModelInfo: SessionModelInfo | null
  isLoadingModelInfo: boolean
  isSwitchingModel: boolean
  cancellingSessionId: string | null
  createSession(): Promise<void>
  sendMessage(): Promise<void>
  retryMessage(userMessageId: string): Promise<void>
  forkSession(userMessageId: string): Promise<void>
  cancelRun(): Promise<void>
  handleSessionModelChange(providerId: string, modelId: string): Promise<void>
  handleThinkingLevelChange(level: string): Promise<void>
} {
  const { store, activeAgentId, sessionId } = options
  const navigate = useNavigate()
  const sessionModel = useSessionModelController({
    agentId: activeAgentId,
    sessionId,
  })
  const [cancellingSessionId, setCancellingSessionId] = useState<string | null>(
    null,
  )
  const openSessionRequestIdRef = useRef(0)
  const persistLastActiveSessionQueueRef = useRef<Promise<void>>(
    Promise.resolve(),
  )

  const sessions = useStore(
    store,
    (state) =>
      (activeAgentId ? state.sessionsByAgentId[activeAgentId] : undefined) ??
      EMPTY_SESSIONS,
  )
  const hasLoadedAgentSessions = useStore(store, (state) =>
    activeAgentId
      ? Object.prototype.hasOwnProperty.call(
          state.sessionsByAgentId,
          activeAgentId,
        )
      : true,
  )
  const transcript = useStore(store, (state) =>
    sessionId ? (state.transcriptsBySessionId[sessionId] ?? null) : null,
  )
  const composerText = useStore(store, (state) => state.composerDraft)
  const addSession = useStore(store, (state) => state.addSession)
  const startSessionExecution = useStore(
    store,
    (state) => state.startSessionExecution,
  )
  const endSessionExecution = useStore(
    store,
    (state) => state.endSessionExecution,
  )
  const completeSessionExecution = useStore(
    store,
    (state) => state.completeSessionExecution,
  )
  const completeSessionFork = useStore(
    store,
    (state) => state.completeSessionFork,
  )

  const selectedSession = useMemo<AgentSessionSummary | null>(() => {
    if (sessionId) {
      return sessions.find((session) => session.sessionId === sessionId) ?? null
    }
    return sessions[0] ?? null
  }, [sessions, sessionId])
  const selectedTranscript: TranscriptSnapshot | null =
    transcript?.sessionId === selectedSession?.sessionId ? transcript : null

  // 当前 Agent 的会话列表尚未加载时按需读取；结果按 Agent 落盘，互不覆盖。
  // 一次 includeArchived 查询同时填充活跃与归档两个分片，避免重复 IPC。
  useEffect(() => {
    if (hasLoadedAgentSessions) return

    void window.api
      .listSessions({ agentId: activeAgentId, includeArchived: true })
      .then((allSessions) => {
        store.getState().replaceSessionCatalog(activeAgentId, allSessions)
      })
      .catch((error: unknown) => {
        toast.error(
          error instanceof Error ? error.message : '加载 Agent 会话失败',
        )
      })
    // 只在首次进入或 Agent 切换时触发一次；由 hasLoadedAgentSessions 收敛。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAgentId, hasLoadedAgentSessions])

  // URL sessionId 是当前显示会话的事实来源：每次路由变化都按需读取
  // transcript 并持久化最后激活会话，且只接纳最后一次请求的结果，
  // 避免快速切换时旧结果覆盖新会话。
  useEffect(() => {
    if (!sessionId || !activeAgentId) return

    const requestId = ++openSessionRequestIdRef.current
    void window.api
      .getTranscript({ agentId: activeAgentId, sessionId })
      .then((nextTranscript) => {
        if (requestId !== openSessionRequestIdRef.current) return

        store.getState().openSession(nextTranscript)
        void persistLastActiveSession(activeAgentId, sessionId)
      })
      .catch((error) => {
        if (requestId !== openSessionRequestIdRef.current) return

        toast.error(error instanceof Error ? error.message : '读取会话消息失败')
      })
    // 路由变化即会话切换；每次切换都重新读取最新 transcript。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, activeAgentId])

  /**
   * 持久化用户最后成功打开的会话。
   *
   * @param agentId - 会话所属 Agent。
   * @param sessionId - 已成功打开的会话标识。
   * @returns 无返回值。
   * @throws Preload API 错误会被捕获并通过 toast 反馈。
   */
  function persistLastActiveSession(
    agentId: string,
    sessionId: string,
  ): Promise<void> {
    persistLastActiveSessionQueueRef.current =
      persistLastActiveSessionQueueRef.current
        .then(async () => {
          await window.api.setLastActiveSession({ agentId, sessionId })
        })
        .catch((error) => {
          toast.error(
            error instanceof Error ? error.message : '无法记录最后打开的会话',
          )
        })

    return persistLastActiveSessionQueueRef.current
  }

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
        title: '新会话',
      })
      addSession(session)
      navigate(`/chat/${activeAgentId}/${session.sessionId}`, { replace: true })
      await persistLastActiveSession(session.agentId, session.sessionId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建会话失败')
    }
  }

  /**
   * 向当前会话发送用户消息。
   *
   * @returns 无返回值。
   * @throws Preload API 错误会被捕获并通过 toast 反馈。
   */
  const sendMessage = async (): Promise<void> => {
    const content = composerText.trim()

    if (!selectedSession) {
      toast.error('请先创建一个新会话。')
      return
    }

    if (!content) {
      return
    }

    startSessionExecution({
      sessionId: selectedSession.sessionId,
      clearComposer: true,
    })

    try {
      const nextTranscript = await window.api.sendMessage({
        agentId: selectedSession.agentId,
        sessionId: selectedSession.sessionId,
        content,
      })
      const nextSessions = await window.api.listSessions({
        agentId: selectedSession.agentId,
        includeArchived: true,
      })
      completeSessionExecution({
        agentId: selectedSession.agentId,
        sessionId: selectedSession.sessionId,
        allSessions: nextSessions,
        transcript: nextTranscript,
      })
      navigate(`/chat/${activeAgentId}/${selectedSession.sessionId}`, {
        replace: true,
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '发送消息失败')
    } finally {
      endSessionExecution(selectedSession.sessionId)
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

    startSessionExecution({ sessionId: selectedSession.sessionId })

    try {
      const nextTranscript = await window.api.retryMessage({
        agentId: selectedSession.agentId,
        sessionId: selectedSession.sessionId,
        userMessageId,
      })
      const nextSessions = await window.api.listSessions({
        agentId: selectedSession.agentId,
        includeArchived: true,
      })
      completeSessionExecution({
        agentId: selectedSession.agentId,
        sessionId: selectedSession.sessionId,
        allSessions: nextSessions,
        transcript: nextTranscript,
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '重试消息失败')
    } finally {
      endSessionExecution(selectedSession.sessionId)
    }
  }

  /**
   * 在当前会话的某个用户消息节点分叉出新分支。
   *
   * @param userMessageId - 分叉起始节点（用户消息标识）。
   * @returns 无返回值。
   * @throws Preload API 错误会被捕获并通过 toast 反馈。
   */
  const forkSession = async (userMessageId: string): Promise<void> => {
    if (!selectedSession) {
      toast.error('请先选择一个会话。')
      return
    }

    const sourceEntry = selectedTranscript?.entries.find(
      (entry) =>
        entry.kind === 'user-message' && entry.messageId === userMessageId,
    )
    const sourceMessageContent =
      sourceEntry?.kind === 'user-message' ? sourceEntry.content : ''

    try {
      const childSession = await window.api.forkSession({
        agentId: selectedSession.agentId,
        sessionId: selectedSession.sessionId,
        entryId: userMessageId,
      })
      const [nextSessions, childTranscript] = await Promise.all([
        window.api.listSessions({
          agentId: childSession.agentId,
          includeArchived: true,
        }),
        window.api.getTranscript({
          agentId: childSession.agentId,
          sessionId: childSession.sessionId,
        }),
      ])
      completeSessionFork({
        agentId: childSession.agentId,
        allSessions: nextSessions,
        transcript: childTranscript,
        composerDraft: sourceMessageContent,
      })
      navigate(`/chat/${activeAgentId}/${childSession.sessionId}`, {
        replace: true,
      })
      await persistLastActiveSession(
        childSession.agentId,
        childSession.sessionId,
      )
      toast.success('已创建分叉会话')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '分叉会话失败')
    }
  }

  /**
   * 取消当前会话正在运行的模型响应。
   *
   * @returns 无返回值。
   * @throws Preload API 错误会被捕获并通过 toast 反馈。
   */
  const cancelRun = async (): Promise<void> => {
    if (!selectedSession || cancellingSessionId === selectedSession.sessionId) {
      return
    }

    const targetSessionId = selectedSession.sessionId
    setCancellingSessionId(targetSessionId)
    try {
      await window.api.cancelRun({
        agentId: selectedSession.agentId,
        sessionId: selectedSession.sessionId,
      })
      // 刷新 sessions 以同步取消后的状态，避免仅依赖异步推送事件
      completeSessionExecution({
        agentId: selectedSession.agentId,
        sessionId: selectedSession.sessionId,
        allSessions: await window.api.listSessions({
          agentId: selectedSession.agentId,
          includeArchived: true,
        }),
      })
      toast.success('已停止生成')
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : '取消运行失败')
      // 即使取消失败，也要重置 isSendingMessage，防止 UI 卡住
      endSessionExecution(selectedSession.sessionId)
    } finally {
      setCancellingSessionId((current) =>
        current === targetSessionId ? null : current,
      )
    }
  }

  /**
   * 切换当前会话的 Provider 与模型。
   *
   * @param providerId - 目标 Provider 标识。
   * @param modelId - 目标模型标识。
   * @returns 无返回值。
   * @throws Preload API 错误会被捕获并通过 toast 反馈。
   */
  async function handleSessionModelChange(
    providerId: string,
    modelId: string,
  ): Promise<void> {
    await sessionModel.setModel(providerId, modelId)
  }

  /**
   * 切换当前会话的 Thinking Level。
   *
   * @param level - 目标 Thinking Level。
   * @returns 无返回值。
   * @throws Preload API 错误会被捕获并通过 toast 反馈。
   */
  async function handleThinkingLevelChange(level: string): Promise<void> {
    await sessionModel.setThinkingLevel(level)
  }

  return {
    sessionModelInfo: sessionModel.sessionModelInfo,
    isLoadingModelInfo: sessionModel.isLoadingModelInfo,
    isSwitchingModel: sessionModel.isSwitchingModel,
    cancellingSessionId,
    createSession,
    sendMessage,
    retryMessage,
    forkSession,
    cancelRun,
    handleSessionModelChange,
    handleThinkingLevelChange,
  }
}
