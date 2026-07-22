import { describe, expect, it } from 'vitest'
import type { AgentEvent, AgentEventListener } from './index'
import { TranscriptEmitter } from './transcript-emitter'
import type { TranscriptSnapshot } from '@tangyuan/contracts'

describe('TranscriptEmitter tool step handling', () => {
  function createEmitter(): {
    emitter: TranscriptEmitter
    events: AgentEvent[]
    getSnapshot: (sessionId: string) => TranscriptSnapshot | undefined
  } {
    const events: AgentEvent[] = []
    const emit: AgentEventListener = (event) => {
      events.push(event)
    }
    const emitter = new TranscriptEmitter(emit)
    return {
      emitter,
      events,
      getSnapshot: (sessionId: string) => emitter.getSnapshot(sessionId),
    }
  }

  function emitTurnStarted(
    emitter: TranscriptEmitter,
    agentId: string,
    sessionId: string,
    runId: string,
  ) {
    const event: Extract<AgentEvent, { type: 'turn-started' }> = {
      type: 'turn-started',
      agentId,
      sessionId,
      runId,
      occurredAt: new Date().toISOString(),
    }
    emitter.startAttemptForRun(event)
    emitter.initializeTurnStateForRun(event)
  }

  function emitActivityUpdated(
    emitter: TranscriptEmitter,
    overrides: {
      agentId?: string
      sessionId?: string
      runId?: string
      kind?: 'thinking' | 'tool'
      state?: 'running' | 'completed' | 'failed'
      label?: string
      toolName?: string
      toolCallId?: string
    } = {},
  ) {
    const event: Extract<AgentEvent, { type: 'activity-updated' }> = {
      type: 'activity-updated',
      agentId: overrides.agentId ?? 'tangyuan',
      sessionId: overrides.sessionId ?? 'session-1',
      runId: overrides.runId ?? 'run-1',
      activity: {
        kind: overrides.kind ?? 'tool',
        state: overrides.state ?? 'running',
        label: overrides.label ?? '正在读取文件',
        ...(overrides.toolName !== undefined
          ? { toolName: overrides.toolName }
          : {}),
        ...(overrides.toolCallId !== undefined
          ? { toolCallId: overrides.toolCallId }
          : {}),
      },
      occurredAt: new Date().toISOString(),
    }
    emitter.emitTranscriptDeltaForActivity(event)
  }

  function emitMessageAppended(
    emitter: TranscriptEmitter,
    agentId: string,
    sessionId: string,
    messageId: string,
    role: 'agent',
  ) {
    const event: Extract<AgentEvent, { type: 'message-appended' }> = {
      type: 'message-appended',
      agentId,
      message: {
        messageId,
        agentId,
        sessionId,
        role,
        content: '',
        createdAt: new Date().toISOString(),
      },
      occurredAt: new Date().toISOString(),
    }
    emitter.emitTranscriptDeltaForMessageAppended(event)
  }

  it('creates a tool step in turn 0 on first tool-started', () => {
    const { emitter, getSnapshot } = createEmitter()
    emitMessageAppended(emitter, 'tangyuan', 'session-1', 'msg-1', 'agent')
    emitTurnStarted(emitter, 'tangyuan', 'session-1', 'run-1')
    emitActivityUpdated(emitter, {
      kind: 'tool',
      state: 'running',
      toolName: 'read',
    })

    const snapshot = getSnapshot('session-1')
    expect(snapshot).toBeDefined()
    // With only an agent message (no user message), entry is at index 0
    const agentEntry = snapshot!.entries[0]
    expect(agentEntry).toBeDefined()
    if (agentEntry && agentEntry.kind === 'agent-reply') {
      expect(agentEntry.turns).toHaveLength(1)
      expect(agentEntry.turns[0]!.steps).toHaveLength(1)
      expect(agentEntry.turns[0]!.steps[0]!.kind).toBe('tool-call')
      expect(agentEntry.turns[0]!.steps[0]!.toolName).toBe('read')
      expect(agentEntry.turns[0]!.steps[0]!.status).toBe('running')
    }
  })

  it('updates the same tool step when tool-completed matches toolCallId', () => {
    const { emitter, getSnapshot } = createEmitter()
    emitMessageAppended(emitter, 'tangyuan', 'session-1', 'msg-1', 'agent')
    emitTurnStarted(emitter, 'tangyuan', 'session-1', 'run-1')

    const toolCallId = 'tc-1'
    emitActivityUpdated(emitter, {
      kind: 'tool',
      state: 'running',
      toolName: 'read',
      toolCallId,
    })
    emitActivityUpdated(emitter, {
      kind: 'tool',
      state: 'completed',
      toolName: 'read',
      toolCallId,
    })

    const snapshot = getSnapshot('session-1')
    const agentEntry = snapshot!.entries[0]
    if (agentEntry && agentEntry.kind === 'agent-reply') {
      expect(agentEntry.turns[0]!.steps).toHaveLength(1)
      expect(agentEntry.turns[0]!.steps[0]!.status).toBe('completed')
      expect(agentEntry.turns[0]!.steps[0]!.content).toBe('读取文件')
    }
  })

  it('advances to next turn when a new tool starts after previous tool completed', () => {
    const { emitter, getSnapshot } = createEmitter()
    emitMessageAppended(emitter, 'tangyuan', 'session-1', 'msg-1', 'agent')
    emitTurnStarted(emitter, 'tangyuan', 'session-1', 'run-1')

    // First tool cycle
    emitActivityUpdated(emitter, {
      kind: 'tool',
      state: 'running',
      toolName: 'read',
      toolCallId: 'tc-1',
    })
    emitActivityUpdated(emitter, {
      kind: 'tool',
      state: 'completed',
      toolName: 'read',
      toolCallId: 'tc-1',
    })

    // Second tool cycle → new turn
    emitActivityUpdated(emitter, {
      kind: 'tool',
      state: 'running',
      toolName: 'bash',
      toolCallId: 'tc-2',
    })

    const snapshot = getSnapshot('session-1')
    const agentEntry = snapshot!.entries[0]
    if (agentEntry && agentEntry.kind === 'agent-reply') {
      expect(agentEntry.turns).toHaveLength(2)
      expect(agentEntry.turns[0]!.steps[0]!.toolName).toBe('read')
      expect(agentEntry.turns[0]!.steps[0]!.status).toBe('completed')
      expect(agentEntry.turns[1]!.steps[0]!.toolName).toBe('bash')
      expect(agentEntry.turns[1]!.steps[0]!.status).toBe('running')
    }
  })

  it('keeps failed tool in timeline (does not advance turn on failure alone)', () => {
    const { emitter, getSnapshot } = createEmitter()
    emitMessageAppended(emitter, 'tangyuan', 'session-1', 'msg-1', 'agent')
    emitTurnStarted(emitter, 'tangyuan', 'session-1', 'run-1')

    emitActivityUpdated(emitter, {
      kind: 'tool',
      state: 'running',
      toolName: 'read',
      toolCallId: 'tc-1',
    })
    emitActivityUpdated(emitter, {
      kind: 'tool',
      state: 'failed',
      toolName: 'read',
      toolCallId: 'tc-1',
    })

    const snapshot = getSnapshot('session-1')
    const agentEntry = snapshot!.entries[0]
    if (agentEntry && agentEntry.kind === 'agent-reply') {
      expect(agentEntry.turns).toHaveLength(1)
      expect(agentEntry.turns[0]!.steps).toHaveLength(1)
      expect(agentEntry.turns[0]!.steps[0]!.status).toBe('failed')
      expect(agentEntry.turns[0]!.steps[0]!.content).toBe('读取文件失败')
    }
  })

  it('advances turn after a failed tool when next tool starts', () => {
    const { emitter, getSnapshot } = createEmitter()
    emitMessageAppended(emitter, 'tangyuan', 'session-1', 'msg-1', 'agent')
    emitTurnStarted(emitter, 'tangyuan', 'session-1', 'run-1')

    // First tool fails
    emitActivityUpdated(emitter, {
      kind: 'tool',
      state: 'running',
      toolName: 'bash',
      toolCallId: 'tc-1',
    })
    emitActivityUpdated(emitter, {
      kind: 'tool',
      state: 'failed',
      toolName: 'bash',
      toolCallId: 'tc-1',
    })

    // Agent continues with another tool → new turn
    emitActivityUpdated(emitter, {
      kind: 'tool',
      state: 'running',
      toolName: 'read',
      toolCallId: 'tc-2',
    })

    const snapshot = getSnapshot('session-1')
    const agentEntry = snapshot!.entries[0]
    if (agentEntry && agentEntry.kind === 'agent-reply') {
      expect(agentEntry.turns).toHaveLength(2)
      expect(agentEntry.turns[0]!.steps[0]!.toolName).toBe('bash')
      expect(agentEntry.turns[0]!.steps[0]!.status).toBe('failed')
      expect(agentEntry.turns[1]!.steps[0]!.toolName).toBe('read')
    }
  })

  it('does not advance turn for thinking steps (same turn)', () => {
    const { emitter, getSnapshot } = createEmitter()
    emitMessageAppended(emitter, 'tangyuan', 'session-1', 'msg-1', 'agent')
    emitTurnStarted(emitter, 'tangyuan', 'session-1', 'run-1')

    // Thinking in turn 0
    const thinkingEvent: Extract<AgentEvent, { type: 'message-delta' }> = {
      type: 'message-delta',
      agentId: 'tangyuan',
      sessionId: 'session-1',
      runId: 'run-1',
      messageId: 'msg-1',
      delta: 'Let me think...',
      deltaKind: 'thinking',
      occurredAt: new Date().toISOString(),
    }
    emitter.emitTranscriptDeltaForThinking(thinkingEvent)

    // Tool call still in turn 0
    emitActivityUpdated(emitter, {
      kind: 'tool',
      state: 'running',
      toolName: 'read',
      toolCallId: 'tc-1',
    })

    const snapshot = getSnapshot('session-1')
    const agentEntry = snapshot!.entries[0]
    if (agentEntry && agentEntry.kind === 'agent-reply') {
      expect(agentEntry.turns).toHaveLength(1)
      expect(agentEntry.turns[0]!.steps).toHaveLength(2)
      expect(agentEntry.turns[0]!.steps[0]!.kind).toBe('thinking')
      expect(agentEntry.turns[0]!.steps[1]!.kind).toBe('tool-call')
    }
  })

  it('uses safe summary with tool name and status for custom tools', () => {
    const { emitter, getSnapshot } = createEmitter()
    emitMessageAppended(emitter, 'tangyuan', 'session-1', 'msg-1', 'agent')
    emitTurnStarted(emitter, 'tangyuan', 'session-1', 'run-1')

    emitActivityUpdated(emitter, {
      kind: 'tool',
      state: 'running',
      toolName: 'my_unknown_tool',
      toolCallId: 'tc-1',
    })

    const snapshot = getSnapshot('session-1')
    const agentEntry = snapshot!.entries[0]
    if (agentEntry && agentEntry.kind === 'agent-reply') {
      const step = agentEntry.turns[0]!.steps[0]!
      expect(step.content).toBe('my_unknown_tool（执行中）')
      expect(step.toolName).toBe('my_unknown_tool')
    }
  })

  it('handles multiple tools in sequence with turn advancement', () => {
    const { emitter, getSnapshot } = createEmitter()
    emitMessageAppended(emitter, 'tangyuan', 'session-1', 'msg-1', 'agent')
    emitTurnStarted(emitter, 'tangyuan', 'session-1', 'run-1')

    // Turn 0: read
    emitActivityUpdated(emitter, {
      kind: 'tool',
      state: 'running',
      toolName: 'read',
      toolCallId: 'tc-1',
    })
    emitActivityUpdated(emitter, {
      kind: 'tool',
      state: 'completed',
      toolName: 'read',
      toolCallId: 'tc-1',
    })

    // Turn 1: grep
    emitActivityUpdated(emitter, {
      kind: 'tool',
      state: 'running',
      toolName: 'grep',
      toolCallId: 'tc-2',
    })
    emitActivityUpdated(emitter, {
      kind: 'tool',
      state: 'completed',
      toolName: 'grep',
      toolCallId: 'tc-2',
    })

    // Turn 2: bash (running — has tool-call so next tool starts new turn)
    emitActivityUpdated(emitter, {
      kind: 'tool',
      state: 'running',
      toolName: 'bash',
      toolCallId: 'tc-3',
    })

    const snapshot = getSnapshot('session-1')
    const agentEntry = snapshot!.entries[0]
    if (agentEntry && agentEntry.kind === 'agent-reply') {
      expect(agentEntry.turns).toHaveLength(3)
      expect(agentEntry.turns[0]!.steps[0]!.toolName).toBe('read')
      expect(agentEntry.turns[1]!.steps[0]!.toolName).toBe('grep')
      expect(agentEntry.turns[2]!.steps[0]!.toolName).toBe('bash')
      expect(agentEntry.turns[2]!.steps[0]!.status).toBe('running')
    }
  })

  it('emits transcript-delta events with correct delta types', () => {
    const { emitter, events } = createEmitter()
    emitMessageAppended(emitter, 'tangyuan', 'session-1', 'msg-1', 'agent')
    emitTurnStarted(emitter, 'tangyuan', 'session-1', 'run-1')

    emitActivityUpdated(emitter, {
      kind: 'tool',
      state: 'running',
      toolName: 'read',
      toolCallId: 'tc-1',
    })

    // Should have emitted a transcript-delta event
    const transcriptDeltas = events.filter((e) => e.type === 'transcript-delta')
    expect(transcriptDeltas.length).toBeGreaterThan(0)

    // The most recent transcript-delta should be a step-appended
    const lastDelta = transcriptDeltas[transcriptDeltas.length - 1]
    expect(lastDelta!.type).toBe('transcript-delta')
    if ('delta' in lastDelta!) {
      expect(lastDelta.delta.type).toBe('step-appended')
    }
  })
})
