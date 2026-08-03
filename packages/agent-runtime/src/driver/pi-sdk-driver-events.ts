import type {
  TurnEndEvent as PiSdkTurnEndEvent,
  TurnStartEvent as PiSdkTurnStartEvent,
} from '@earendil-works/pi-coding-agent'
import type { AgentEvent } from '@yuanxiao/contracts'

/** Driver 内部消息；不暴露给 Runtime 或 Renderer。 */
export interface InternalMessage {
  messageId: string
  agentId: string
  sessionId: string
  role: 'user' | 'agent' | 'system' | 'compaction'
  content: string
  createdAt: string
}

/** Driver 内部扩展事件；进入公开订阅前由 Runtime 翻译。 */
export type DriverEvent =
  | AgentEvent
  | {
      type: 'message-appended'
      agentId: string
      message: InternalMessage
      inReplyTo?: string
      occurredAt: string
    }
  | {
      type: 'message-delta'
      agentId: string
      sessionId: string
      runId: string
      messageId: string
      delta: string
      deltaKind?: 'text' | 'thinking'
      occurredAt: string
    }
  | {
      type: 'message-completed'
      agentId: string
      sessionId: string
      runId: string
      message: InternalMessage
      occurredAt: string
    }
  | {
      type: 'activity-updated'
      agentId: string
      sessionId: string
      runId: string
      activity: {
        kind: 'thinking' | 'tool'
        state: 'running' | 'completed' | 'failed'
        label: string
        toolCallId?: string
        toolName?: string
      }
      occurredAt: string
    }
  | {
      type: 'turn-started'
      agentId: string
      sessionId: string
      runId: string
      turnIndex: PiSdkTurnStartEvent['turnIndex']
      occurredAt: string
    }
  | {
      type: 'turn-ended'
      agentId: string
      sessionId: string
      runId: string
      turnIndex: PiSdkTurnEndEvent['turnIndex']
      message: Extract<PiSdkTurnEndEvent['message'], { role: 'assistant' }>
      toolResults: PiSdkTurnEndEvent['toolResults']
      occurredAt: string
    }
  | {
      type: 'compaction-detected'
      agentId: string
      sessionId: string
      runId: string
      occurredAt: string
    }
  | {
      type: 'auto-retry-progress'
      agentId: string
      sessionId: string
      runId: string
      retryCount: number
      maxAttempts: number
      occurredAt: string
    }
