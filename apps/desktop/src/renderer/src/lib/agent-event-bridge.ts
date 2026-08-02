import type { AgentEvent, DesktopPreloadApi } from '@yuanxiao/contracts'

import type { WorkbenchStoreApi } from '@/stores/workbench-store'

interface AgentEventBridgeApi extends Pick<
  DesktopPreloadApi,
  'approveBash' | 'refreshRuntime' | 'subscribeToAgentEvents'
> {}

interface AgentEventNotifications {
  success(message: string): void
  info(message: string): void
  error(message: string): void
}

interface AgentEventFrameScheduler {
  request(callback: () => void): number
  cancel(frameId: number): void
}

export interface AgentEventBridgeDependencies {
  store: WorkbenchStoreApi
  api: AgentEventBridgeApi
  notifications: AgentEventNotifications
  frames: AgentEventFrameScheduler
  /** 返回当前 URL 路由显示的会话标识；无会话时返回 null。 */
  getActiveSessionId?(): string | null
}

export interface AgentEventBridge {
  dispose(): void
}

type TranscriptDeltaEvent = Extract<AgentEvent, { type: 'transcript-delta' }>

/**
 * 订阅并解释 Renderer 收到的 Agent IPC 事件。
 *
 * store 只承担同步状态转换；Preload 调用、通知和帧调度均留在此副作用边界。
 */
export function createAgentEventBridge({
  store,
  api,
  notifications,
  frames,
  getActiveSessionId = () => null,
}: AgentEventBridgeDependencies): AgentEventBridge {
  let pendingDeltaEvents: TranscriptDeltaEvent[] = []
  let pendingFrameId: number | null = null

  const flushTranscriptDeltas = (): void => {
    pendingFrameId = null
    const events = pendingDeltaEvents
    pendingDeltaEvents = []
    if (events.length === 0) return

    store.getState().applyTranscriptEvents(events)
  }

  const enqueueTranscriptDelta = (event: TranscriptDeltaEvent): void => {
    pendingDeltaEvents.push(event)
    if (pendingFrameId === null) {
      pendingFrameId = frames.request(flushTranscriptDeltas)
    }
  }

  const unsubscribe = api.subscribeToAgentEvents((event) => {
    if (event.type === 'agent-created') {
      store.getState().applyAgentEvent(event)
      notifications.success(`已创建 Agent「${event.agent.displayName}」`)
      return
    }

    if (event.type === 'agent-archived') {
      store.getState().applyAgentEvent(event)
      notifications.success(`已归档 Agent「${event.agent.displayName}」`)
      return
    }

    if (event.type === 'agent-recovered') {
      store.getState().applyAgentEvent(event)
      notifications.success(`已恢复 Agent「${event.agent.displayName}」`)
      return
    }

    if (event.type === 'agent-config-updated') {
      store.getState().applyAgentEvent(event)
      return
    }

    if (event.type === 'profile-updated') {
      void api
        .refreshRuntime()
        .then((runtime) => {
          store.getState().loadRuntimeSnapshot(runtime)
        })
        .catch((error: unknown) => {
          notifications.error(
            error instanceof Error ? error.message : '刷新 Profile 状态失败',
          )
        })
    }

    if (event.type === 'approval-required') {
      const allowedCommands =
        store.getState().alwaysAllowedCommandsBySessionId[event.sessionId] ?? []
      if (allowedCommands.includes(event.approval.command)) {
        void api.approveBash({ approvalId: event.approval.approvalId })
        return
      }

      store.getState().applyAgentEvent(event)
      notifications.info(
        `Bash 命令需要审批：${event.approval.command.slice(0, 60)}...`,
      )
      return
    }

    if (event.type === 'approval-resolved') {
      store.getState().applyAgentEvent(event)
      if (event.status === 'approved') {
        notifications.success('已批准 Bash 命令执行')
      } else {
        notifications.info('已拒绝 Bash 命令执行')
      }
      return
    }

    if (event.type === 'clarification-required') {
      store.getState().applyAgentEvent(event)
      notifications.info(
        `Agent 需要更多信息：${event.clarification.question.slice(0, 60)}...`,
      )
      return
    }

    if (event.type === 'clarification-resolved') {
      store.getState().applyAgentEvent(event)
      if (event.status === 'answered') {
        notifications.success(`已回答：${event.answer}`)
      } else {
        notifications.info('已取消澄清')
      }
      return
    }

    if (event.type === 'transcript-delta') {
      enqueueTranscriptDelta(event)
      return
    }

    store.getState().applyAgentEvent(event)

    if (
      event.type === 'turn-failed' &&
      event.sessionId === getActiveSessionId()
    ) {
      notifications.error(event.error.message)
    }
  })

  return {
    dispose: () => {
      unsubscribe()
      if (pendingFrameId !== null) {
        frames.cancel(pendingFrameId)
        pendingFrameId = null
      }
      pendingDeltaEvents = []
    },
  }
}
