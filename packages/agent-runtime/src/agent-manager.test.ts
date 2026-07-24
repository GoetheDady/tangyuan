import { describe, expect, it, vi } from 'vitest'
import type { AgentSessionDriver } from './index'
import type { RuntimeSnapshotStore } from './runtime-snapshot-store'
import { AgentManager } from './agent-manager'

function createSnapshotStore(): RuntimeSnapshotStore & {
  reload: ReturnType<typeof vi.fn>
  getOrLoad: ReturnType<typeof vi.fn>
} {
  return {
    reload: vi.fn(async () => ({})),
    getOrLoad: vi.fn(async () => ({ agents: [{ agentId: 'a1' }] })),
  } as unknown as RuntimeSnapshotStore & {
    reload: ReturnType<typeof vi.fn>
    getOrLoad: ReturnType<typeof vi.fn>
  }
}

function createManager(driver: Partial<AgentSessionDriver>) {
  const snapshotStore = createSnapshotStore()
  const manager = new AgentManager({
    sessionDriver: driver as AgentSessionDriver,
    snapshotStore,
  })
  return { manager, snapshotStore }
}

describe('AgentManager', () => {
  it('list 从快照读取 agents', async () => {
    const { manager } = createManager({})
    expect(await manager.list()).toEqual([{ agentId: 'a1' }])
  })

  it('create 委托 Driver 并刷新快照', async () => {
    const summary = { agentId: 'new' }
    const { manager, snapshotStore } = createManager({
      createAgent: vi.fn(async () => summary as never),
    })

    const result = await manager.create('新 Agent')

    expect(result).toBe(summary)
    expect(snapshotStore.reload).toHaveBeenCalledTimes(1)
  })

  it('create 缺少能力时抛错且不刷新', async () => {
    const { manager, snapshotStore } = createManager({})
    await expect(manager.create('x')).rejects.toThrow('不支持创建 Agent')
    expect(snapshotStore.reload).not.toHaveBeenCalled()
  })

  it('updateConfig 只透传已定义的字段', async () => {
    const updateAgentConfig = vi.fn(async () => ({ agentId: 'a1' }) as never)
    const { manager } = createManager({ updateAgentConfig })

    await manager.updateConfig({
      agentId: 'a1',
      defaultModelId: 'm1',
    } as never)

    expect(updateAgentConfig).toHaveBeenCalledWith('a1', {
      defaultModelId: 'm1',
    })
  })

  it('archive/recover/claimDirectory/rebuildTangyuanHome 均刷新快照', async () => {
    const { manager, snapshotStore } = createManager({
      archiveAgent: vi.fn(async () => ({}) as never),
      recoverAgent: vi.fn(async () => ({}) as never),
      claimAgentDirectory: vi.fn(async () => ({}) as never),
      rebuildTangyuanHome: vi.fn(async () => ({}) as never),
    })

    await manager.archive('a1')
    await manager.recover('a1')
    await manager.claimDirectory('a1', 'A1')
    await manager.rebuildTangyuanHome()

    expect(snapshotStore.reload).toHaveBeenCalledTimes(4)
  })

  it('reconcileDirectories 委托 Driver，不刷新快照', async () => {
    const report = { agents: [], unclaimedDirectories: [] }
    const { manager, snapshotStore } = createManager({
      reconcileAgentDirectories: vi.fn(async () => report as never),
    })

    expect(await manager.reconcileDirectories()).toBe(report)
    expect(snapshotStore.reload).not.toHaveBeenCalled()
  })
})
