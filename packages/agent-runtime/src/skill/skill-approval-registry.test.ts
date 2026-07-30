import { describe, expect, it } from 'vitest'
import type { AgentEvent, SkillApprovalRequest } from '@tangyuan/contracts'
import { SkillApprovalRegistry } from './skill-approval-registry'

function makeRequest(
  overrides: Partial<SkillApprovalRequest> = {},
): SkillApprovalRequest {
  return {
    approvalId: 'skill-approval-1',
    agentId: 'tangyuan',
    operation: 'install',
    source: 'shared',
    skillName: 'demo',
    description: '',
    hasScripts: false,
    status: 'pending',
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function createRegistry() {
  const events: AgentEvent[] = []
  const registry = new SkillApprovalRegistry({
    emit: (event) => events.push(event),
    now: () => '2024-01-01T00:00:00.000Z',
  })
  return { registry, events }
}

describe('SkillApprovalRegistry', () => {
  it('register 广播 skill-approval-required 并在 approve 后 resolve approved', async () => {
    const { registry, events } = createRegistry()
    const promise = registry.register(makeRequest())

    expect(events[0]).toMatchObject({ type: 'skill-approval-required' })
    expect(registry.list()).toHaveLength(1)

    registry.approve('skill-approval-1')
    await expect(promise).resolves.toEqual({ approved: true })
    expect(events[1]).toMatchObject({
      type: 'skill-approval-resolved',
      status: 'approved',
    })
    expect(registry.list()).toHaveLength(0)
  })

  it('reject 后 resolve approved=false', async () => {
    const { registry } = createRegistry()
    const promise = registry.register(makeRequest())
    registry.reject('skill-approval-1')
    await expect(promise).resolves.toEqual({ approved: false })
  })

  it('approve 未知审批抛错', () => {
    const { registry } = createRegistry()
    expect(() => registry.approve('missing')).toThrow(
      '找不到 Skill 审批请求 missing',
    )
  })

  it('rejectAll 拒绝全部并清空', async () => {
    const { registry } = createRegistry()
    const p1 = registry.register(makeRequest({ approvalId: 's1' }))
    const p2 = registry.register(makeRequest({ approvalId: 's2' }))

    registry.rejectAll()

    await expect(Promise.all([p1, p2])).resolves.toEqual([
      { approved: false },
      { approved: false },
    ])
    expect(registry.list()).toHaveLength(0)
  })
})
