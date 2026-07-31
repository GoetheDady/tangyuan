import type {
  AgentEvent,
  AgentSessionSummary,
  AgentSummary,
  BashApprovalRequest,
  QuestionClarificationRequest,
  RuntimeSnapshot,
  TranscriptSnapshot,
} from '@tangyuan/contracts'
import { applyTranscriptDelta } from '@tangyuan/contracts'
import { createStore, type StoreApi } from 'zustand/vanilla'

import {
  getAgentEventSessionId,
  mergeAgentEventIntoSessions,
} from '@/lib/agent-event-session-state'
import {
  mergeAgentEventIntoAgents,
  mergeAgentEventIntoPendingApprovals,
  mergeAgentEventIntoPendingClarifications,
} from '@/lib/agent-event-state'

export interface WorkbenchState {
  runtime: RuntimeSnapshot | null
  agents: AgentSummary[]
  sessionsByAgentId: Record<string, AgentSessionSummary[]>
  activeAgentId: string | null
  activeSessionId: string | null
  transcriptsBySessionId: Record<string, TranscriptSnapshot>
  sendingBySessionId: Record<string, boolean>
  pendingApprovalsBySessionId: Record<string, BashApprovalRequest[]>
  pendingClarificationsBySessionId: Record<
    string,
    QuestionClarificationRequest[]
  >
  composerDraft: string
  isInitializing: boolean
  alwaysAllowedCommandsBySessionId: Record<string, string[]>
}

export interface WorkbenchSnapshot {
  runtime: RuntimeSnapshot
  agents: AgentSummary[]
  sessions: AgentSessionSummary[]
  activeSession: AgentSessionSummary | null
  transcript: TranscriptSnapshot | null
}

export interface WorkbenchActions {
  loadWorkbenchSnapshot(snapshot: WorkbenchSnapshot): void
  loadRuntimeSnapshot(snapshot: RuntimeSnapshot): void
  replaceAgentSessions(agentId: string, sessions: AgentSessionSummary[]): void
  selectAgent(agentId: string): void
  selectSession(agentId: string, sessionId: string | null): void
  applyAgentEvent(event: AgentEvent): void
  openTranscript(transcript: TranscriptSnapshot): void
  clearTranscript(sessionId: string): void
  beginSending(sessionId: string): void
  finishSending(sessionId: string): void
  addPendingApproval(approval: BashApprovalRequest): void
  resolvePendingApproval(sessionId: string, approvalId: string): void
  addPendingClarification(clarification: QuestionClarificationRequest): void
  resolvePendingClarification(sessionId: string, clarificationId: string): void
  clearSessionRequests(sessionId: string): void
  updateComposerDraft(value: string): void
  clearComposerDraft(): void
  finishInitialization(): void
  allowCommandForProcess(sessionId: string, command: string): void
}

export type WorkbenchStore = WorkbenchState & WorkbenchActions
export type WorkbenchStoreApi = Pick<
  StoreApi<WorkbenchStore>,
  'getState' | 'getInitialState' | 'subscribe'
>

function createInitialState(): WorkbenchState {
  return {
    runtime: null,
    agents: [],
    sessionsByAgentId: {},
    activeAgentId: null,
    activeSessionId: null,
    transcriptsBySessionId: {},
    sendingBySessionId: {},
    pendingApprovalsBySessionId: {},
    pendingClarificationsBySessionId: {},
    composerDraft: '',
    isInitializing: true,
    alwaysAllowedCommandsBySessionId: {},
  }
}

