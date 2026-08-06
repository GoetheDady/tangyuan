import type {
  AgentEvent,
  AgentEventListener,
  AgentSummary,
  RuntimeSnapshot,
} from '@yuanxiao/contracts'
import { createRuntimeSnapshot } from '@yuanxiao/contracts'
import { describe, expect, it, vi } from 'vitest'

import { createWorkbenchStore } from '@/stores/workbench-store'

import { createAgentEventBridge } from './agent-event-bridge'

const NOW = '2026-07-31T08:00:00.000Z'

const YUANXIAO: AgentSummary = {
  agentId: 'yuanxiao',
  displayName: '元宵',
  status: 'active',
  defaultProviderId: 'openai',
  defaultModelId: 'gpt-5',
  homePath: '~/.yuanxiao/agents/yuanxiao',
  archivedAt: null,
  directoryStatus: 'healthy',
}

const RESEARCHER: AgentSummary = {
  ...YUANXIAO,
  agentId: 'researcher',
  displayName: '研究助手',
  homePath: '~/.yuanxiao/agents/researcher',
}

function createRuntime(agents = [YUANXIAO]): RuntimeSnapshot {
  return createRuntimeSnapshot({
    activeAgent: {
      agentId: YUANXIAO.agentId,
      displayName: YUANXIAO.displayName,
      homePath: YUANXIAO.homePath,
      profile: {
        initialized: true,
        bootstrapRequired: false,
        soulUpdatedAt: NOW,
        userUpdatedAt: NOW,
      },
    },
    agents,
    providers: [{ providerId: 'openai', displayName: 'OpenAI' }],
    models: [{ providerId: 'openai', modelId: 'gpt-5', displayName: 'GPT-5' }],
    settings: { selectedProviderId: 'openai', selectedModelId: 'gpt-5' },
    configuredProviders: {
      openai: { configured: true, maskedValue: 'sk-...1234' },
    },
    auth: { apiKey: { configured: true, maskedValue: 'sk-...1234' } },
  })
}

function createHarness() {
  const store = createWorkbenchStore()
  let listener: AgentEventListener | null = null
  const unsubscribe = vi.fn()
  const callbacks = new Map<number, () => void>()
  let nextFrameId = 1
  const api = {
    subscribeToAgentEvents: vi.fn((nextListener: AgentEventListener) => {
      listener = nextListener
      return unsubscribe
    }),
    refreshRuntime: vi.fn<() => Promise<RuntimeSnapshot>>(),
  }
  const notifications = {
    success: vi.fn<(message: string) => void>(),
    info: vi.fn<(message: string) => void>(),
    error: vi.fn<(message: string) => void>(),
  }
  const frames = {
    request: vi.fn((callback: () => void) => {
      const frameId = nextFrameId++
      callbacks.set(frameId, callback)
      return frameId
    }),
    cancel: vi.fn((frameId: number) => {
      callbacks.delete(frameId)
    }),
  }
  const bridge = createAgentEventBridge({ store, api, notifications, frames })

  return {
    store,
    api,
    notifications,
    frames,
    bridge,
    unsubscribe,
    dispatch(event: AgentEvent): void {
      if (!listener) throw new Error('事件桥接层尚未订阅')
      listener(event)
    },
    flushFrame(): void {
      const frame = callbacks.entries().next().value
      if (!frame) throw new Error('没有待执行帧')
      const [frameId, callback] = frame
      callbacks.delete(frameId)
      callback()
    },
  }
}

