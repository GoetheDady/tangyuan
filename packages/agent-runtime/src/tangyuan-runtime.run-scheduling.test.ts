import { TANGYUAN_DEFAULT_AGENT_ID } from '@tangyuan/contracts'
import { describe, expect, it, vi } from 'vitest'
import { createTangyuanRuntimeForTesting } from './TangyuanRuntime'
import {
  createDeferred,
  createRuntimeDriver,
  createSessionDriver,
  createSessionSummary,
  createSnapshot,
} from './tangyuan-runtime.test-helpers'

describe('TangyuanRuntime', () => {
  describe('run scheduling', () => {
    it('allows up to four concurrent runs across different sessions', async () => {
      const sessions = [1, 2, 3, 4].map((n) =>
        createSessionSummary(`session-${n}`),
      )
      const runtimeDriver = createRuntimeDriver(
        createSnapshot({
          providerId: 'anthropic',
          modelId: 'claude-sonnet-4-5',
          maskedValue: 'sk-t...7890',
        }),
      )
      const sessionDriver = createSessionDriver(sessions)
      const sessionDeferreds = new Map<
        string,
        ReturnType<typeof createDeferred<void>>
      >()
      sessionDriver.sendMessage = vi.fn(async (request) => {
        sessionDriver.emit({
          type: 'attempt-started',
          agentId: TANGYUAN_DEFAULT_AGENT_ID,
          sessionId: request.sessionId,
          runId: `${request.sessionId}-run-1`,
          occurredAt: '2026-07-17T00:00:01.000Z',
        })
        const deferred = createDeferred<void>()
        sessionDeferreds.set(request.sessionId, deferred)
        await deferred.promise
        sessionDriver.emit({
          type: 'run-state-changed',
          agentId: TANGYUAN_DEFAULT_AGENT_ID,
          sessionId: request.sessionId,
          state: 'completed',
          occurredAt: '2026-07-17T00:00:05.000Z',
        })
      })
      const runtime = createTangyuanRuntimeForTesting({
        runtimeDriver,
        sessionDriver,
      })
      await runtime.listSessions()

      // 同时发送 4 条消息
      const runs = sessions.map((s) =>
        runtime.sendMessage({
          agentId: TANGYUAN_DEFAULT_AGENT_ID,
          sessionId: s.sessionId,
          content: 'hello',
        }),
      )

      // 等待所有 4 个都进入 running 状态
      await vi.waitFor(() => {
        expect(sessionDeferreds.size).toBe(4)
      })
      // 确认 4 个都在运行中
      const sessionList = await runtime.listSessions()
      const runningCount = sessionList.filter(
        (s) => s.state === 'running',
      ).length
      expect(runningCount).toBe(4)

      // 完成所有 run
      for (const deferred of sessionDeferreds.values()) {
        deferred.resolve()
      }
      await Promise.all(runs)
    })

    it('enqueues a fifth request when all four slots are active', async () => {
      const sessions = [1, 2, 3, 4, 5].map((n) =>
        createSessionSummary(`session-${n}`),
      )
      const runtimeDriver = createRuntimeDriver(
        createSnapshot({
          providerId: 'anthropic',
          modelId: 'claude-sonnet-4-5',
          maskedValue: 'sk-t...7890',
        }),
      )
      const sessionDriver = createSessionDriver(sessions)
      const sessionDeferreds = new Map<
        string,
        ReturnType<typeof createDeferred<void>>
      >()
      sessionDriver.sendMessage = vi.fn(async (request) => {
        sessionDriver.emit({
          type: 'attempt-started',
          agentId: TANGYUAN_DEFAULT_AGENT_ID,
          sessionId: request.sessionId,
          runId: `${request.sessionId}-run-1`,
          occurredAt: '2026-07-17T00:00:01.000Z',
        })
        // 只有前 4 个 session 的 run 会被 deferred 暂停
        const deferred = sessionDeferreds.get(request.sessionId)
        if (deferred) {
          await deferred.promise
        }
        sessionDriver.emit({
          type: 'run-state-changed',
          agentId: TANGYUAN_DEFAULT_AGENT_ID,
          sessionId: request.sessionId,
          state: 'completed',
          occurredAt: '2026-07-17T00:00:05.000Z',
        })
      })
      const runtime = createTangyuanRuntimeForTesting({
        runtimeDriver,
        sessionDriver,
      })
      await runtime.listSessions()

      const startedSessions: string[] = []
      const queuedSessions: string[] = []
      runtime.subscribe((event) => {
        if (event.type === 'attempt-started') {
          startedSessions.push(event.sessionId)
        }
        if (event.type === 'run-state-changed' && event.state === 'queued') {
          queuedSessions.push(event.sessionId)
        }
      })

      // 前 4 个 session 的 run 会被暂停
      for (const s of sessions.slice(0, 4)) {
        sessionDeferreds.set(s.sessionId, createDeferred<void>())
      }

      // 同时发送 5 条消息
      const runs = sessions.map((s) =>
        runtime.sendMessage({
          agentId: TANGYUAN_DEFAULT_AGENT_ID,
          sessionId: s.sessionId,
          content: 'hello',
        }),
      )

      // 等待前 4 个进入 running
      await vi.waitFor(() => {
        expect(startedSessions.length).toBe(4)
      })

      // 第 5 个应进入 queued
      await vi.waitFor(() => {
        expect(queuedSessions.length).toBe(1)
      })
      expect(queuedSessions[0]).toBe('session-5')

      // 完成前 4 个 — 第 5 个应自动 dequeue 并启动
      for (const deferred of sessionDeferreds.values()) {
        deferred.resolve()
      }
      await vi.waitFor(() => {
        expect(startedSessions.length).toBe(5)
      })
      expect(startedSessions).toContain('session-5')
      await Promise.all(runs)
    })

    it('dequeues in FIFO order when slots are released', async () => {
      const sessions = [1, 2, 3, 4, 5, 6].map((n) =>
        createSessionSummary(`session-${n}`),
      )
      const runtimeDriver = createRuntimeDriver(
        createSnapshot({
          providerId: 'anthropic',
          modelId: 'claude-sonnet-4-5',
          maskedValue: 'sk-t...7890',
        }),
      )
      const sessionDriver = createSessionDriver(sessions)
      const sessionDeferreds = new Map<
        string,
        ReturnType<typeof createDeferred<void>>
      >()
      const startedSessions: string[] = []
      sessionDriver.sendMessage = vi.fn(async (request) => {
        startedSessions.push(request.sessionId)
        sessionDriver.emit({
          type: 'attempt-started',
          agentId: TANGYUAN_DEFAULT_AGENT_ID,
          sessionId: request.sessionId,
          runId: `${request.sessionId}-run-1`,
          occurredAt: '2026-07-17T00:00:01.000Z',
        })
        const deferred = sessionDeferreds.get(request.sessionId)
        if (deferred) {
          await deferred.promise
        }
        sessionDriver.emit({
          type: 'run-state-changed',
          agentId: TANGYUAN_DEFAULT_AGENT_ID,
          sessionId: request.sessionId,
          state: 'completed',
          occurredAt: '2026-07-17T00:00:05.000Z',
        })
      })
      const runtime = createTangyuanRuntimeForTesting({
        runtimeDriver,
        sessionDriver,
      })
      await runtime.listSessions()

      // 所有 6 个都被暂停，防止级联 dequeue
      for (const s of sessions) {
        sessionDeferreds.set(s.sessionId, createDeferred<void>())
      }

      // 发送全部 6 条
      const runs = sessions.map((s) =>
        runtime.sendMessage({
          agentId: TANGYUAN_DEFAULT_AGENT_ID,
          sessionId: s.sessionId,
          content: 'hello',
        }),
      )

      // 等待前 4 个启动，后 2 个排队
      await vi.waitFor(() => {
        expect(startedSessions.length).toBe(4)
      })
      expect(startedSessions).toEqual([
        'session-1',
        'session-2',
        'session-3',
        'session-4',
      ])

      // 释放 session-1 → session-5 应启动
      sessionDeferreds.get('session-1')?.resolve()
      await vi.waitFor(() => {
        expect(startedSessions.length).toBe(5)
      })
      expect(startedSessions[4]).toBe('session-5')

      // 释放 session-2 → session-6 应启动
      sessionDeferreds.get('session-2')?.resolve()
      await vi.waitFor(() => {
        expect(startedSessions.length).toBe(6)
      })
      expect(startedSessions[5]).toBe('session-6')

      // 释放剩余
      for (const d of sessionDeferreds.values()) {
        d.resolve()
      }
      await Promise.all(runs)
    })

    it('rejects a send for a session that is already queued', async () => {
      const sessions = [1, 2, 3, 4, 5].map((n) =>
        createSessionSummary(`session-${n}`),
      )
      const runtimeDriver = createRuntimeDriver(
        createSnapshot({
          providerId: 'anthropic',
          modelId: 'claude-sonnet-4-5',
          maskedValue: 'sk-t...7890',
        }),
      )
      const sessionDriver = createSessionDriver(sessions)
      const sessionDeferreds = new Map<
        string,
        ReturnType<typeof createDeferred<void>>
      >()
      sessionDriver.sendMessage = vi.fn(async (request) => {
        sessionDriver.emit({
          type: 'attempt-started',
          agentId: TANGYUAN_DEFAULT_AGENT_ID,
          sessionId: request.sessionId,
          runId: `${request.sessionId}-run-1`,
          occurredAt: '2026-07-17T00:00:01.000Z',
        })
        const deferred = sessionDeferreds.get(request.sessionId)
        if (deferred) {
          await deferred.promise
        }
        sessionDriver.emit({
          type: 'run-state-changed',
          agentId: TANGYUAN_DEFAULT_AGENT_ID,
          sessionId: request.sessionId,
          state: 'completed',
          occurredAt: '2026-07-17T00:00:05.000Z',
        })
      })
      const runtime = createTangyuanRuntimeForTesting({
        runtimeDriver,
        sessionDriver,
      })
      await runtime.listSessions()

      // 所有 5 个 session 都用 deferred 暂停，防止级联 dequeue
      for (const s of sessions) {
        sessionDeferreds.set(s.sessionId, createDeferred<void>())
      }

      // 同时发送 5 条
      const runs = sessions.map((s) =>
        runtime.sendMessage({
          agentId: TANGYUAN_DEFAULT_AGENT_ID,
          sessionId: s.sessionId,
          content: 'hello',
        }),
      )

      // 等待前 4 个进入 running
      await vi.waitFor(() => {
        const runningSessions = Array.from(sessionDeferreds.keys()).filter(
          (id) => {
            // session-5 should NOT be running (it's queued)
            return id !== 'session-5'
          },
        )
        expect(runningSessions.length).toBe(4)
      })

      // 等待 session-5 进入 queued 状态
      const queuedPromise = new Promise<void>((resolve) => {
        const unsubscribe = runtime.subscribe((event) => {
          if (
            event.type === 'run-state-changed' &&
            event.sessionId === 'session-5' &&
            event.state === 'queued'
          ) {
            unsubscribe.unsubscribe()
            resolve()
          }
        })
      })
      await queuedPromise

      // 对已在队列中的 session-5 再次发送会失败
      await expect(
        runtime.sendMessage({
          agentId: TANGYUAN_DEFAULT_AGENT_ID,
          sessionId: 'session-5',
          content: '重复发送',
        }),
      ).rejects.toThrow('当前会话已在排队中')

      // 清理
      for (const deferred of sessionDeferreds.values()) {
        deferred.resolve()
      }
      await Promise.all(runs)
    })

    it('cancels a queued run and prevents it from starting', async () => {
      const sessions = [1, 2, 3, 4, 5].map((n) =>
        createSessionSummary(`session-${n}`),
      )
      const runtimeDriver = createRuntimeDriver(
        createSnapshot({
          providerId: 'anthropic',
          modelId: 'claude-sonnet-4-5',
          maskedValue: 'sk-t...7890',
        }),
      )
      const sessionDriver = createSessionDriver(sessions)
      const sessionDeferreds = new Map<
        string,
        ReturnType<typeof createDeferred<void>>
      >()
      const startedSessions: string[] = []
      sessionDriver.sendMessage = vi.fn(async (request) => {
        startedSessions.push(request.sessionId)
        sessionDriver.emit({
          type: 'attempt-started',
          agentId: TANGYUAN_DEFAULT_AGENT_ID,
          sessionId: request.sessionId,
          runId: `${request.sessionId}-run-1`,
          occurredAt: '2026-07-17T00:00:01.000Z',
        })
        const deferred = sessionDeferreds.get(request.sessionId)
        if (deferred) {
          await deferred.promise
        }
        sessionDriver.emit({
          type: 'run-state-changed',
          agentId: TANGYUAN_DEFAULT_AGENT_ID,
          sessionId: request.sessionId,
          state: 'completed',
          occurredAt: '2026-07-17T00:00:05.000Z',
        })
      })
      const runtime = createTangyuanRuntimeForTesting({
        runtimeDriver,
        sessionDriver,
      })
      await runtime.listSessions()

      // 前 4 个被暂停
      for (const s of sessions.slice(0, 4)) {
        sessionDeferreds.set(s.sessionId, createDeferred<void>())
      }

      // 发送所有 5 条
      const runs = sessions.map((s) =>
        runtime.sendMessage({
          agentId: TANGYUAN_DEFAULT_AGENT_ID,
          sessionId: s.sessionId,
          content: 'hello',
        }),
      )

      // 等待 session-5 排队
      await vi.waitFor(() => {
        expect(startedSessions.length).toBe(4)
      })

      // 取消排队的 session-5
      const cancelled = await runtime.cancelRun({
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: 'session-5',
      })
      expect(cancelled.state).toBe('cancelled')
      // session-5 的 sendMessage promise 应 resolve 为空数组
      await expect(runs[4]).resolves.toEqual(
        expect.objectContaining({ sessionId: 'session-5', entries: [] }),
      )

      // 释放所有 slots → session-5 不应启动（已被取消且移出队列）
      for (const deferred of sessionDeferreds.values()) {
        deferred.resolve()
      }
      await Promise.all(runs.slice(0, 4))

      // 确认 session-5 从未被启动
      expect(startedSessions).not.toContain('session-5')
    })

    it('cancels a running run and dequeues the next queued request', async () => {
      const sessions = [1, 2, 3, 4, 5].map((n) =>
        createSessionSummary(`session-${n}`),
      )
      const runtimeDriver = createRuntimeDriver(
        createSnapshot({
          providerId: 'anthropic',
          modelId: 'claude-sonnet-4-5',
          maskedValue: 'sk-t...7890',
        }),
      )
      const sessionDriver = createSessionDriver(sessions)
      const sessionDeferreds = new Map<
        string,
        ReturnType<typeof createDeferred<void>>
      >()
      const startedSessions: string[] = []
      const abortedSessions: string[] = []
      sessionDriver.sendMessage = vi.fn(async (request) => {
        startedSessions.push(request.sessionId)
        sessionDriver.emit({
          type: 'attempt-started',
          agentId: TANGYUAN_DEFAULT_AGENT_ID,
          sessionId: request.sessionId,
          runId: `${request.sessionId}-run-1`,
          occurredAt: '2026-07-17T00:00:01.000Z',
        })
        const deferred = sessionDeferreds.get(request.sessionId)
        if (deferred) {
          await deferred.promise
        }
        // 除非已被中止，否则正常完成
        if (!abortedSessions.includes(request.sessionId)) {
          sessionDriver.emit({
            type: 'run-state-changed',
            agentId: TANGYUAN_DEFAULT_AGENT_ID,
            sessionId: request.sessionId,
            state: 'completed',
            occurredAt: '2026-07-17T00:00:05.000Z',
          })
        }
      })
      sessionDriver.cancelRun = vi.fn(async (request) => {
        abortedSessions.push(request.sessionId)
        const deferred = sessionDeferreds.get(request.sessionId)
        if (deferred) {
          deferred.resolve()
        }
        sessionDriver.emit({
          type: 'turn-cancelled',
          agentId: TANGYUAN_DEFAULT_AGENT_ID,
          sessionId: request.sessionId,
          runId: `${request.sessionId}-run-1`,
          occurredAt: '2026-07-17T00:00:03.000Z',
        })
      })
      const runtime = createTangyuanRuntimeForTesting({
        runtimeDriver,
        sessionDriver,
      })
      await runtime.listSessions()

      // 前 4 个被暂停
      for (const s of sessions.slice(0, 4)) {
        sessionDeferreds.set(s.sessionId, createDeferred<void>())
      }

      // 发送全部 5 条
      const runs = sessions.map((s) =>
        runtime.sendMessage({
          agentId: TANGYUAN_DEFAULT_AGENT_ID,
          sessionId: s.sessionId,
          content: 'hello',
        }),
      )

      // 等待前 4 启动 + session-5 排队
      await vi.waitFor(() => {
        expect(startedSessions.length).toBe(4)
      })

      // 取消 session-1（运行中）
      const cancelled = await runtime.cancelRun({
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: 'session-1',
      })
      expect(cancelled.state).toBe('cancelled')
      expect(abortedSessions).toContain('session-1')

      // session-5 应被 dequeue 并启动
      await vi.waitFor(() => {
        expect(startedSessions).toContain('session-5')
      })

      // 清理
      for (const deferred of sessionDeferreds.values()) {
        deferred.resolve()
      }
      await Promise.all(runs)
    })

    it('clears the queue and cancels active runs on cancelAllActiveRuns', async () => {
      const sessions = [1, 2, 3, 4, 5].map((n) =>
        createSessionSummary(`session-${n}`),
      )
      const runtimeDriver = createRuntimeDriver(
        createSnapshot({
          providerId: 'anthropic',
          modelId: 'claude-sonnet-4-5',
          maskedValue: 'sk-t...7890',
        }),
      )
      const sessionDriver = createSessionDriver(sessions)
      const sessionDeferreds = new Map<
        string,
        ReturnType<typeof createDeferred<void>>
      >()
      const startedSessions: string[] = []
      sessionDriver.sendMessage = vi.fn(async (request) => {
        startedSessions.push(request.sessionId)
        sessionDriver.emit({
          type: 'attempt-started',
          agentId: TANGYUAN_DEFAULT_AGENT_ID,
          sessionId: request.sessionId,
          runId: `${request.sessionId}-run-1`,
          occurredAt: '2026-07-17T00:00:01.000Z',
        })
        const deferred = sessionDeferreds.get(request.sessionId)
        if (deferred) {
          await deferred.promise
        }
        sessionDriver.emit({
          type: 'run-state-changed',
          agentId: TANGYUAN_DEFAULT_AGENT_ID,
          sessionId: request.sessionId,
          state: 'completed',
          occurredAt: '2026-07-17T00:00:05.000Z',
        })
      })
      sessionDriver.cancelRun = vi.fn(async (request) => {
        sessionDeferreds.get(request.sessionId)?.resolve()
        sessionDriver.emit({
          type: 'turn-cancelled',
          agentId: TANGYUAN_DEFAULT_AGENT_ID,
          sessionId: request.sessionId,
          runId: `${request.sessionId}-run-1`,
          occurredAt: '2026-07-17T00:00:03.000Z',
        })
      })
      const runtime = createTangyuanRuntimeForTesting({
        runtimeDriver,
        sessionDriver,
      })
      await runtime.listSessions()

      // 所有 session 都被暂停
      for (const s of sessions) {
        sessionDeferreds.set(s.sessionId, createDeferred<void>())
      }

      // 发送全部 5 条
      const runs = sessions.map((s) =>
        runtime.sendMessage({
          agentId: TANGYUAN_DEFAULT_AGENT_ID,
          sessionId: s.sessionId,
          content: 'hello',
        }),
      )

      // 等待前 4 个启动
      await vi.waitFor(() => {
        expect(startedSessions.length).toBe(4)
      })

      // cancelAllActiveRuns 应同时取消运行中和排队中的请求
      await runtime.cancelAllActiveRuns()

      // 所有 run 都应该 resolve
      const results = await Promise.allSettled(runs)
      const resolved = results.filter((r) => r.status === 'fulfilled')
      expect(resolved.length).toBe(5)
    })
  })
})
