import { describe, expect, it, vi } from 'vitest'
import type { AgentSessionDriver } from './index'
import type { RuntimeSnapshotStore } from './runtime-snapshot-store'
import { IdentityService } from './identity-service'

function createStore() {
  return {
    reload: vi.fn(async () => ({})),
    getOrLoad: vi.fn(async () => ({ activeAgent: { agentId: 'tangyuan' } })),
  } as unknown as RuntimeSnapshotStore & {
    reload: ReturnType<typeof vi.fn>
    getOrLoad: ReturnType<typeof vi.fn>
  }
}

function createService(driver: Partial<AgentSessionDriver>) {
  const snapshotStore = createStore()
  const service = new IdentityService({
    sessionDriver: driver as AgentSessionDriver,
    snapshotStore,
  })
  return { service, snapshotStore }
}

describe('IdentityService', () => {
  it('getSoul / getUserProfile 委托 Driver', async () => {
    const { service } = createService({
      getSoul: vi.fn(async () => ({ content: 's' }) as never),
      getUserProfile: vi.fn(async () => ({ content: 'u' }) as never),
    })
    expect(await service.getSoul('a1')).toEqual({ content: 's' })
    expect(await service.getUserProfile()).toEqual({ content: 'u' })
  })

  it('getSoul 缺少能力时抛错', async () => {
    const { service } = createService({})
    await expect(service.getSoul('a1')).rejects.toThrow('不支持读取 Agent soul')
  })

  it('updateSoul 以 activeAgent 作为发起方并在成功后刷新快照', async () => {
    const updateSoul = vi.fn(async () => ({ success: true }) as never)
    const { service, snapshotStore } = createService({ updateSoul })

    await service.updateSoul('a1', '新内容')

    expect(updateSoul).toHaveBeenCalledWith('a1', '新内容', 'tangyuan')
    expect(snapshotStore.reload).toHaveBeenCalledTimes(1)
  })

  it('updateSoul 失败时不刷新快照', async () => {
    const { service, snapshotStore } = createService({
      updateSoul: vi.fn(async () => ({ success: false }) as never),
    })
    await service.updateSoul('a1', 'x')
    expect(snapshotStore.reload).not.toHaveBeenCalled()
  })

  it('updateUserProfile 成功后刷新快照', async () => {
    const { service, snapshotStore } = createService({
      updateUserProfile: vi.fn(async () => ({ success: true }) as never),
    })
    await service.updateUserProfile('内容')
    expect(snapshotStore.reload).toHaveBeenCalledTimes(1)
  })
})
