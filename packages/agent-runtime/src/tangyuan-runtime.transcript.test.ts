import { type AgentEvent } from './index'
import {
  TANGYUAN_DEFAULT_AGENT_ID,
  agentEventSchema,
} from '@tangyuan/contracts'
import { describe, expect, it } from 'vitest'
import { createTangyuanRuntimeForTesting } from './tangyuan-runtime'
import {
  createReadySnapshot,
  createRuntimeDriver,
  createSessionDriver,
  createSessionSummary,
} from './tangyuan-runtime.test-helpers'

describe('transcript turn/step tracking', () => {
  it('getTranscript returns cached snapshot with entries after message-appended', async () => {
    const session = createSessionSummary('session-1')
    const runtimeDriver = createRuntimeDriver(createReadySnapshot())
    const sessionDriver = createSessionDriver([session])
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
    })

    sessionDriver.emit({
      type: 'message-appended',
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      message: {
        messageId: 'user-msg',
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
        role: 'user',
        content: 'hello',
        createdAt: '2026-07-21T00:00:00.000Z',
      },
      occurredAt: '2026-07-21T00:00:00.000Z',
    })

    sessionDriver.emit({
      type: 'message-appended',
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      message: {
        messageId: 'agent-msg',
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
        role: 'agent',
        content: '',
        createdAt: '2026-07-21T00:00:00.000Z',
      },
      occurredAt: '2026-07-21T00:00:00.000Z',
    })

    const snapshot = await runtime.getTranscript({
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: session.sessionId,
    })

    expect(snapshot.entries.length).toBe(2)
    expect(snapshot.entries[0]?.kind).toBe('user-message')
    expect(snapshot.entries[1]?.kind).toBe('agent-reply')
  })

  it('loads the driver transcript when no cached snapshot exists', async () => {
    const session = createSessionSummary('session-1')
    const runtimeDriver = createRuntimeDriver(createReadySnapshot())
    const sessionDriver = createSessionDriver([session])
    sessionDriver.messages.set(session.sessionId, {
      sessionId: session.sessionId,
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      entries: [
        {
          kind: 'user-message',
          index: 0,
          messageId: 'm1',
          content: 'hello',
          createdAt: '2026-07-21T00:00:00.000Z',
        },
      ],
      updatedAt: '2026-07-21T00:00:00.000Z',
    })
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
    })

    const snapshot = await runtime.getTranscript({
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: session.sessionId,
    })

    // Driver fallback returns structured entries without turns
    expect(snapshot.entries.length).toBe(1)
    const replyEntry = snapshot.entries.find((e) => e.kind === 'user-message')
    expect(replyEntry).toBeDefined()
  })

  it('cached snapshot survives getTranscript call', async () => {
    const session = createSessionSummary('session-1')
    const runtimeDriver = createRuntimeDriver(createReadySnapshot())
    const sessionDriver = createSessionDriver([session])
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
    })

    // No events emitted → no cached snapshot
    const first = await runtime.getTranscript({
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: session.sessionId,
    })
    // Fallback from messages: no cached snapshot exists
    expect(first.entries.length).toBe(0)

    // Now emit message-appended → creates cached snapshot
    sessionDriver.emit({
      type: 'message-appended',
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      message: {
        messageId: 'u1',
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
        role: 'user',
        content: 'test',
        createdAt: '2026-07-21T00:00:00.000Z',
      },
      occurredAt: '2026-07-21T00:00:00.000Z',
    })

    const second = await runtime.getTranscript({
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: session.sessionId,
    })
    // Cached snapshot now available
    expect(second.entries.length).toBe(1)
  })

  it('thinking-started then thinking-delta creates a thinking step in transcript', async () => {
    const session = createSessionSummary('session-1')
    const runtimeDriver = createRuntimeDriver(createReadySnapshot())
    const sessionDriver = createSessionDriver([session])
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
    })

    // Emit message-appended events to create transcript entries (simulating PiSdkDriver)
    sessionDriver.emit({
      type: 'message-appended',
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      message: {
        messageId: 'user-msg',
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
        role: 'user',
        content: '分析一下',
        createdAt: '2026-07-21T00:00:00.000Z',
      },
      occurredAt: '2026-07-21T00:00:00.000Z',
    })

    sessionDriver.emit({
      type: 'message-appended',
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      message: {
        messageId: 'msg-1',
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
        role: 'agent',
        content: '',
        createdAt: '2026-07-21T00:00:00.000Z',
      },
      occurredAt: '2026-07-21T00:00:00.000Z',
    })

    sessionDriver.emit({
      type: 'attempt-started',
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: session.sessionId,
      runId: 'run-1',
      occurredAt: '2026-07-21T00:00:01.000Z',
    })

    sessionDriver.emit({
      type: 'message-delta',
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: session.sessionId,
      runId: 'run-1',
      messageId: 'msg-1',
      delta: 'Let me think about this...',
      deltaKind: 'thinking',
      occurredAt: '2026-07-21T00:00:01.000Z',
    })

    sessionDriver.emit({
      type: 'message-delta',
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: session.sessionId,
      runId: 'run-1',
      messageId: 'msg-1',
      delta: '分析结果：没有问题。',
      occurredAt: '2026-07-21T00:00:02.000Z',
    })

    sessionDriver.emit({
      type: 'message-completed',
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: session.sessionId,
      runId: 'run-1',
      message: {
        messageId: 'msg-1',
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
        role: 'agent',
        content: '分析结果：没有问题。',
        createdAt: '2026-07-21T00:00:02.000Z',
      },
      occurredAt: '2026-07-21T00:00:02.000Z',
    })

    const snapshot = await runtime.getTranscript({
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: session.sessionId,
    })

    // Should have at least user + agent entries
    expect(snapshot.entries.length).toBeGreaterThanOrEqual(2)

    // Find agent-reply entry with turns
    const replyEntry = snapshot.entries.find((e) => e.kind === 'agent-reply')
    expect(replyEntry, 'agent-reply entry should exist').toBeDefined()

    // Debug: check what's actually in the snapshot
    if (!replyEntry || replyEntry.kind !== 'agent-reply') {
      return
    }
    expect(replyEntry.turns.length).toBeGreaterThan(0)
    const hasThinking = replyEntry.turns.some((t) =>
      t.steps.some((s) => s.kind === 'thinking'),
    )
    expect(hasThinking).toBe(true)
  })

  it('tool-started creates tool-call step', async () => {
    const session = createSessionSummary('session-1')
    const runtimeDriver = createRuntimeDriver(createReadySnapshot())
    const sessionDriver = createSessionDriver([session])
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
    })

    sessionDriver.emit({
      type: 'message-appended',
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      message: {
        messageId: 'user-msg',
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
        role: 'user',
        content: '搜索文件',
        createdAt: '2026-07-21T00:00:00.000Z',
      },
      occurredAt: '2026-07-21T00:00:00.000Z',
    })

    sessionDriver.emit({
      type: 'message-appended',
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      message: {
        messageId: 'msg-1',
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
        role: 'agent',
        content: '',
        createdAt: '2026-07-21T00:00:00.000Z',
      },
      occurredAt: '2026-07-21T00:00:00.000Z',
    })

    sessionDriver.emit({
      type: 'attempt-started',
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: session.sessionId,
      runId: 'run-1',
      occurredAt: '2026-07-21T00:00:01.000Z',
    })

    sessionDriver.emit({
      type: 'activity-updated',
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: session.sessionId,
      runId: 'run-1',
      activity: { kind: 'tool', state: 'running', label: '正在搜索' },
      occurredAt: '2026-07-21T00:00:01.000Z',
    })

    sessionDriver.emit({
      type: 'activity-updated',
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: session.sessionId,
      runId: 'run-1',
      activity: { kind: 'tool', state: 'completed', label: '搜索完成' },
      occurredAt: '2026-07-21T00:00:02.000Z',
    })

    const snapshot = await runtime.getTranscript({
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: session.sessionId,
    })

    const replyEntry = snapshot.entries.find((e) => e.kind === 'agent-reply')
    expect(replyEntry).toBeDefined()
    if (replyEntry?.kind === 'agent-reply') {
      const hasToolCall = replyEntry.turns.some((t) =>
        t.steps.some((s) => s.kind === 'tool-call'),
      )
      expect(hasToolCall).toBe(true)
    }
  })

  it('cancelled run preserves existing steps in transcript', async () => {
    const session = createSessionSummary('session-1')
    const runtimeDriver = createRuntimeDriver(createReadySnapshot())
    const sessionDriver = createSessionDriver([session])
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
    })

    sessionDriver.emit({
      type: 'message-appended',
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      message: {
        messageId: 'user-msg',
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
        role: 'user',
        content: '搜索文件',
        createdAt: '2026-07-21T00:00:00.000Z',
      },
      occurredAt: '2026-07-21T00:00:00.000Z',
    })

    sessionDriver.emit({
      type: 'message-appended',
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      message: {
        messageId: 'msg-1',
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
        role: 'agent',
        content: '',
        createdAt: '2026-07-21T00:00:00.000Z',
      },
      occurredAt: '2026-07-21T00:00:00.000Z',
    })

    sessionDriver.emit({
      type: 'attempt-started',
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: session.sessionId,
      runId: 'run-1',
      occurredAt: '2026-07-21T00:00:01.000Z',
    })

    sessionDriver.emit({
      type: 'message-delta',
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: session.sessionId,
      runId: 'run-1',
      messageId: 'msg-1',
      delta: 'Let me check...',
      deltaKind: 'thinking',
      occurredAt: '2026-07-21T00:00:01.000Z',
    })

    sessionDriver.emit({
      type: 'turn-cancelled',
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: session.sessionId,
      runId: 'run-1',
      occurredAt: '2026-07-21T00:00:02.000Z',
    })

    const snapshot = await runtime.getTranscript({
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: session.sessionId,
    })

    const replyEntry = snapshot.entries.find((e) => e.kind === 'agent-reply')
    expect(replyEntry).toBeDefined()
    if (replyEntry?.kind === 'agent-reply') {
      // Should have preserved the thinking step
      const hasThinking = replyEntry.turns.some((t) =>
        t.steps.some((s) => s.kind === 'thinking'),
      )
      expect(hasThinking).toBe(true)
    }
  })

  it('never emits internal driver events to public subscribers', async () => {
    const session = createSessionSummary('session-1')
    const runtimeDriver = createRuntimeDriver(createReadySnapshot())
    const sessionDriver = createSessionDriver([session])
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
    })

    // 复刻 ipc.ts 的行为：每条公开事件都会被 agentEventSchema 校验后广播给渲染层。
    // 内部驱动事件（message-appended 等）若泄漏到这里会导致 parse 抛错。
    const received: AgentEvent[] = []
    runtime.subscribe((event) => {
      agentEventSchema.parse(event)
      received.push(event)
    })

    // 模拟一次真实发送：driver 先追加用户消息，再追加 agent 占位消息。
    expect(() => {
      sessionDriver.emit({
        type: 'message-appended',
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        message: {
          messageId: 'user-msg',
          agentId: TANGYUAN_DEFAULT_AGENT_ID,
          sessionId: session.sessionId,
          role: 'user',
          content: '你好',
          createdAt: '2026-07-21T00:00:00.000Z',
        },
        occurredAt: '2026-07-21T00:00:00.000Z',
      })
    }).not.toThrow()

    // 公开订阅者只应收到 transcript-delta，不应收到 message-appended。
    expect(
      received.every((event) => (event.type as string) !== 'message-appended'),
    ).toBe(true)
    expect(received.some((event) => event.type === 'transcript-delta')).toBe(
      true,
    )
  })

  it('never emits turn-started / turn-ended to public subscribers', async () => {
    const session = createSessionSummary('session-1')
    const runtimeDriver = createRuntimeDriver(createReadySnapshot())
    const sessionDriver = createSessionDriver([session])
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
    })

    // 复刻 ipc.ts 的行为：每条公开事件都会被 agentEventSchema 校验后广播给渲染层。
    const received: AgentEvent[] = []
    runtime.subscribe((event) => {
      agentEventSchema.parse(event)
      received.push(event)
    })

    // turn-started / turn-ended 是 Runtime 内部事件，不应跨 IPC 暴露给 Renderer。
    // 若泄漏到公开订阅者，会导致 agentEventSchema.parse 抛出 ZodError。
    expect(() => {
      sessionDriver.emit({
        type: 'turn-started',
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
        runId: 'run-1',
        turnIndex: 0,
        occurredAt: '2026-07-21T00:00:00.000Z',
      })
    }).not.toThrow()

    expect(() => {
      sessionDriver.emit({
        type: 'turn-ended',
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
        runId: 'run-1',
        turnIndex: 0,
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'hi' }],
        } as never,
        toolResults: [] as never,
        occurredAt: '2026-07-21T00:00:00.000Z',
      })
    }).not.toThrow()

    expect(
      received.every(
        (event) =>
          (event.type as string) !== 'turn-started' &&
          (event.type as string) !== 'turn-ended',
      ),
    ).toBe(true)
  })
})
