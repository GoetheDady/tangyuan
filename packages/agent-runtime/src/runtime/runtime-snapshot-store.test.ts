import { describe, expect, it, vi } from 'vitest'
import type { RuntimeSnapshot } from '@yuanxiao/contracts'
import type { RuntimeConfigurationModule } from './runtime-modules'
import { RuntimeSnapshotStore } from './runtime-snapshot-store'

function makeSnapshot(
  status: RuntimeSnapshot['status'] = 'ready',
): RuntimeSnapshot {
  return { status } as RuntimeSnapshot
}

function createDriver(
  overrides: Partial<RuntimeConfigurationModule> = {},
): RuntimeConfigurationModule {
  const snapshot = makeSnapshot()
  return {
    getSnapshot: vi.fn(async () => snapshot),
    refresh: vi.fn(async () => snapshot),
    saveConfiguration: vi.fn(async () => snapshot),
    cancelConfigurationVerification: vi.fn(async () => snapshot),
    restoreFromBackup: vi.fn(async () => snapshot),
    resetConfiguration: vi.fn(async () => undefined),
    saveProvider: vi.fn(async () => snapshot),
    deleteProvider: vi.fn(async () => snapshot),
    ...overrides,
  }
}

describe('RuntimeSnapshotStore', () => {
  it('getOrLoad 首次读取 Driver，之后命中缓存', async () => {
    const driver = createDriver()
    const store = new RuntimeSnapshotStore({ configuration: driver })

    await store.getOrLoad()
    await store.getOrLoad()

    expect(driver.getSnapshot).toHaveBeenCalledTimes(1)
  })

  it('reload 每次都读取 Driver 并刷新缓存', async () => {
    const driver = createDriver()
    const store = new RuntimeSnapshotStore({ configuration: driver })

    await store.reload()
    await store.getOrLoad()

    expect(driver.getSnapshot).toHaveBeenCalledTimes(1)
  })

  it('refresh 走 Driver.refresh', async () => {
    const driver = createDriver()
    const store = new RuntimeSnapshotStore({ configuration: driver })

    await store.refresh()

    expect(driver.refresh).toHaveBeenCalledTimes(1)
  })

  it('saveConfiguration 保存后缓存被写入', async () => {
    const saved = makeSnapshot('ready')
    const driver = createDriver({
      saveConfiguration: vi.fn(async () => saved),
    })
    const store = new RuntimeSnapshotStore({ configuration: driver })

    const result = await store.saveConfiguration({} as never)
    expect(result).toBe(saved)
    // 缓存已写入：getOrLoad 不再触发 getSnapshot
    await store.getOrLoad()
    expect(driver.getSnapshot).not.toHaveBeenCalled()
  })

  it('resetConfiguration 重置后重载缓存', async () => {
    const driver = createDriver({ resetConfiguration: vi.fn(async () => {}) })
    const store = new RuntimeSnapshotStore({ configuration: driver })

    await store.resetConfiguration()

    expect(driver.resetConfiguration).toHaveBeenCalledTimes(1)
    expect(driver.getSnapshot).toHaveBeenCalledTimes(1)
  })
})
