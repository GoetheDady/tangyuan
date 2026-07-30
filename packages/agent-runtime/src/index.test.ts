import { afterEach, describe, expect, it } from 'vitest'
import { createDefaultSessionSummary } from '@tangyuan/contracts'
import {
  AgentRuntimeError,
  type AgentEvent,
  type PiSdkPromptOptions,
  createTangyuanRuntimeForTesting,
} from './index'
import {
  cleanupTempDirs,
  createDeferred,
  createDriver,
  createPiSdkGateway,
} from './driver/pi-sdk-driver.test-helpers'

afterEach(cleanupTempDirs)

describe('createDefaultSessionSummary', () => {
  it('creates a tangyuan session summary in the initial idle state', () => {
    expect(
      createDefaultSessionSummary({
        sessionId: 'session-1',
        title: '新会话',
        updatedAt: '2026-07-08T00:00:00.000Z',
      }),
    ).toEqual({
      agentId: 'tangyuan',
      sessionId: 'session-1',
      title: '新会话',
      updatedAt: '2026-07-08T00:00:00.000Z',
      state: 'idle',
    })
  })
})

describe('AgentRuntimeError', () => {
  it('serializes a stable runtime error without leaking the original cause', () => {
    const error = new AgentRuntimeError({
      code: 'configuration-missing',
      message: 'Provider and model are required before starting a run.',
      recoverable: true,
      cause: new Error('secret API key sk-test-1234'),
    })

    expect(error.toJSON()).toEqual({
      code: 'configuration-missing',
      message: 'Provider and model are required before starting a run.',
      recoverable: true,
    })
  })
})

describe('TangyuanRuntime', () => {
  it('keeps configuration, sessions, messages, streaming events, and cancellation behind one interface', async () => {
    const runStarted = createDeferred<void>()
    const releaseRun = createDeferred<void>()
    const gateway = createPiSdkGateway({
      createSession: async (request) => {
        let wasCancelled = false
        const handle = {
          prompts: [] as string[],
          systemPromptContexts: [] as string[],
          setSystemPromptContext(context: string) {
            this.systemPromptContexts.push(context)
          },
          prompt: async (prompt: string, options?: PiSdkPromptOptions) => {
            handle.prompts.push(prompt)
            options?.onEvent?.({ type: 'text-delta', delta: '收' })
            runStarted.resolve()
            await releaseRun.promise

            if (wasCancelled) {
              throw new DOMException('Aborted', 'AbortError')
            }

            options?.onEvent?.({ type: 'text-delta', delta: '到' })
            return '收到'
          },
          abort: async () => {
            wasCancelled = true
            releaseRun.resolve()
          },
          dispose: () => undefined,
        }
        gateway.sessionRequests.push(request)
        gateway.sessionHandles.push(handle)

        return handle
      },
    })
    const { driver } = await createDriver({ gateway })
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver: driver,
      sessionDriver: driver,
    })
    const events: AgentEvent[] = []
    runtime.subscribe((event) => {
      events.push(event)
    })

    await runtime.saveRuntimeConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    const session = await runtime.createSession({
      agentId: 'tangyuan',
      title: '运行时边界测试',
    })
    const sendPromise = runtime.sendMessage({
      agentId: 'tangyuan',
      sessionId: session.sessionId,
      content: '你好',
    })
    await runStarted.promise

    await expect(runtime.listSessions()).resolves.toEqual([
      expect.objectContaining({
        sessionId: session.sessionId,
        state: 'running',
      }),
    ])
    await expect(
      runtime.cancelRun({
        agentId: 'tangyuan',
        sessionId: session.sessionId,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        sessionId: session.sessionId,
        state: 'cancelled',
      }),
    )
    await expect(sendPromise).resolves.toEqual(
      expect.objectContaining({
        entries: [
          expect.objectContaining({ kind: 'user-message', content: '你好' }),
          expect.objectContaining({ kind: 'agent-reply', content: '收' }),
        ],
      }),
    )
    await expect(
      runtime.getTranscript({
        agentId: 'tangyuan',
        sessionId: session.sessionId,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        entries: [
          expect.objectContaining({ kind: 'user-message', content: '你好' }),
          expect.objectContaining({ kind: 'agent-reply', content: '收' }),
        ],
      }),
    )
    // 公开订阅者只应收到公开 AgentEvent，不应泄漏内部驱动事件。
    // （本用例在 agent 回复落地前就取消，因此不断言具体的 delta-appended。）
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'attempt-started' }),
        expect.objectContaining({
          type: 'transcript-delta',
          delta: expect.objectContaining({
            type: 'entry-appended',
            entry: expect.objectContaining({ kind: 'user-message' }),
          }),
        }),
        expect.objectContaining({ type: 'turn-cancelled' }),
      ]),
    )
    // 内部驱动事件不应泄漏给公开订阅者（否则 IPC 层 agentEventSchema 会抛错）。
    expect(
      events.some((event) =>
        [
          'message-appended',
          'message-delta',
          'message-completed',
          'activity-updated',
        ].includes(event.type),
      ),
    ).toBe(false)
  })
})
