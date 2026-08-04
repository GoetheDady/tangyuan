import type { TranscriptSnapshot } from '@yuanxiao/contracts'
import { describe, expect, it, vi } from 'vitest'
import { createDeferred } from './yuanxiao-runtime.test-helpers'
import { RunAdmissionGate } from './run-admission-gate'

describe('RunAdmissionGate', () => {
  it('一次 submit 隐藏容量检查、排队、启动占位、执行与释放', async () => {
    let activeRunCount = 4
    const execute = vi.fn().mockResolvedValue(undefined)
    const transcript: TranscriptSnapshot = {
      agentId: 'yuanxiao',
      sessionId: 'queued-session',
      entries: [],
      updatedAt: '2026-08-04T10:00:00.000Z',
    }
    const emit = vi.fn()
    const upsertSessionState = vi.fn()
    const gate = new RunAdmissionGate({
      emit,
      upsertSessionState,
      getTranscript: vi.fn().mockResolvedValue(transcript),
      activeRunCount: () => activeRunCount,
      isRunActive: () => false,
      now: () => '2026-08-04T10:00:00.000Z',
    })

    const pending = gate.submit(
      { agentId: 'yuanxiao', sessionId: 'queued-session' },
      execute,
    )
    expect(execute).not.toHaveBeenCalled()
    expect(gate.isQueued('queued-session')).toBe(true)
    expect(upsertSessionState).toHaveBeenCalledWith(
      'queued-session',
      'queued',
      '2026-08-04T10:00:00.000Z',
    )

    activeRunCount = 3
    gate.applyEvent({
      type: 'run-state-changed',
      agentId: 'yuanxiao',
      sessionId: 'completed-session',
      state: 'completed',
      occurredAt: '2026-08-04T10:01:00.000Z',
    })

    await expect(pending).resolves.toBe(transcript)
    expect(execute).toHaveBeenCalledOnce()
    expect(gate.isQueued('queued-session')).toBe(false)
  })

  it('谱系 mutation 等待已登记的并发分叉，释放后重新允许会话运行', async () => {
    const gate = new RunAdmissionGate()
    const fork = createDeferred<void>()
    const trackedFork = gate.trackFork('parent', fork.promise)
    const lease = gate.acquireMutation('parent')

    expect(() => gate.assertAvailable('parent')).toThrow(
      '当前会话正在归档或删除，请稍后重试。',
    )

    let settled = false
    const waiting = lease.waitForPendingForks(['parent']).then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    fork.resolve()
    await trackedFork
    await waiting
    lease.release()
    expect(() => gate.assertAvailable('parent')).not.toThrow()
  })

  it('submit 建立的运行启动占位可等待，并由 Driver 事件释放', async () => {
    const run = createDeferred<void>()
    const gate = new RunAdmissionGate({
      emit: () => undefined,
      upsertSessionState: () => undefined,
      getTranscript: async () => ({
        agentId: 'yuanxiao',
        sessionId: 'session-1',
        entries: [],
        updatedAt: '2026-08-04T10:00:00.000Z',
      }),
      activeRunCount: () => 0,
      isRunActive: () => false,
      now: () => '2026-08-04T10:00:00.000Z',
    })
    const submitted = gate.submit(
      { agentId: 'yuanxiao', sessionId: 'session-1' },
      () => run.promise,
    )
    await Promise.resolve()

    expect(gate.isRunStarting('session-1')).toBe(true)

    let settled = false
    const waiting = gate.waitForRunStart('session-1').then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    gate.applyEvent({
      type: 'attempt-started',
      agentId: 'yuanxiao',
      sessionId: 'session-1',
      runId: 'run-1',
      occurredAt: '2026-08-04T10:00:00.000Z',
    })
    await waiting
    expect(gate.isRunStarting('session-1')).toBe(false)
    run.resolve()
    await submitted
  })

  it('重叠谱系 mutation 会被拒绝，释放后可重新获取', () => {
    const gate = new RunAdmissionGate()
    const first = gate.acquireMutation('parent')
    first.lock(['parent', 'child'])

    expect(() => gate.acquireMutation('child')).toThrow(
      '会话 child 已在其他归档或删除操作中。',
    )

    first.release()
    const next = gate.acquireMutation('child')
    expect(next.owns('child')).toBe(true)
    next.release()
  })
})
