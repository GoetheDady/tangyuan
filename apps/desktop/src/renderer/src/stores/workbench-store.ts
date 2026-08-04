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

export interface WorkbenchRestoreSnapshot {
  runtime: RuntimeSnapshot
  activeSession: AgentSessionSummary | null
  /** 当前 Agent 的完整会话目录，包含活跃与归档会话。 */
  sessions: AgentSessionSummary[]
  transcript: TranscriptSnapshot | null
}

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
}

export interface WorkbenchActions {
  restoreWorkbench(snapshot: WorkbenchRestoreSnapshot): void
  refreshRuntime(snapshot: RuntimeSnapshot): void
  replaceSessionCatalog(agentId: string, sessions: AgentSessionSummary[]): void
  addSession(session: AgentSessionSummary): void
  removeSessionLineage(input: {
    agentId: string
    allSessions: AgentSessionSummary[]
    affectedSessionIds: string[]
  }): void
  completeSessionExecution(input: {
    agentId: string
    sessionId: string
    allSessions: AgentSessionSummary[]
    transcript?: TranscriptSnapshot
  }): void
  completeSessionFork(input: {
    agentId: string
    allSessions: AgentSessionSummary[]
    transcript: TranscriptSnapshot
    composerDraft: string
  }): void
  openSession(transcript: TranscriptSnapshot): void
  startSessionExecution(input: {
    sessionId: string
    clearComposer?: boolean
  }): void
  endSessionExecution(sessionId: string): void
  applyAgentEvent(event: AgentEvent): void
  applyTranscriptEvents(
    events: Extract<AgentEvent, { type: 'transcript-delta' }>[],
  ): void
  updateComposerDraft(value: string): void
  completeInitialization(): void
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
  }
}

/** 创建一个互不共享状态、且不公开原始 setter 的 Renderer 工作台 store。 */
export function createWorkbenchStore(): WorkbenchStoreApi {
  const store = createStore<WorkbenchStore>()((set) => ({
    ...createInitialState(),

    restoreWorkbench: ({ runtime, activeSession, sessions, transcript }) => {
      set((state) => {
        const agentId = activeSession?.agentId ?? runtime.activeAgent.agentId
        const { active, archived } = partitionSessionsByArchive(sessions)
        return {
          runtime,
          agents: runtime.agents,
          activeSession,
          sessionsByAgentId: {
            ...state.sessionsByAgentId,
            [agentId]: active,
          },
          archivedSessionsByAgentId: {
            ...state.archivedSessionsByAgentId,
            [agentId]: archived,
          },
          transcriptsBySessionId: transcript
            ? {
                ...state.transcriptsBySessionId,
                [transcript.sessionId]: transcript,
              }
            : state.transcriptsBySessionId,
          isInitializing: false,
        }
      })
    },

    refreshRuntime: (runtime) => {
      set({ runtime, agents: runtime.agents })
    },

    replaceSessionCatalog: (agentId, sessions) => {
      const { active, archived } = partitionSessionsByArchive(sessions)
      set((state) => ({
        sessionsByAgentId: {
          ...state.sessionsByAgentId,
          [agentId]: active,
        },
        archivedSessionsByAgentId: {
          ...state.archivedSessionsByAgentId,
          [agentId]: archived,
        },
      }))
    },

    addSession: (session) => {
      set((state) => {
        const current = state.sessionsByAgentId[session.agentId] ?? []
        return {
          sessionsByAgentId: {
            ...state.sessionsByAgentId,
            [session.agentId]: [
              session,
              ...current.filter(
                (candidate) => candidate.sessionId !== session.sessionId,
              ),
            ],
          },
        }
      })
    },

    removeSessionLineage: ({ agentId, allSessions, affectedSessionIds }) => {
      const affected = new Set(affectedSessionIds)
      const { active, archived } = partitionSessionsByArchive(allSessions)
      set((state) => ({
        activeSession:
          state.activeSession && affected.has(state.activeSession.sessionId)
            ? null
            : state.activeSession,
        sessionsByAgentId: {
          ...state.sessionsByAgentId,
          [agentId]: active,
        },
        archivedSessionsByAgentId: {
          ...state.archivedSessionsByAgentId,
          [agentId]: archived,
        },
        transcriptsBySessionId: omitKeys(
          state.transcriptsBySessionId,
          affected,
        ),
        sendingBySessionId: omitKeys(state.sendingBySessionId, affected),
        pendingApprovalsBySessionId: omitKeys(
          state.pendingApprovalsBySessionId,
          affected,
        ),
        pendingClarificationsBySessionId: omitKeys(
          state.pendingClarificationsBySessionId,
          affected,
        ),
      }))
    },

    completeSessionExecution: ({
      agentId,
      sessionId,
      allSessions,
      transcript,
    }) => {
      const { active, archived } = partitionSessionsByArchive(allSessions)
      set((state) => ({
        sessionsByAgentId: {
          ...state.sessionsByAgentId,
          [agentId]: active,
        },
        archivedSessionsByAgentId: {
          ...state.archivedSessionsByAgentId,
          [agentId]: archived,
        },
        transcriptsBySessionId: transcript
          ? {
              ...state.transcriptsBySessionId,
              [transcript.sessionId]: transcript,
            }
          : state.transcriptsBySessionId,
        sendingBySessionId: {
          ...state.sendingBySessionId,
          [sessionId]: false,
        },
      }))
    },

    completeSessionFork: ({
      agentId,
      allSessions,
      transcript,
      composerDraft,
    }) => {
      const { active, archived } = partitionSessionsByArchive(allSessions)
      set((state) => ({
        sessionsByAgentId: {
          ...state.sessionsByAgentId,
          [agentId]: active,
        },
        archivedSessionsByAgentId: {
          ...state.archivedSessionsByAgentId,
          [agentId]: archived,
        },
        transcriptsBySessionId: {
          ...state.transcriptsBySessionId,
          [transcript.sessionId]: transcript,
        },
        composerDraft,
      }))
    },

    openSession: (transcript) => {
      set((state) => ({
        transcriptsBySessionId: {
          ...state.transcriptsBySessionId,
          [transcript.sessionId]: transcript,
        },
      }))
    },

    startSessionExecution: ({ sessionId, clearComposer = false }) => {
      set((state) => ({
        sendingBySessionId: {
          ...state.sendingBySessionId,
          [sessionId]: true,
        },
        ...(clearComposer ? { composerDraft: '' } : {}),
      }))
    },

    endSessionExecution: (sessionId) => {
      set((state) => ({
        sendingBySessionId: {
          ...state.sendingBySessionId,
          [sessionId]: false,
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

    updateComposerDraft: (composerDraft) => {
      set({ composerDraft })
    },

    completeInitialization: () => {
      set({ isInitializing: false })
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
function partitionSessionsByArchive(
  sessions: readonly AgentSessionSummary[],
): { active: AgentSessionSummary[]; archived: AgentSessionSummary[] } {
  return {
    active: sessions.filter((session) => session.archivedAt === undefined),
    archived: sessions.filter((session) => session.archivedAt !== undefined),
  }
}

function omitKeys<T>(
  values: Record<string, T>,
  keys: ReadonlySet<string>,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(values).filter(([key]) => !keys.has(key)),
  ) as Record<string, T>
}
