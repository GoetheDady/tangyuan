import { describe, expect, it } from 'vitest'
import type { DriverEvent } from './index'
import { TranscriptEmitter } from './transcript-emitter'
import {
  transcriptSnapshotSchema,
  type TranscriptSnapshot,
} from '@tangyuan/contracts'

describe('TranscriptEmitter tool step handling', () => {
  function createEmitter(): {
    emitter: TranscriptEmitter
    events: DriverEvent[]
    getSnapshot: (sessionId: string) => TranscriptSnapshot | undefined
  } {
    const events: DriverEvent[] = []
    const emit = (event: DriverEvent) => {
      events.push(event)
    }
    const emitter = new TranscriptEmitter(emit)
    return {
      emitter,
      events,
      getSnapshot: (sessionId: string) => emitter.getSnapshot(sessionId),
    }
  }

  function emitAttemptStarted(
    emitter: TranscriptEmitter,
    agentId: string,
    sessionId: string,
    runId: string,
  ) {
    const event: Extract<DriverEvent, { type: 'attempt-started' }> = {
      type: 'attempt-started',
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
    const event: Extract<DriverEvent, { type: 'activity-updated' }> = {
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
    const event: Extract<DriverEvent, { type: 'message-appended' }> = {
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

  it('produces a snapshot that passes transcriptSnapshotSchema validation', () => {
    const { emitter, getSnapshot } = createEmitter()
    emitMessageAppended(emitter, 'tangyuan', 'session-1', 'msg-1', 'agent')
    emitAttemptStarted(emitter, 'tangyuan', 'session-1', 'run-1')
    emitActivityUpdated(emitter, {
      kind: 'tool',
      state: 'running',
      toolName: 'read',
      toolCallId: 'tc-1',
    })

    const snapshot = getSnapshot('session-1')
    // 自动补建的 turn 必须带非空 runId，否则 IPC 层 parseDesktopIpcResponse 会抛 ZodError
    expect(() => transcriptSnapshotSchema.parse(snapshot)).not.toThrow()
  })

  function emitThinkingDelta(
    emitter: TranscriptEmitter,
    overrides: {
      agentId?: string
      sessionId?: string
      runId?: string
      messageId?: string
      delta?: string
    } = {},
  ) {
    const event: Extract<DriverEvent, { type: 'message-delta' }> = {
      type: 'message-delta',
      agentId: overrides.agentId ?? 'tangyuan',
      sessionId: overrides.sessionId ?? 'session-1',
      runId: overrides.runId ?? 'run-1',
      messageId: overrides.messageId ?? 'msg-1',
      delta: overrides.delta ?? '正在思考',
      deltaKind: 'thinking',
      occurredAt: new Date().toISOString(),
    }
    emitter.emitTranscriptDeltaForThinking(event)
  }

  function emitTurnStarted(
    emitter: TranscriptEmitter,
    turnIndex: number,
    overrides: { runId?: string; sessionId?: string } = {},
  ) {
    const event: Extract<DriverEvent, { type: 'turn-started' }> = {
      type: 'turn-started',
      agentId: 'tangyuan',
      sessionId: overrides.sessionId ?? 'session-1',
      runId: overrides.runId ?? 'run-1',
      turnIndex,
      occurredAt: new Date().toISOString(),
    }
    emitter.startTurn(event)
  }

  type AssistantContentBlock =
    Extract<DriverEvent, { type: 'turn-ended' }>['message']['content'][number]
  type SdkToolResult =
    Extract<DriverEvent, { type: 'turn-ended' }>['toolResults'][number]

  function emitTurnEnded(
    emitter: TranscriptEmitter,
    turnIndex: number,
    content: AssistantContentBlock[],
    toolResults: SdkToolResult[] = [],
    overrides: { runId?: string; sessionId?: string } = {},
  ) {
    const event: Extract<DriverEvent, { type: 'turn-ended' }> = {
      type: 'turn-ended',
      agentId: 'tangyuan',
      sessionId: overrides.sessionId ?? 'session-1',
      runId: overrides.runId ?? 'run-1',
      turnIndex,
      message: {
        role: 'assistant',
        content,
      } as Extract<DriverEvent, { type: 'turn-ended' }>['message'],
      toolResults,
      occurredAt: new Date().toISOString(),
    }
    emitter.endTurn(event)
  }

  function toolResult(
    toolCallId: string,
    toolName: string,
    isError = false,
  ): SdkToolResult {
    return {
      role: 'toolResult',
      toolCallId,
      toolName,
      content: [{ type: 'text', text: 'raw output' }],
      isError,
      timestamp: 0,
    } as SdkToolResult
  }

  it('renders thinking step when attempt-started arrives before agent message-appended (real order)', () => {
    const { emitter, getSnapshot } = createEmitter()
    // 真实运行顺序：attempt-started 先于 agent message-appended
    emitAttemptStarted(emitter, 'tangyuan', 'session-1', 'run-1')
    emitMessageAppended(emitter, 'tangyuan', 'session-1', 'msg-1', 'agent')
    emitThinkingDelta(emitter, { delta: '正在思考' })

    const snapshot = getSnapshot('session-1')
    const agentEntry = snapshot!.entries[0]
    expect(agentEntry).toBeDefined()
    expect(agentEntry!.kind).toBe('agent-reply')
    if (agentEntry && agentEntry.kind === 'agent-reply') {
      expect(agentEntry.turns).toHaveLength(1)
      expect(agentEntry.turns[0]!.steps).toHaveLength(1)
      expect(agentEntry.turns[0]!.steps[0]!.kind).toBe('thinking')
    }
  })

  it('accumulates multiple thinking deltas into one step instead of replacing', () => {
    const { emitter, getSnapshot } = createEmitter()
    emitAttemptStarted(emitter, 'tangyuan', 'session-1', 'run-1')
    emitMessageAppended(emitter, 'tangyuan', 'session-1', 'msg-1', 'agent')
    for (const delta of ['我', '在', '思', '考']) {
      emitThinkingDelta(emitter, { delta })
    }

    const snapshot = getSnapshot('session-1')
    const agentEntry = snapshot!.entries[0]
    expect(agentEntry!.kind).toBe('agent-reply')
    if (agentEntry && agentEntry.kind === 'agent-reply') {
      expect(agentEntry.turns[0]!.steps).toHaveLength(1)
      const step = agentEntry.turns[0]!.steps[0]!
      expect(step.kind).toBe('thinking')
      expect(step.content).toBe('我在思考')
    }
  })

  it('creates a tool step in turn 0 on first tool-started', () => {
    const { emitter, getSnapshot } = createEmitter()
    emitMessageAppended(emitter, 'tangyuan', 'session-1', 'msg-1', 'agent')
    emitAttemptStarted(emitter, 'tangyuan', 'session-1', 'run-1')
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
    emitAttemptStarted(emitter, 'tangyuan', 'session-1', 'run-1')

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

  it('assembles multi-turn tool calls without misalignment (turn events drive boundaries)', () => {
    const { emitter, getSnapshot } = createEmitter()
    emitAttemptStarted(emitter, 'tangyuan', 'session-1', 'run-1')
    emitMessageAppended(emitter, 'tangyuan', 'session-1', 'msg-1', 'agent')

    // 回合 0：read
    emitTurnStarted(emitter, 0)
    emitTurnEnded(
      emitter,
      0,
      [{ type: 'toolCall', id: 'tc-1', name: 'read' }] as never,
      [toolResult('tc-1', 'read')],
    )

    // 回合 1：bash（由 SDK turn_start 界定，而非启发式推断）
    emitTurnStarted(emitter, 1)
    emitTurnEnded(
      emitter,
      1,
      [{ type: 'toolCall', id: 'tc-2', name: 'bash' }] as never,
      [toolResult('tc-2', 'bash')],
    )

    const snapshot = getSnapshot('session-1')
    const agentEntry = snapshot!.entries[0]
    expect(agentEntry?.kind).toBe('agent-reply')
    if (agentEntry && agentEntry.kind === 'agent-reply') {
      expect(agentEntry.turns).toHaveLength(2)
      expect(agentEntry.turns[0]!.steps[0]!.toolName).toBe('read')
      expect(agentEntry.turns[0]!.steps[0]!.status).toBe('completed')
      expect(agentEntry.turns[1]!.steps[0]!.toolName).toBe('bash')
      expect(agentEntry.turns[1]!.steps[0]!.status).toBe('completed')
    }
  })

  it('uses the last turn text as the reply content, including an empty final turn', () => {
    const { emitter, getSnapshot } = createEmitter()
    emitAttemptStarted(emitter, 'tangyuan', 'session-1', 'run-1')
    emitMessageAppended(emitter, 'tangyuan', 'session-1', 'msg-1', 'agent')

    emitTurnStarted(emitter, 0)
    emitTurnEnded(emitter, 0, [{ type: 'text', text: '中间结论' }] as never)
    emitTurnStarted(emitter, 1)
    emitTurnEnded(emitter, 1, [{ type: 'thinking', thinking: '收尾' }] as never)

    const entry = getSnapshot('session-1')?.entries[0]
    expect(entry?.kind).toBe('agent-reply')
    if (entry?.kind === 'agent-reply') {
      expect(entry.content).toBe('')
    }
  })

  it('keeps failed tool in timeline (does not advance turn on failure alone)', () => {
    const { emitter, getSnapshot } = createEmitter()
    emitMessageAppended(emitter, 'tangyuan', 'session-1', 'msg-1', 'agent')
    emitAttemptStarted(emitter, 'tangyuan', 'session-1', 'run-1')

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

  it('preserves a failed tool step in its own turn across a turn boundary', () => {
    const { emitter, getSnapshot } = createEmitter()
    emitAttemptStarted(emitter, 'tangyuan', 'session-1', 'run-1')
    emitMessageAppended(emitter, 'tangyuan', 'session-1', 'msg-1', 'agent')

    // 回合 0：bash 失败
    emitTurnStarted(emitter, 0)
    emitTurnEnded(
      emitter,
      0,
      [{ type: 'toolCall', id: 'tc-1', name: 'bash' }] as never,
      [toolResult('tc-1', 'bash', true)],
    )

    // 回合 1：Agent 继续用另一个工具
    emitTurnStarted(emitter, 1)
    emitTurnEnded(
      emitter,
      1,
      [{ type: 'toolCall', id: 'tc-2', name: 'read' }] as never,
      [toolResult('tc-2', 'read')],
    )

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
    emitAttemptStarted(emitter, 'tangyuan', 'session-1', 'run-1')

    // Thinking in turn 0
    const thinkingEvent: Extract<DriverEvent, { type: 'message-delta' }> = {
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

  it('assembles thinking + tool in each turn driven by turn events', () => {
    const { emitter, getSnapshot } = createEmitter()
    emitAttemptStarted(emitter, 'tangyuan', 'session-1', 'run-1')
    emitMessageAppended(emitter, 'tangyuan', 'session-1', 'msg-1', 'agent')

    // 回合 0：thinking + read
    emitTurnStarted(emitter, 0)
    emitTurnEnded(
      emitter,
      0,
      [
        { type: 'thinking', thinking: '先读文件' },
        { type: 'toolCall', id: 'tc-1', name: 'read' },
      ] as never,
      [toolResult('tc-1', 'read')],
    )

    // 回合 1：thinking + bash
    emitTurnStarted(emitter, 1)
    emitTurnEnded(
      emitter,
      1,
      [
        { type: 'thinking', thinking: '再执行命令' },
        { type: 'toolCall', id: 'tc-2', name: 'bash' },
      ] as never,
      [toolResult('tc-2', 'bash')],
    )

    const snapshot = getSnapshot('session-1')
    const agentEntry = snapshot!.entries[0]
    if (agentEntry && agentEntry.kind === 'agent-reply') {
      expect(agentEntry.turns).toHaveLength(2)
      expect(agentEntry.turns[0]!.steps.map((s) => s.kind)).toEqual([
        'thinking',
        'tool-call',
      ])
      expect(agentEntry.turns[0]!.steps[1]!.toolName).toBe('read')
      expect(agentEntry.turns[1]!.steps.map((s) => s.kind)).toEqual([
        'thinking',
        'tool-call',
      ])
      expect(agentEntry.turns[1]!.steps[1]!.toolName).toBe('bash')
    }
  })

  it('attaches second-run steps to the second agent entry (not the first)', () => {
    const { emitter, getSnapshot } = createEmitter()

    // 第一轮对话（真实顺序：attempt-started 先于 agent message-appended）
    emitAttemptStarted(emitter, 'tangyuan', 'session-1', 'run-1')
    emitMessageAppended(emitter, 'tangyuan', 'session-1', 'msg-1', 'agent')
    emitThinkingDelta(emitter, { runId: 'run-1', messageId: 'msg-1', delta: '第一轮思考' })

    // 第二轮对话：新 run、新 agent 消息
    emitAttemptStarted(emitter, 'tangyuan', 'session-1', 'run-2')
    emitMessageAppended(emitter, 'tangyuan', 'session-1', 'msg-2', 'agent')
    emitThinkingDelta(emitter, { runId: 'run-2', messageId: 'msg-2', delta: '第二轮思考' })
    emitActivityUpdated(emitter, {
      runId: 'run-2',
      kind: 'tool',
      state: 'running',
      toolName: 'read',
      toolCallId: 'tc-2',
    })

    const snapshot = getSnapshot('session-1')
    expect(snapshot!.entries).toHaveLength(2)
    const first = snapshot!.entries[0]
    const second = snapshot!.entries[1]
    // 第一轮 entry 只应含第一轮的思考
    if (first && first.kind === 'agent-reply') {
      expect(first.turns).toHaveLength(1)
      expect(first.turns[0]!.steps).toHaveLength(1)
      expect(first.turns[0]!.steps[0]!.content).toBe('第一轮思考')
    }
    // 第二轮的步骤应挂到第二个 entry
    if (second && second.kind === 'agent-reply') {
      expect(second.turns).toHaveLength(1)
      expect(second.turns[0]!.steps.map((s) => s.kind)).toEqual([
        'thinking',
        'tool-call',
      ])
      expect(second.turns[0]!.steps[0]!.content).toBe('第二轮思考')
      expect(second.turns[0]!.steps[1]!.toolName).toBe('read')
    }
  })

  it('uses safe summary with tool name and status for custom tools', () => {
    const { emitter, getSnapshot } = createEmitter()
    emitMessageAppended(emitter, 'tangyuan', 'session-1', 'msg-1', 'agent')
    emitAttemptStarted(emitter, 'tangyuan', 'session-1', 'run-1')

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

  it('assembles three sequential turns from turn events', () => {
    const { emitter, getSnapshot } = createEmitter()
    emitAttemptStarted(emitter, 'tangyuan', 'session-1', 'run-1')
    emitMessageAppended(emitter, 'tangyuan', 'session-1', 'msg-1', 'agent')

    emitTurnStarted(emitter, 0)
    emitTurnEnded(
      emitter,
      0,
      [{ type: 'toolCall', id: 'tc-1', name: 'read' }] as never,
      [toolResult('tc-1', 'read')],
    )
    emitTurnStarted(emitter, 1)
    emitTurnEnded(
      emitter,
      1,
      [{ type: 'toolCall', id: 'tc-2', name: 'grep' }] as never,
      [toolResult('tc-2', 'grep')],
    )
    emitTurnStarted(emitter, 2)
    emitTurnEnded(
      emitter,
      2,
      [{ type: 'toolCall', id: 'tc-3', name: 'bash' }] as never,
      [toolResult('tc-3', 'bash')],
    )

    const snapshot = getSnapshot('session-1')
    const agentEntry = snapshot!.entries[0]
    if (agentEntry && agentEntry.kind === 'agent-reply') {
      expect(agentEntry.turns).toHaveLength(3)
      expect(agentEntry.turns[0]!.steps[0]!.toolName).toBe('read')
      expect(agentEntry.turns[1]!.steps[0]!.toolName).toBe('grep')
      expect(agentEntry.turns[2]!.steps[0]!.toolName).toBe('bash')
      expect(agentEntry.turns[2]!.steps[0]!.status).toBe('completed')
    }
  })

  it('assembles a no-tool final turn (无工具收尾轮)', () => {
    const { emitter, getSnapshot } = createEmitter()
    emitAttemptStarted(emitter, 'tangyuan', 'session-1', 'run-1')
    emitMessageAppended(emitter, 'tangyuan', 'session-1', 'msg-1', 'agent')

    // 回合 0：工具
    emitTurnStarted(emitter, 0)
    emitTurnEnded(
      emitter,
      0,
      [{ type: 'toolCall', id: 'tc-1', name: 'read' }] as never,
      [toolResult('tc-1', 'read')],
    )

    // 回合 1：纯文字收尾，无工具
    emitTurnStarted(emitter, 1)
    emitTurnEnded(emitter, 1, [{ type: 'text', text: '已完成。' }] as never, [])

    const snapshot = getSnapshot('session-1')
    const agentEntry = snapshot!.entries[0]
    if (agentEntry && agentEntry.kind === 'agent-reply') {
      expect(agentEntry.turns).toHaveLength(2)
      expect(agentEntry.turns[1]!.steps.map((s) => s.kind)).toEqual(['text'])
      // entry.content = 最后一个回合的文字
      expect(agentEntry.content).toBe('已完成。')
    }
  })

  it('sets entry.content to the last turn text, not cross-turn accumulation', () => {
    const { emitter, getSnapshot } = createEmitter()
    emitAttemptStarted(emitter, 'tangyuan', 'session-1', 'run-1')
    emitMessageAppended(emitter, 'tangyuan', 'session-1', 'msg-1', 'agent')

    emitTurnStarted(emitter, 0)
    emitTurnEnded(emitter, 0, [{ type: 'text', text: '第一轮文字' }] as never, [])
    emitTurnStarted(emitter, 1)
    emitTurnEnded(emitter, 1, [{ type: 'text', text: '第二轮文字' }] as never, [])

    const snapshot = getSnapshot('session-1')
    const agentEntry = snapshot!.entries[0]
    if (agentEntry && agentEntry.kind === 'agent-reply') {
      // 非 '第一轮文字第二轮文字'，只留最后一轮
      expect(agentEntry.content).toBe('第二轮文字')
    }
  })

  it('preserves live-preview steps when a turn is interrupted before turn-ended', () => {
    const { emitter, getSnapshot } = createEmitter()
    emitAttemptStarted(emitter, 'tangyuan', 'session-1', 'run-1')
    emitMessageAppended(emitter, 'tangyuan', 'session-1', 'msg-1', 'agent')

    emitTurnStarted(emitter, 0)
    // 实时预览：thinking + 进行中的工具，但 turn-ended 未到达（中断）
    emitThinkingDelta(emitter, { delta: '思考中' })
    emitActivityUpdated(emitter, {
      kind: 'tool',
      state: 'running',
      toolName: 'read',
      toolCallId: 'tc-1',
    })
    // 运行被中断
    emitter.failAttemptForRun(
      'session-1',
      'run-1',
      'cancelled',
      new Date().toISOString(),
    )

    const snapshot = getSnapshot('session-1')
    const agentEntry = snapshot!.entries[0]
    if (agentEntry && agentEntry.kind === 'agent-reply') {
      // 中断前产生的实时步骤应保留
      expect(agentEntry.turns).toHaveLength(1)
      expect(agentEntry.turns[0]!.steps.map((s) => s.kind)).toEqual([
        'thinking',
        'tool-call',
      ])
      expect(agentEntry.attempt?.status).toBe('cancelled')
    }
  })

  it('emits transcript-delta events with correct delta types', () => {
    const { emitter, events } = createEmitter()
    emitMessageAppended(emitter, 'tangyuan', 'session-1', 'msg-1', 'agent')
    emitAttemptStarted(emitter, 'tangyuan', 'session-1', 'run-1')

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

  it('sets inReplyTo on AgentReplyEntry when message-appended includes it', () => {
    const { emitter, getSnapshot } = createEmitter()
    const event: Extract<DriverEvent, { type: 'message-appended' }> = {
      type: 'message-appended',
      agentId: 'tangyuan',
      message: {
        messageId: 'agent-msg-1',
        agentId: 'tangyuan',
        sessionId: 'session-1',
        role: 'agent',
        content: '重试成功',
        createdAt: new Date().toISOString(),
      },
      inReplyTo: 'user-msg-1',
      occurredAt: new Date().toISOString(),
    }
    emitter.emitTranscriptDeltaForMessageAppended(event)

    const snapshot = getSnapshot('session-1')
    expect(snapshot).toBeDefined()
    const agentEntry = snapshot!.entries[0]
    expect(agentEntry).toBeDefined()
    if (agentEntry && agentEntry.kind === 'agent-reply') {
      expect(agentEntry.inReplyTo).toBe('user-msg-1')
    }
  })

  it('failAttemptForRun includes error in ExecutionAttempt when provided', () => {
    const { emitter, getSnapshot } = createEmitter()
    emitMessageAppended(emitter, 'tangyuan', 'session-1', 'msg-1', 'agent')

    const error = {
      code: 'unknown' as const,
      message: '连接超时',
      recoverable: true,
    }
    emitter.failAttemptForRun(
      'session-1',
      'run-1',
      'failed',
      new Date().toISOString(),
      error,
    )

    const snapshot = getSnapshot('session-1')
    const agentEntry = snapshot!.entries[0]
    if (agentEntry && agentEntry.kind === 'agent-reply') {
      expect(agentEntry.attempt).toBeDefined()
      expect(agentEntry.attempt!.status).toBe('failed')
      expect(agentEntry.attempt!.error).toEqual(error)
    }
  })

  it('failAttemptForRun for cancelled does not include error', () => {
    const { emitter, getSnapshot } = createEmitter()
    emitMessageAppended(emitter, 'tangyuan', 'session-1', 'msg-1', 'agent')

    emitter.failAttemptForRun(
      'session-1',
      'run-1',
      'cancelled',
      new Date().toISOString(),
    )

    const snapshot = getSnapshot('session-1')
    const agentEntry = snapshot!.entries[0]
    if (agentEntry && agentEntry.kind === 'agent-reply') {
      expect(agentEntry.attempt).toBeDefined()
      expect(agentEntry.attempt!.status).toBe('cancelled')
      expect(agentEntry.attempt!.error).toBeUndefined()
    }
  })
})
