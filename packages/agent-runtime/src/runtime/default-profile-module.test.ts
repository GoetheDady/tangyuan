import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@yuanxiao/contracts'
import type { ProfileWriteOutcome } from '../profile'
import { DefaultProfileModule } from './default-profile-module'

const NOW = '2026-08-03T00:00:00.000Z'

function createProfileStore(overrides?: {
  soulOutcome?: ProfileWriteOutcome
  userOutcome?: ProfileWriteOutcome
}) {
  return {
    readSoul: vi.fn(async (agentId: string) => ({
      agentId,
      content: 'soul',
      updatedAt: NOW,
      version: 'soul-v1',
    })),
    readUserProfile: vi.fn(async () => ({
      content: 'user',
      updatedAt: NOW,
      version: 'user-v1',
    })),
    writeSoul: vi.fn(
      async () =>
        overrides?.soulOutcome ?? {
          written: true,
          result: {
            target: 'soul' as const,
            status: 'updated' as const,
            version: 'soul-v2',
          },
        },
    ),
    writeUserProfile: vi.fn(
      async () =>
        overrides?.userOutcome ?? {
          written: true,
          result: {
            target: 'user' as const,
            status: 'updated' as const,
            version: 'user-v2',
          },
        },
    ),
  }
}

function createModule(options?: {
  profileStore?: ReturnType<typeof createProfileStore>
  refreshAgentContext?: (agentId: string) => Promise<void>
  refreshAllContexts?: () => Promise<void>
}) {
  const events: AgentEvent[] = []
  const profileStore = options?.profileStore ?? createProfileStore()
  const refreshAgentContext = vi.fn(
    options?.refreshAgentContext ?? (async () => undefined),
  )
  const refreshAllContexts = vi.fn(
    options?.refreshAllContexts ?? (async () => undefined),
  )
  const module = new DefaultProfileModule({
    emit: (event) => events.push(event),
    layout: {
      soul: (agentId) => `/missing/${agentId}/soul.md`,
      userProfile: () => '/missing/profile/user.md',
    },
    now: () => NOW,
    profileStore,
    refreshAgentContext,
    refreshAllContexts,
  })

  return {
    events,
    module,
    profileStore,
    refreshAgentContext,
    refreshAllContexts,
  }
}

describe('DefaultProfileModule', () => {
  it('soul 真正写入后广播事件并刷新对应 Agent 上下文', async () => {
    const context = createModule()

    await expect(
      context.module.updateSoul('agent-a', 'new soul', 'soul-v1'),
    ).resolves.toEqual({
      target: 'soul',
      status: 'updated',
      version: 'soul-v2',
    })

    expect(context.refreshAgentContext).toHaveBeenCalledWith('agent-a')
    expect(context.events).toContainEqual({
      type: 'profile-updated',
      agentId: 'agent-a',
      target: 'soul',
      updatedAt: NOW,
      occurredAt: NOW,
    })
  })

  it('内容未变化时不广播事件也不刷新会话', async () => {
    const profileStore = createProfileStore({
      soulOutcome: {
        written: false,
        result: {
          target: 'soul',
          status: 'unchanged',
          version: 'soul-v1',
        },
      },
    })
    const context = createModule({ profileStore })

    await context.module.updateSoul('agent-a', 'same soul', 'soul-v1')

    expect(context.refreshAgentContext).not.toHaveBeenCalled()
    expect(context.events).toEqual([])
  })

  it('user profile 已写入但刷新失败时保留成功结果并广播可恢复错误', async () => {
    const context = createModule({
      refreshAllContexts: async () => {
        throw new Error('reload failed')
      },
    })

    await expect(
      context.module.updateUserProfile('new user', 'user-v1'),
    ).resolves.toEqual({
      target: 'user',
      status: 'updated',
      version: 'user-v2',
    })

    expect(context.events).toEqual([
      {
        type: 'profile-updated',
        agentId: 'yuanxiao',
        target: 'user',
        updatedAt: NOW,
        occurredAt: NOW,
      },
      {
        type: 'runtime-error',
        agentId: 'yuanxiao',
        error: {
          code: 'unknown',
          message: '刷新 Agent 身份上下文失败：reload failed',
          recoverable: true,
        },
        occurredAt: NOW,
      },
    ])
  })
})
