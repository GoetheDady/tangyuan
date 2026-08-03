import { describe, expect, it } from 'vitest'
import {
  createAgentReplyTranscriptEntry,
  createCompactionTranscriptEntry,
  createUserTranscriptEntry,
} from './transcript-entry-assembly'

describe('transcript entry assembly 内核', () => {
  it('user-message 条目按统一结构组装', () => {
    expect(
      createUserTranscriptEntry({
        index: 2,
        messageId: 'm-1',
        content: '你好',
        createdAt: '2026-08-03T00:00:00.000Z',
      }),
    ).toEqual({
      kind: 'user-message',
      index: 2,
      messageId: 'm-1',
      content: '你好',
      createdAt: '2026-08-03T00:00:00.000Z',
    })
  })

  it('agent-reply 条目携带 attempt 与 turns，inReplyTo 可选', () => {
    const attempt = {
      attemptId: 'run-1',
      runId: 'run-1',
      status: 'running' as const,
      startedAt: 'start',
      completedAt: null,
    }

    expect(
      createAgentReplyTranscriptEntry({
        index: 3,
        messageId: 'm-2',
        content: '回复',
        createdAt: 'created',
        attempt,
        turns: [],
        inReplyTo: 'user-1',
      }),
    ).toEqual({
      kind: 'agent-reply',
      index: 3,
      messageId: 'm-2',
      content: '回复',
      createdAt: 'created',
      attempt,
      turns: [],
      inReplyTo: 'user-1',
    })
    expect(
      createAgentReplyTranscriptEntry({
        index: 3,
        messageId: 'm-2',
        content: '回复',
        createdAt: 'created',
        attempt: null,
        turns: [],
      }),
    ).not.toHaveProperty('inReplyTo')
  })

  it('compaction 条目只含索引与时间戳', () => {
    expect(
      createCompactionTranscriptEntry({
        index: 4,
        timestamp: '2026-08-03T00:00:00.000Z',
      }),
    ).toEqual({
      kind: 'compaction',
      index: 4,
      timestamp: '2026-08-03T00:00:00.000Z',
    })
  })
})
