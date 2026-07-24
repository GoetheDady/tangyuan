import { describe, expect, it } from 'vitest'
import type { AgentSessionSummary } from '@tangyuan/contracts'
import { SessionCache } from './session-cache'

function makeSession(
  overrides: Partial<AgentSessionSummary> = {},
): AgentSessionSummary {
  return {
    agentId: 'tangyuan',
    sessionId: 'session-1',
    title: '会话',
    state: 'idle',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('SessionCache', () => {
  it('replace 整体替换并可 list 读取', () => {
    const cache = new SessionCache()
    cache.replace([makeSession({ sessionId: 's1' }), makeSession({ sessionId: 's2' })])
    expect(cache.list().map((s) => s.sessionId)).toEqual(['s1', 's2'])
  })

  it('find 命中与未命中', () => {
    const cache = new SessionCache()
    cache.replace([makeSession({ sessionId: 's1' })])
    expect(cache.find('s1')?.sessionId).toBe('s1')
    expect(cache.find('missing')).toBeUndefined()
  })

  it('upsert 新增会话置顶', () => {
    const cache = new SessionCache()
    cache.replace([makeSession({ sessionId: 's1' })])
    cache.upsert(makeSession({ sessionId: 's2' }))
    expect(cache.list().map((s) => s.sessionId)).toEqual(['s2', 's1'])
  })

  it('upsert 已存在会话替换并置顶', () => {
    const cache = new SessionCache()
    cache.replace([
      makeSession({ sessionId: 's1' }),
      makeSession({ sessionId: 's2' }),
    ])
    cache.upsert(makeSession({ sessionId: 's1', title: '新标题' }))
    expect(cache.list().map((s) => s.sessionId)).toEqual(['s1', 's2'])
    expect(cache.find('s1')?.title).toBe('新标题')
  })

  it('updateState 只改匹配会话的状态与时间', () => {
    const cache = new SessionCache()
    cache.replace([
      makeSession({ sessionId: 's1', state: 'idle' }),
      makeSession({ sessionId: 's2', state: 'idle' }),
    ])
    cache.updateState('s1', 'running', '2024-02-02T00:00:00.000Z')
    expect(cache.find('s1')).toMatchObject({
      state: 'running',
      updatedAt: '2024-02-02T00:00:00.000Z',
    })
    expect(cache.find('s2')?.state).toBe('idle')
  })

  it('updateState 对不存在会话是无操作', () => {
    const cache = new SessionCache()
    cache.replace([makeSession({ sessionId: 's1' })])
    cache.updateState('missing', 'running', '2024-02-02T00:00:00.000Z')
    expect(cache.find('s1')?.state).toBe('idle')
  })
})
