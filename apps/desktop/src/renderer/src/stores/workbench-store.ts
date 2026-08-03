import type {
  AgentEvent,
  AgentSessionSummary,
  AgentSummary,
  BashApprovalRequest,
  QuestionClarificationRequest,
  RuntimeSnapshot,
  TranscriptSnapshot,
} from '@yuanxiao/contracts'
import { applyTranscriptDelta } from '@yuanxiao/contracts'
import { createStore, type StoreApi } from 'zustand/vanilla'

import { projectAgentEvent } from '@/lib/agent-event-projection'

/** 未加载时的稳定空会话列表，避免 selector 每次返回新引用引发重渲染循环。 */
export const EMPTY_SESSIONS: AgentSessionSummary[] = []

export interface WorkbenchState {
  runtime: RuntimeSnapshot | null
  agents: AgentSummary[]
  /** 启动时恢复的最后激活会话，只用于初始路由重定向。 */
  activeSession: AgentSessionSummary | null
  sessionsByAgentId: Record<string, AgentSessionSummary[]>
  /** 按 Agent 分片的已归档会话列表，与活跃会话同源（都来自 includeArchived 查询）。 */
  archivedSessionsByAgentId: Record<string, AgentSessionSummary[]>
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

export interface WorkbenchActions {
  loadRuntimeSnapshot(snapshot: RuntimeSnapshot): void
  setActiveSession(session: AgentSessionSummary | null): void
  replaceAgentSessions(agentId: string, sessions: AgentSessionSummary[]): void
  replaceArchivedSessions(
    agentId: string,
    sessions: AgentSessionSummary[],
  ): void
  applyAgentEvent(event: AgentEvent): void
  applyTranscriptEvents(
    events: Extract<AgentEvent, { type: 'transcript-delta' }>[],
  ): void
  openTranscript(transcript: TranscriptSnapshot): void
  clearTranscript(sessionId: string): void
  beginSending(sessionId: string): void
  finishSending(sessionId: string): void
  resolvePendingApproval(sessionId: string, approvalId: string): void
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
    activeSession: null,
    sessionsByAgentId: {},
    archivedSessionsByAgentId: {},
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

    loadRuntimeSnapshot: (runtime) => {
      set({ runtime, agents: runtime.agents })
    },

    setActiveSession: (session) => {
      set({ activeSession: session })
    },

    replaceAgentSessions: (agentId, sessions) => {
      set((state) => ({
        sessionsByAgentId: {
          ...state.sessionsByAgentId,
          [agentId]: sessions,
        },
      }))
    },

    replaceArchivedSessions: (agentId, sessions) => {
      set((state) => ({
        archivedSessionsByAgentId: {
          ...state.archivedSessionsByAgentId,
          [agentId]: sessions,
        },
      }))
    },

    applyAgentEvent: (event) => {
      set((state) => projectAgentEvent(state, event))
    },

    applyTranscriptEvents: (events) => {
      set((state) => {
        const transcriptsBySessionId = { ...state.transcriptsBySessionId }

        for (const event of events) {
          const currentTranscript = transcriptsBySessionId[event.sessionId] ?? {
            agentId: event.agentId,
            sessionId: event.sessionId,
            entries: [],
            updatedAt: event.occurredAt,
          }
          transcriptsBySessionId[event.sessionId] = applyTranscriptDelta(
            currentTranscript,
            event.delta,
          )
        }

        return { transcriptsBySessionId }
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

    resolvePendingApproval: (sessionId, approvalId) => {
      set((state) => {
        const next = removeSessionValue(
          state.pendingApprovalsBySessionId,
          sessionId,
          (approval) => approval.approvalId === approvalId,
        )
        return {
          pendingApprovalsBySessionId: next,
        }
      })
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
      set((state) => {
        const nextApprovals = {
          ...state.pendingApprovalsBySessionId,
          [sessionId]: [],
        }
        return {
          pendingApprovalsBySessionId: nextApprovals,
          pendingClarificationsBySessionId: {
            ...state.pendingClarificationsBySessionId,
            [sessionId]: [],
          },
        }
      })
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

/**
 * 把一次 includeArchived 会话查询结果按归档状态拆成活跃与归档两个列表。
 *
 * @param sessions - 查询返回的全部会话摘要。
 * @returns 活跃与归档两个分片；两者都保持原顺序。
 */
export function partitionSessionsByArchive(
  sessions: readonly AgentSessionSummary[],
): { active: AgentSessionSummary[]; archived: AgentSessionSummary[] } {
  return {
    active: sessions.filter((session) => session.archivedAt === undefined),
    archived: sessions.filter((session) => session.archivedAt !== undefined),
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
