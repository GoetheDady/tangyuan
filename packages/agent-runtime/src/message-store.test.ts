import { describe, expect, it } from 'vitest'
import { MessageStore } from './message-store'
import { AgentRuntimeError } from './errors'

function makeStore(): MessageStore {
  return new MessageStore({ now: () => '2026-01-01T00:00:00.000Z' })
}

describe('MessageStore.append / getMessages', () => {
  it('追加消息生成递增 messageId 并可读回', () => {
    const store = makeStore()
    store.initSession('s1')

    const m1 = store.append({
      agentId: 'tangyuan',
      sessionId: 's1',
      role: 'user',
      content: '你好',
    })
    const m2 = store.append({
      agentId: 'tangyuan',
      sessionId: 's1',
      role: 'agent',
      content: '在',
    })

    expect(m1.messageId).toBe('s1-message-1')
    expect(m2.messageId).toBe('s1-message-2')
    expect(m1.createdAt).toBe('2026-01-01T00:00:00.000Z')
    expect(store.getMessages('s1')).toHaveLength(2)
  })

  it('未知会话 getMessages 返回空数组', () => {
    expect(makeStore().getMessages('missing')).toEqual([])
  })
})

describe('MessageStore.appendDelta', () => {
  it('把增量拼接到已有消息', () => {
    const store = makeStore()
    const m = store.append({
      agentId: 'a',
      sessionId: 's1',
      role: 'agent',
      content: '你',
    })
    store.appendDelta(m.messageId, '好')
    const next = store.appendDelta(m.messageId, '呀')

    expect(next.content).toBe('你好呀')
    expect(store.getMessages('s1')[0]?.content).toBe('你好呀')
  })

  it('消息不存在时抛错', () => {
    expect(() => makeStore().appendDelta('nope', 'x')).toThrow(AgentRuntimeError)
  })
})

describe('MessageStore.complete', () => {
  it('返回已完成的消息', () => {
    const store = makeStore()
    const m = store.append({
      agentId: 'a',
      sessionId: 's1',
      role: 'agent',
      content: '完成',
    })
    expect(store.complete(m.messageId).content).toBe('完成')
  })

  it('消息不存在时抛错', () => {
    expect(() => makeStore().complete('nope')).toThrow(AgentRuntimeError)
  })
})

describe('MessageStore.removeIfEmpty', () => {
  it('移除空消息返回 true，非空消息保留返回 false', () => {
    const store = makeStore()
    const empty = store.append({
      agentId: 'a',
      sessionId: 's1',
      role: 'agent',
      content: '',
    })
    const filled = store.append({
      agentId: 'a',
      sessionId: 's1',
      role: 'agent',
      content: '有内容',
    })

    expect(store.removeIfEmpty(empty.messageId)).toBe(true)
    expect(store.removeIfEmpty(filled.messageId)).toBe(false)
    const remaining = store.getMessages('s1')
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.messageId).toBe(filled.messageId)
  })

  it('消息不存在时返回 false', () => {
    expect(makeStore().removeIfEmpty('nope')).toBe(false)
  })
})
