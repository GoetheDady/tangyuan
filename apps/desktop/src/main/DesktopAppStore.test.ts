import type {
  AgentEventListener,
  AgentSessionDriver,
  RuntimeResourceDriver
} from '@tangyuan/agent-runtime'
import {
  TANGYUAN_DEFAULT_AGENT_ID,
  type AgentSessionSummary,
  type RuntimeSnapshot
} from '@tangyuan/shared'
import { describe, expect, it, vi } from 'vitest'
import { createDesktopAppStore } from './DesktopAppStore'

describe('DesktopAppStore', () => {
  it('coordinates runtime snapshot requests through the runtime driver', async () => {
    const snapshot = createSnapshot()
    const runtimeDriver = createRuntimeDriver(snapshot)
    const sessionDriver = createSessionDriver([])
    const store = createDesktopAppStore({ runtimeDriver, sessionDriver })

    await expect(store.getRuntimeSnapshot()).resolves.toEqual(snapshot)
    expect(runtimeDriver.getSnapshot).toHaveBeenCalledOnce()
  })

  it('creates sessions through the session driver and refreshes the cached list', async () => {
    const session = createSessionSummary('session-1')
    const runtimeDriver = createRuntimeDriver(createSnapshot())
    const sessionDriver = createSessionDriver([session])
    const store = createDesktopAppStore({ runtimeDriver, sessionDriver })

    await expect(
      store.createSession({ agentId: TANGYUAN_DEFAULT_AGENT_ID, title: '新会话' })
    ).resolves.toEqual(session)
    await expect(store.listSessions()).resolves.toEqual([session])
    expect(sessionDriver.createSession).toHaveBeenCalledWith({
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      title: '新会话'
    })
    expect(sessionDriver.listSessions).toHaveBeenCalledWith({
      agentId: TANGYUAN_DEFAULT_AGENT_ID
    })
  })
})

/**
 * 创建用于 Store 单元测试的运行时快照。
 *
 * @returns 一个缺少配置但包含默认 Agent profile 的 RuntimeSnapshot。
 * @throws 此测试辅助方法不会抛出错误。
 */
function createSnapshot(): RuntimeSnapshot {
  return {
    activeAgent: {
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      displayName: '汤圆',
      homePath: '~/.tangyuan/agents/tangyuan',
      profile: {
        initialized: false,
        soulUpdatedAt: null,
        userUpdatedAt: null
      }
    },
    providers: [],
    models: [],
    settings: {
      selectedProviderId: null,
      selectedModelId: null
    },
    auth: {
      state: 'missing-api-key',
      apiKey: {
        configured: false,
        maskedValue: null
      }
    },
    status: 'missing-config'
  }
}

/**
 * 创建可观察调用次数的 RuntimeResourceDriver 测试替身。
 *
 * @param snapshot - Driver 方法需要返回的运行时快照。
 * @returns 一个只用于单元测试的 RuntimeResourceDriver。
 * @throws 此测试辅助方法不会抛出错误。
 */
function createRuntimeDriver(snapshot: RuntimeSnapshot): RuntimeResourceDriver {
  return {
    getSnapshot: vi.fn().mockResolvedValue(snapshot),
    refresh: vi.fn().mockResolvedValue(snapshot)
  }
}

/**
 * 创建可观察调用参数的 AgentSessionDriver 测试替身。
 *
 * @param sessions - Driver 方法需要返回的会话摘要列表。
 * @returns 一个只用于单元测试的 AgentSessionDriver。
 * @throws 此测试辅助方法不会抛出错误。
 */
function createSessionDriver(sessions: AgentSessionSummary[]): AgentSessionDriver {
  const [firstSession] = sessions

  return {
    listSessions: vi.fn().mockResolvedValue(sessions),
    createSession: vi.fn().mockResolvedValue(firstSession),
    getMessages: vi.fn().mockResolvedValue([]),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    cancelRun: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn((listener: AgentEventListener) => {
      void listener

      return {
        unsubscribe: vi.fn()
      }
    })
  }
}

/**
 * 创建会话列表里展示的测试摘要。
 *
 * @param sessionId - 会话唯一标识。
 * @returns 默认 Agent 下的空闲会话摘要。
 * @throws 此测试辅助方法不会抛出错误。
 */
function createSessionSummary(sessionId: string): AgentSessionSummary {
  return {
    agentId: TANGYUAN_DEFAULT_AGENT_ID,
    sessionId,
    title: '新会话',
    state: 'idle',
    updatedAt: '2026-07-08T00:00:00.000Z'
  }
}