/** 创建一个互不共享状态、且不公开原始 setter 的 Renderer 工作台 store。 */
export function createWorkbenchStore(): WorkbenchStoreApi {
  const store = createStore<WorkbenchStore>()((set) => ({
    ...createInitialState(),

    loadWorkbenchSnapshot: ({
      runtime,
      agents,
      sessions,
      activeSession,
      transcript,
    }) => {
      const activeAgentId =
        activeSession?.agentId ?? runtime.activeAgent.agentId
      set({
        runtime,
        agents,
        sessionsByAgentId: { [activeAgentId]: sessions },
        activeAgentId,
        activeSessionId: activeSession?.sessionId ?? null,
        transcriptsBySessionId: transcript
          ? { [transcript.sessionId]: transcript }
          : {},
      })
    },

    loadRuntimeSnapshot: (runtime) => {
      set({ runtime, agents: runtime.agents })
    },

    replaceAgentSessions: (agentId, sessions) => {
      set((state) => ({
        sessionsByAgentId: {
          ...state.sessionsByAgentId,
          [agentId]: sessions,
        },
      }))
    },

    selectAgent: (activeAgentId) => {
      set({ activeAgentId, activeSessionId: null })
    },

    selectSession: (activeAgentId, activeSessionId) => {
      set({ activeAgentId, activeSessionId })
    },

    applyAgentEvent: (event) => {
      set((state) => {
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
            currentSessions.some(
              (session) => session.sessionId === eventSessionId,
            ))
        if (nextSessions !== currentSessions && affectsKnownSession) {
          partial.sessionsByAgentId = {
            ...state.sessionsByAgentId,
            [event.agentId]: nextSessions,
          }
        }

        if (event.type === 'transcript-delta') {
          const currentTranscript = state.transcriptsBySessionId[
            event.sessionId
          ] ?? {
            agentId: event.agentId,
            sessionId: event.sessionId,
            entries: [],
            updatedAt: event.occurredAt,
          }
          partial.transcriptsBySessionId = {
            ...state.transcriptsBySessionId,
            [event.sessionId]: applyTranscriptDelta(
              currentTranscript,
              event.delta,
            ),
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
      })
    },

    openTranscript: (transcript) => {
      set((state) => ({
        transcriptsBySessionId: {
          ...state.transcriptsBySessionId,
          [transcript.sessionId]: transcript,
        },
      }))
    },

    clearTranscript: (sessionId) => {
      set((state) => ({
        transcriptsBySessionId: omitKey(
          state.transcriptsBySessionId,
          sessionId,
        ),
      }))
    },

    beginSending: (sessionId) => {
      set((state) => ({
        sendingBySessionId: {
          ...state.sendingBySessionId,
          [sessionId]: true,
        },
      }))
    },

    finishSending: (sessionId) => {
      set((state) => ({
        sendingBySessionId: {
          ...state.sendingBySessionId,
          [sessionId]: false,
        },
      }))
    },

    addPendingApproval: (approval) => {
      set((state) => ({
        pendingApprovalsBySessionId: appendSessionValue(
          state.pendingApprovalsBySessionId,
          approval.sessionId,
          approval,
        ),
      }))
    },

    resolvePendingApproval: (sessionId, approvalId) => {
      set((state) => ({
        pendingApprovalsBySessionId: removeSessionValue(
          state.pendingApprovalsBySessionId,
          sessionId,
          (approval) => approval.approvalId === approvalId,
        ),
      }))
    },

    addPendingClarification: (clarification) => {
      set((state) => ({
        pendingClarificationsBySessionId: appendSessionValue(
          state.pendingClarificationsBySessionId,
          clarification.sessionId,
          clarification,
        ),
      }))
    },

    resolvePendingClarification: (sessionId, clarificationId) => {
      set((state) => ({
        pendingClarificationsBySessionId: removeSessionValue(
          state.pendingClarificationsBySessionId,
          sessionId,
          (clarification) => clarification.clarificationId === clarificationId,
        ),
      }))
    },

    clearSessionRequests: (sessionId) => {
      set((state) => ({
        pendingApprovalsBySessionId: {
          ...state.pendingApprovalsBySessionId,
          [sessionId]: [],
        },
        pendingClarificationsBySessionId: {
          ...state.pendingClarificationsBySessionId,
          [sessionId]: [],
        },
      }))
    },

    updateComposerDraft: (composerDraft) => {
      set({ composerDraft })
    },

    clearComposerDraft: () => {
      set({ composerDraft: '' })
    },

    finishInitialization: () => {
      set({ isInitializing: false })
    },

    allowCommandForProcess: (sessionId, command) => {
      set((state) => {
        const currentCommands =
          state.alwaysAllowedCommandsBySessionId[sessionId] ?? []
        if (currentCommands.includes(command)) return state

        return {
          alwaysAllowedCommandsBySessionId: {
            ...state.alwaysAllowedCommandsBySessionId,
            [sessionId]: [...currentCommands, command],
          },
        }
      })
    },
  }))

  return {
    getState: store.getState,
    getInitialState: store.getInitialState,
    subscribe: store.subscribe,
  }
}

function appendSessionValue<T>(
  valuesBySessionId: Record<string, T[]>,
  sessionId: string,
  value: T,
): Record<string, T[]> {
  return {
    ...valuesBySessionId,
    [sessionId]: [...(valuesBySessionId[sessionId] ?? []), value],
  }
}

function removeSessionValue<T>(
  valuesBySessionId: Record<string, T[]>,
  sessionId: string,
  matches: (value: T) => boolean,
): Record<string, T[]> {
  return {
    ...valuesBySessionId,
    [sessionId]: (valuesBySessionId[sessionId] ?? []).filter(
      (value) => !matches(value),
    ),
  }
}

function omitKey<T>(values: Record<string, T>, key: string): Record<string, T> {
  const remaining = { ...values }
  delete remaining[key]
  return remaining
}