describe('createAgentEventBridge', () => {
  it('订阅事件，并在释放时取消订阅', () => {
    const harness = createHarness()

    expect(harness.api.subscribeToAgentEvents).toHaveBeenCalledOnce()

    harness.bridge.dispose()

    expect(harness.unsubscribe).toHaveBeenCalledOnce()
    expect(harness.frames.cancel).not.toHaveBeenCalled()
  })

  it('将 Agent、session 事件归并到 store 并产生现有通知', () => {
    const harness = createHarness()

    harness.dispatch({
      type: 'agent-created',
      agentId: RESEARCHER.agentId,
      agent: RESEARCHER,
      occurredAt: NOW,
    })
    harness.dispatch({
      type: 'session-created',
      agentId: 'yuanxiao',
      session: {
        agentId: 'yuanxiao',
        sessionId: 'session-1',
        title: '新会话',
        state: 'idle',
        updatedAt: NOW,
      },
      occurredAt: NOW,
    })

    expect(harness.store.getState().agents).toEqual([RESEARCHER])
    expect(harness.store.getState().sessionsByAgentId.yuanxiao).toHaveLength(1)
    expect(harness.notifications.success).toHaveBeenCalledWith(
      '已创建 Agent「研究助手」',
    )
  })

  it('Profile 更新后刷新 Runtime，并按现有规则报告刷新失败', async () => {
    const success = createHarness()
    const nextRuntime = createRuntime([YUANXIAO, RESEARCHER])
    success.api.refreshRuntime.mockResolvedValue(nextRuntime)

    success.dispatch({
      type: 'profile-updated',
      agentId: 'yuanxiao',
      target: 'soul',
      updatedAt: NOW,
      occurredAt: NOW,
    })

    await vi.waitFor(() => {
      expect(success.store.getState().runtime).toBe(nextRuntime)
    })

    const failure = createHarness()
    failure.api.refreshRuntime.mockRejectedValue(new Error('刷新失败'))
    failure.dispatch({
      type: 'profile-updated',
      agentId: 'yuanxiao',
      target: 'user',
      updatedAt: NOW,
      occurredAt: NOW,
    })

    await vi.waitFor(() => {
      expect(failure.notifications.error).toHaveBeenCalledWith('刷新失败')
    })
  })

  it('同一帧按到达顺序合并 transcript delta，且只提交一次 store 更新', () => {
    const harness = createHarness()
    let storeUpdates = 0
    harness.store.subscribe(() => {
      storeUpdates += 1
    })

    harness.dispatch({
      type: 'transcript-delta',
      agentId: 'yuanxiao',
      sessionId: 'session-1',
      delta: {
        type: 'entry-appended',
        entry: {
          kind: 'agent-reply',
          index: 0,
          messageId: 'reply-1',
          content: '你',
          createdAt: NOW,
          attempt: null,
          turns: [],
        },
      },
      occurredAt: NOW,
    })
    harness.dispatch({
      type: 'transcript-delta',
      agentId: 'yuanxiao',
      sessionId: 'session-1',
      delta: { type: 'delta-appended', index: 0, delta: '好' },
      occurredAt: NOW,
    })

    expect(harness.frames.request).toHaveBeenCalledOnce()
    expect(storeUpdates).toBe(0)

    harness.flushFrame()

    expect(storeUpdates).toBe(1)
    expect(
      harness.store.getState().transcriptsBySessionId['session-1']?.entries[0],
    ).toMatchObject({ content: '你好' })
  })

  it('同一帧中不同 Agent 和 session 的 delta 只更新各自 transcript', () => {
    const harness = createHarness()

    for (const [agentId, sessionId, content] of [
      ['yuanxiao', 'session-1', '元宵回复'],
      ['researcher', 'session-2', '研究回复'],
    ] as const) {
      harness.dispatch({
        type: 'transcript-delta',
        agentId,
        sessionId,
        delta: {
          type: 'entry-appended',
          entry: {
            kind: 'agent-reply',
            index: 0,
            messageId: `reply-${sessionId}`,
            content,
            createdAt: NOW,
            attempt: null,
            turns: [],
          },
        },
        occurredAt: NOW,
      })
    }

    harness.flushFrame()

    expect(harness.store.getState().transcriptsBySessionId).toMatchObject({
      'session-1': { agentId: 'yuanxiao', entries: [{ content: '元宵回复' }] },
      'session-2': {
        agentId: 'researcher',
        entries: [{ content: '研究回复' }],
      },
    })
  })

  it('释放时取消待执行帧并丢弃尚未提交的 delta', () => {
    const harness = createHarness()
    harness.dispatch({
      type: 'transcript-delta',
      agentId: 'yuanxiao',
      sessionId: 'session-1',
      delta: {
        type: 'entry-appended',
        entry: {
          kind: 'user-message',
          index: 0,
          messageId: 'message-1',
          content: '不会提交',
          createdAt: NOW,
        },
      },
      occurredAt: NOW,
    })

    harness.bridge.dispose()

    expect(harness.frames.cancel).toHaveBeenCalledOnce()
    expect(harness.store.getState().transcriptsBySessionId).toEqual({})
  })

  it.each([
    ['turn-cancelled', { type: 'turn-cancelled', runId: 'run-2' }],
    [
      'turn-failed',
      {
        type: 'turn-failed',
        runId: 'run-2',
        error: { code: 'unknown', message: '执行失败', recoverable: true },
      },
    ],
    [
      'run-state-changed (completed)',
      { type: 'run-state-changed', state: 'completed' as const },
    ],
  ] as const)('%s 会结束对应 session 的发送状态', (_label, eventFragment) => {
    const harness = createHarness()
    harness.store.getState().startSessionExecution({ sessionId: 'session-1' })
    harness.store.getState().startSessionExecution({ sessionId: 'session-2' })

    harness.dispatch({
      agentId: 'yuanxiao',
      sessionId: 'session-2',
      occurredAt: NOW,
      ...eventFragment,
    })

    expect(harness.store.getState().sendingBySessionId).toEqual({
      'session-1': true,
      'session-2': false,
    })
  })
})
