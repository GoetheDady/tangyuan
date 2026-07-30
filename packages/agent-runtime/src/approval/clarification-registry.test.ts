import { describe, expect, it } from 'vitest'
import type {
  AgentEvent,
  QuestionClarificationRequest,
} from '@tangyuan/contracts'
import { ClarificationRegistry } from './clarification-registry'

function makeRequest(
  overrides: Partial<QuestionClarificationRequest> = {},
): QuestionClarificationRequest {
  return {
    clarificationId: 'clarify-1',
    agentId: 'tangyuan',
    sessionId: 'session-1',
    runId: 'run-1',
    question: '选哪个？',
    options: ['A', 'B'],
    allowCustomAnswer: true,
    status: 'pending',
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function createRegistry() {
  const events: AgentEvent[] = []
  const registry = new ClarificationRegistry({
    emit: (event) => events.push(event),
    now: () => '2024-01-01T00:00:00.000Z',
  })
  return { registry, events }
}

describe('ClarificationRegistry', () => {
  it('register 广播 clarification-required 并在 answer 后 resolve 答案', async () => {
    const { registry, events } = createRegistry()
    const promise = registry.register(makeRequest())

    expect(events[0]).toMatchObject({ type: 'clarification-required' })
    expect(registry.list()).toHaveLength(1)

    registry.answer('clarify-1', 'A')
    await expect(promise).resolves.toEqual({ answer: 'A' })
    expect(events[1]).toMatchObject({
      type: 'clarification-resolved',
      answer: 'A',
      status: 'answered',
    })
    expect(registry.list()).toHaveLength(0)
  })

  it('cancel 后 resolve 空答案并标记 cancelled', async () => {
    const { registry, events } = createRegistry()
    const promise = registry.register(makeRequest())
    registry.cancel('clarify-1')
    await expect(promise).resolves.toEqual({ answer: '' })
    expect(events[1]).toMatchObject({ status: 'cancelled', answer: '' })
  })

  it('answer 未知澄清抛错', () => {
    const { registry } = createRegistry()
    expect(() => registry.answer('missing', 'x')).toThrow(
      '找不到澄清请求 missing',
    )
  })

  it('cancelSession 只取消匹配会话的澄清', async () => {
    const { registry } = createRegistry()
    const p1 = registry.register(
      makeRequest({ clarificationId: 'c1', sessionId: 's1' }),
    )
    registry.register(makeRequest({ clarificationId: 'c2', sessionId: 's2' }))

    registry.cancelSession('s1')

    await expect(p1).resolves.toEqual({ answer: '' })
    expect(registry.list().map((r) => r.clarificationId)).toEqual(['c2'])
  })

  it('cancelAll 取消全部并清空', async () => {
    const { registry } = createRegistry()
    const p1 = registry.register(makeRequest({ clarificationId: 'c1' }))
    const p2 = registry.register(
      makeRequest({ clarificationId: 'c2', sessionId: 's2' }),
    )

    registry.cancelAll()

    await expect(Promise.all([p1, p2])).resolves.toEqual([
      { answer: '' },
      { answer: '' },
    ])
    expect(registry.list()).toHaveLength(0)
  })
})
