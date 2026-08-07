import { describe, expect, it, vi } from 'vitest'
import { MessageStore } from './message-store'
import { AttemptLifecycle } from './attempt-lifecycle'
import type { PersistedAttemptEntry } from './session-index-types'
import type { DriverEvent, PiSdkSessionHandle } from '../driver'
import { createPromptingHandle } from '../driver/pi-sdk-driver.test-helpers'

describe('AttemptLifecycle 执行协议', () => {
  it('通过一个 execute 调用完成启动、流式消息、终态持久化与收尾', async () => {
    const attempts: PersistedAttemptEntry[] = []
    const states: string[] = []
    const events: DriverEvent[] = []
    const messageStore = new MessageStore({
      now: () => '2026-08-04T00:00:00.000Z',
    })
    messageStore.initSession('session-1')
    const afterRun = vi.fn(async () => undefined)
    const performBootstrapCompletionGating = vi.fn(async () => undefined)
    const lifecycle = new AttemptLifecycle({
      sessionIndexStore: {
        resolveAttempts: vi.fn(async () => attempts),
        upsertAttempt: vi.fn(
          async (_sessionId: string, attempt: PersistedAttemptEntry) => {
            const index = attempts.findIndex(
              (candidate) => candidate.attemptId === attempt.attemptId,
            )
            if (index === -1) attempts.push(attempt)
            else attempts[index] = attempt
          },
        ),
      },
      messageStore,
      emit: (event) => events.push(event),
      updateSessionState: async (_sessionId, state) => {
        states.push(state)
      },
      invalidateTranscript: vi.fn(),
      performBootstrapCompletionGating,
      afterRun,
      now: () => '2026-08-04T00:00:00.000Z',
    })
    const handle: PiSdkSessionHandle = {
      ...createPromptingHandle('session-1'),
      prompt: async (_prompt, options) => {
        options?.onEvent?.({ type: 'text-delta', delta: '完成' })
        return '完成'
      },
      abort: vi.fn(async () => undefined),
      dispose: vi.fn(),
    }

    await lifecycle.execute({
      agentId: 'yuanxiao',
      sessionId: 'session-1',
      sessionState: 'idle',
      content: '开始',
      handle,
    })

    expect(attempts).toEqual([
      expect.objectContaining({
        runId: 'session-1-run-1',
        status: 'completed',
      }),
    ])
    expect(messageStore.getMessages('session-1')).toEqual([
      expect.objectContaining({ role: 'agent', content: '完成' }),
    ])
    expect(states).toEqual(['running', 'completed'])
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'attempt-started',
        'message-delta',
        'message-completed',
      ]),
    )
    expect(performBootstrapCompletionGating).toHaveBeenCalledOnce()
    expect(afterRun).toHaveBeenCalledWith('session-1', 'yuanxiao')
    expect(lifecycle.getActiveRunId('session-1')).toBeUndefined()
  })
})
