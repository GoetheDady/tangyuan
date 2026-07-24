import { describe, expect, it } from 'vitest'
import type { AgentEvent, BashApprovalRequest } from '@tangyuan/contracts'
import { BashApprovalRegistry } from './bash-approval-registry'

function makeRequest(
  overrides: Partial<BashApprovalRequest> = {},
): BashApprovalRequest {
  return {
    approvalId: 'approval-1',
    agentId: 'tangyuan',
    sessionId: 'session-1',
    runId: 'run-1',
    command: 'ls',
    cwd: '/tmp',
    riskDescription: '低风险',
    status: 'pending',
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function createRegistry() {
  const events: AgentEvent[] = []
  const registry = new BashApprovalRegistry({
    emit: (event) => events.push(event),
    now: () => '2024-01-01T00:00:00.000Z',
  })
  return { registry, events }
}

describe('BashApprovalRegistry', () => {
  it('register 广播 approval-required 并在 approve 后 resolve approved', async () => {
    const { registry, events } = createRegistry()
    const promise = registry.register(makeRequest())

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'approval-required',
      sessionId: 'session-1',
    })
    expect(registry.list()).toHaveLength(1)

    registry.approve('approval-1')
    await expect(promise).resolves.toEqual({ approved: true })
    expect(registry.list()).toHaveLength(0)
    expect(events[1]).toMatchObject({
      type: 'approval-resolved',
      status: 'approved',
    })
  })

  it('reject 后 resolve approved=false', async () => {
    const { registry } = createRegistry()
    const promise = registry.register(makeRequest())
    registry.reject('approval-1')
    await expect(promise).resolves.toEqual({ approved: false })
  })

  it('approve 未知审批抛错', () => {
    const { registry } = createRegistry()
    expect(() => registry.approve('missing')).toThrow('找不到审批请求 missing')
  })

  it('rejectSession 只拒绝匹配会话的审批', async () => {
    const { registry } = createRegistry()
    const p1 = registry.register(makeRequest({ approvalId: 'a1', sessionId: 's1' }))
    const p2 = registry.register(makeRequest({ approvalId: 'a2', sessionId: 's2' }))

    registry.rejectSession('s1')

    await expect(p1).resolves.toEqual({ approved: false })
    expect(registry.list().map((r) => r.approvalId)).toEqual(['a2'])
    registry.reject('a2')
    await expect(p2).resolves.toEqual({ approved: false })
  })

  it('rejectAll 拒绝全部并清空', async () => {
    const { registry } = createRegistry()
    const p1 = registry.register(makeRequest({ approvalId: 'a1' }))
    const p2 = registry.register(makeRequest({ approvalId: 'a2', sessionId: 's2' }))

    registry.rejectAll()

    await expect(Promise.all([p1, p2])).resolves.toEqual([
      { approved: false },
      { approved: false },
    ])
    expect(registry.list()).toHaveLength(0)
  })
})
