import { describe, expect, it, vi } from 'vitest'
import type { RuntimeSnapshot } from '@tangyuan/contracts'
import type { RuntimeResourceDriver } from './index'
import { RuntimeSnapshotStore } from './runtime-snapshot-store'

function makeSnapshot(status: RuntimeSnapshot['status'] = 'ready'): RuntimeSnapshot {
  return { status } as RuntimeSnapshot
}

function createDriver(
  overrides: Partial<RuntimeResourceDriver> = {},
): RuntimeResourceDriver {
  return {
    getSnapshot: vi.fn(async () => makeSnapshot()),
    refresh: vi.fn(async () => makeSnapshot()),
    ...overrides,
  } as RuntimeResourceDriver
}

describe('RuntimeSnapshotStore', () => {
  it('getOrLoad 首次读取 Driver，之后命中缓存', async () => {
    const driver = createDriver()
    const store = new RuntimeSnapshotStore({ runtimeDriver: driver })

    await store.getOrLoad()
    await store.getOrLoad()

    expect(driver.getSnapshot).toHaveBeenCalledTimes(1)
  })

  it('reload 每次都读取 Driver 并刷新缓存', async () => {
    const driver = createDriver()
    const store = new RuntimeSnapshotStore({ runtimeDriver: driver })

    await store.reload()
    await store.getOrLoad()

    expect(driver.getSnapshot).toHaveBeenCalledTimes(1)
  })

  it('refresh 走 Driver.refresh', async () => {
    const driver = createDriver()
    const store = new RuntimeSnapshotStore({ runtimeDriver: driver })

    await store.refresh()

    expect(driver.refresh).toHaveBeenCalledTimes(1)
  })

  it('saveConfiguration 缺少能力时抛错', async () => {
    const store = new RuntimeSnapshotStore({ runtimeDriver: createDriver() })
    await expect(
      store.saveConfiguration({} as never),
    ).rejects.toThrow('不支持保存配置')
  })

  it('saveConfiguration 保存后缓存被写入', async () => {
    const saved = makeSnapshot('ready')
    const driver = createDriver({
      saveConfiguration: vi.fn(async () => saved),
    })
    const store = new RuntimeSnapshotStore({ runtimeDriver: driver })

    const result = await store.saveConfiguration({} as never)
    expect(result).toBe(saved)
    // 缓存已写入：getOrLoad 不再触发 getSnapshot
    await store.getOrLoad()
    expect(driver.getSnapshot).not.toHaveBeenCalled()
  })

  it('resetConfiguration 缺少能力时抛错', async () => {
    const store = new RuntimeSnapshotStore({ runtimeDriver: createDriver() })
    await expect(store.resetConfiguration()).rejects.toThrow('不支持配置重置')
  })

  it('resetConfiguration 重置后重载缓存', async () => {
    const driver = createDriver({ resetConfiguration: vi.fn(async () => {}) })
    const store = new RuntimeSnapshotStore({ runtimeDriver: driver })

    await store.resetConfiguration()

    expect(driver.resetConfiguration).toHaveBeenCalledTimes(1)
    expect(driver.getSnapshot).toHaveBeenCalledTimes(1)
  })

  it('restoreFromBackup 与 cancelConfigurationVerification 缺少能力时抛错', async () => {
    const store = new RuntimeSnapshotStore({ runtimeDriver: createDriver() })
    await expect(store.restoreFromBackup()).rejects.toThrow('不支持配置恢复')
    await expect(
      store.cancelConfigurationVerification({} as never),
    ).rejects.toThrow('不支持取消配置验证')
  })
})
