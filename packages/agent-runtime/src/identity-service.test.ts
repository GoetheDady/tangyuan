import { describe, expect, it, vi } from 'vitest'
import type { AgentSessionDriver } from './index'
import type { RuntimeSnapshotStore } from './runtime-snapshot-store'
import { IdentityService } from './identity-service'

function createStore() {
  return {
    reload: vi.fn(async () => ({})),
  } as unknown as RuntimeSnapshotStore & {
    reload: ReturnType<typeof vi.fn>
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

  it('updateSoul 透传观察版本并在实际更新后刷新快照', async () => {
    const updateSoul = vi.fn(
      async () => ({ status: 'updated', version: 'sha256:new' }) as never,
    )
    const { service, snapshotStore } = createService({ updateSoul })

    await service.updateSoul('a1', '新内容', 'sha256:old')

    expect(updateSoul).toHaveBeenCalledWith('a1', '新内容', 'sha256:old')
    expect(snapshotStore.reload).toHaveBeenCalledTimes(1)
  })

  it('updateSoul 未写入时不刷新快照', async () => {
    const { service, snapshotStore } = createService({
      updateSoul: vi.fn(
        async () => ({ status: 'unchanged', version: 'sha256:same' }) as never,
      ),
    })
    await service.updateSoul('a1', 'x', 'sha256:same')
    expect(snapshotStore.reload).not.toHaveBeenCalled()
  })

  it('updateSoul 写入成功后即使快照刷新失败也返回成功结果', async () => {
    const updated = {
      target: 'soul',
      status: 'updated',
      version: 'sha256:new',
    } as const
    const { service, snapshotStore } = createService({
      updateSoul: vi.fn(async () => updated),
    })
    snapshotStore.reload.mockRejectedValueOnce(new Error('reload failed'))

    await expect(
      service.updateSoul('a1', '新内容', 'sha256:old'),
    ).resolves.toEqual(updated)
  })

  it('updateUserProfile 成功后刷新快照', async () => {
    const { service, snapshotStore } = createService({
      updateUserProfile: vi.fn(
        async () => ({ status: 'updated', version: 'sha256:new' }) as never,
      ),
    })
    await service.updateUserProfile('内容', 'sha256:old')
    expect(snapshotStore.reload).toHaveBeenCalledTimes(1)
  })

  it('用户画像更新后快照刷新失败不影响写入结果', async () => {
    const { service, snapshotStore } = createService({
      updateUserProfile: vi.fn(
        async () => ({ status: 'updated', version: 'sha256:new' }) as never,
      ),
    })
    snapshotStore.reload.mockRejectedValueOnce(new Error('reload failed'))

    await expect(
      service.updateUserProfile('内容', 'sha256:old'),
    ).resolves.toMatchObject({ status: 'updated' })
  })
})
