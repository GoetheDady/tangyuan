import type { AgentEvent } from '@yuanxiao/contracts'
import { applyTranscriptDelta } from '@yuanxiao/contracts'

import {
  getAgentEventSessionId,
  mergeAgentEventIntoSessions,
} from '@/lib/agent-event-session-state'
import {
  mergeAgentEventIntoAgents,
  mergeAgentEventIntoPendingApprovals,
  mergeAgentEventIntoPendingClarifications,
} from '@/lib/agent-event-state'
import type { WorkbenchState } from '@/stores/workbench-store'

/** 事件投影所需的只读状态切片。 */
export type AgentEventProjectionState = Pick<
  WorkbenchState,
  | 'agents'
  | 'sessionsByAgentId'
  | 'transcriptsBySessionId'
  | 'pendingApprovalsBySessionId'
  | 'pendingClarificationsBySessionId'
  | 'sendingBySessionId'
>

/**
 * 把单个 Agent 事件投影为工作台状态变更。
 *
 * 纯函数：不修改输入状态，只返回需要更新的字段切片；
 * 事件不影响的状态保持原引用，便于 store 做引用相等判断。
 *
 * @param state - 当前工作台状态切片。
 * @param event - Main 推送的标准 Agent 事件。
 * @returns 需要更新的状态字段；事件不影响任何字段时返回空对象。
 */
export function projectAgentEvent(
  state: AgentEventProjectionState,
  event: AgentEvent,
): Partial<WorkbenchState> {
  const nextAgents = mergeAgentEventIntoAgents(state.agents, event)
  const currentSessions = state.sessionsByAgentId[event.agentId] ?? []
  const nextSessions = mergeAgentEventIntoSessions(currentSessions, event)
  const partial: Partial<WorkbenchState> = {}

  if (nextAgents !== state.agents) {
    partial.agents = nextAgents
  }
  const eventSessionId = getAgentEventSessionId(event)
  const affectsKnownSession =
    event.type === 'session-created' ||
    (eventSessionId !== null &&
      currentSessions.some((session) => session.sessionId === eventSessionId))
  if (nextSessions !== currentSessions && affectsKnownSession) {
    partial.sessionsByAgentId = {
      ...state.sessionsByAgentId,
      [event.agentId]: nextSessions,
    }
  }

  if (event.type === 'transcript-delta') {
    const currentTranscript = state.transcriptsBySessionId[event.sessionId] ?? {
      agentId: event.agentId,
      sessionId: event.sessionId,
      entries: [],
      updatedAt: event.occurredAt,
    }
    partial.transcriptsBySessionId = {
      ...state.transcriptsBySessionId,
      [event.sessionId]: applyTranscriptDelta(currentTranscript, event.delta),
    }
  }

  if (
    event.type === 'approval-required' ||
    event.type === 'approval-resolved'
  ) {
    partial.pendingApprovalsBySessionId = {
      ...state.pendingApprovalsBySessionId,
      [event.sessionId]: mergeAgentEventIntoPendingApprovals(
        state.pendingApprovalsBySessionId[event.sessionId] ?? [],
        event,
      ),
    }
  }

  if (
    event.type === 'clarification-required' ||
    event.type === 'clarification-resolved'
  ) {
    partial.pendingClarificationsBySessionId = {
      ...state.pendingClarificationsBySessionId,
      [event.sessionId]: mergeAgentEventIntoPendingClarifications(
        state.pendingClarificationsBySessionId[event.sessionId] ?? [],
        event,
      ),
    }
  }

  if (
    event.type === 'turn-cancelled' ||
    event.type === 'turn-failed' ||
    (event.type === 'run-state-changed' && event.state !== 'running')
  ) {
    partial.sendingBySessionId = {
      ...state.sendingBySessionId,
      [event.sessionId]: false,
    }
  }

  return partial
}
