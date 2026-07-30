import { describe, expect, it, vi } from 'vitest'
import { createTangyuanRuntimeForTesting } from './tangyuan-runtime'
import {
  createRuntimeDriver,
  createSessionDriver,
  createSnapshot,
} from './tangyuan-runtime.test-helpers'

describe('TangyuanRuntime capability guards', () => {
  it('rejects getSoul when the session driver does not support it', async () => {
    const snapshot = createSnapshot()
    const runtimeDriver = createRuntimeDriver(snapshot)
    const sessionDriver = createSessionDriver([])
    // 不设置 getSoul
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
    })

    await expect(runtime.getSoul('agent-1')).rejects.toThrow(
      '当前运行时不支持读取 Agent soul',
    )
  })
  it('rejects updateSoul when the session driver does not support it', async () => {
    const snapshot = createSnapshot()
    const runtimeDriver = createRuntimeDriver(snapshot)
    const sessionDriver = createSessionDriver([])
    // 不设置 updateSoul
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
    })

    await expect(
      runtime.updateSoul('agent-1', 'content', 'sha256:old'),
    ).rejects.toThrow('当前运行时不支持更新 Agent soul')
  })
  it('delegates listAgentSkills to session driver', async () => {
    const snapshot = createSnapshot()
    const runtimeDriver = createRuntimeDriver(snapshot)
    const sessionDriver = createSessionDriver([])
    sessionDriver.listAgentSkills = vi.fn().mockResolvedValue([
      {
        name: 'my-skill',
        description: 'A skill.',
        source: 'agent',
        path: '/path/SKILL.md',
        hasScripts: false,
      },
    ])
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
    })

    await expect(runtime.listAgentSkills('agent-1')).resolves.toEqual([
      {
        name: 'my-skill',
        description: 'A skill.',
        source: 'agent',
        path: '/path/SKILL.md',
        hasScripts: false,
      },
    ])
    expect(sessionDriver.listAgentSkills).toHaveBeenCalledWith('agent-1')
  })
  it('delegates listSharedSkills to session driver', async () => {
    const snapshot = createSnapshot()
    const runtimeDriver = createRuntimeDriver(snapshot)
    const sessionDriver = createSessionDriver([])
    sessionDriver.listSharedSkills = vi.fn().mockResolvedValue([
      {
        name: 'shared-skill',
        description: 'A shared skill.',
        source: 'shared',
        path: '/skills/shared/SKILL.md',
        hasScripts: false,
      },
    ])
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
    })

    await expect(runtime.listSharedSkills()).resolves.toEqual([
      {
        name: 'shared-skill',
        description: 'A shared skill.',
        source: 'shared',
        path: '/skills/shared/SKILL.md',
        hasScripts: false,
      },
    ])
    expect(sessionDriver.listSharedSkills).toHaveBeenCalledOnce()
  })
  it('rejects listAgentSkills when the session driver does not support it', async () => {
    const snapshot = createSnapshot()
    const runtimeDriver = createRuntimeDriver(snapshot)
    const sessionDriver = createSessionDriver([])
    // 不设置 listAgentSkills
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
    })

    await expect(runtime.listAgentSkills('agent-1')).rejects.toThrow(
      '当前运行时不支持读取 Agent Skills',
    )
  })
  it('rejects listSharedSkills when the session driver does not support it', async () => {
    const snapshot = createSnapshot()
    const runtimeDriver = createRuntimeDriver(snapshot)
    const sessionDriver = createSessionDriver([])
    // 不设置 listSharedSkills
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
    })

    await expect(runtime.listSharedSkills()).rejects.toThrow(
      '当前运行时不支持读取共享 Skills',
    )
  })
  it('delegates reloadAgentSessions to session driver', async () => {
    const snapshot = createSnapshot()
    const runtimeDriver = createRuntimeDriver(snapshot)
    const sessionDriver = createSessionDriver([])
    sessionDriver.reloadAgentSessions = vi.fn().mockResolvedValue(undefined)
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
    })

    await expect(
      runtime.reloadAgentSessions('agent-1'),
    ).resolves.toBeUndefined()
    expect(sessionDriver.reloadAgentSessions).toHaveBeenCalledWith('agent-1')
  })
  it('delegates reloadAllSessions to session driver', async () => {
    const snapshot = createSnapshot()
    const runtimeDriver = createRuntimeDriver(snapshot)
    const sessionDriver = createSessionDriver([])
    sessionDriver.reloadAllSessions = vi.fn().mockResolvedValue(undefined)
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
    })

    await expect(runtime.reloadAllSessions()).resolves.toBeUndefined()
    expect(sessionDriver.reloadAllSessions).toHaveBeenCalledOnce()
  })
  it('rejects reloadAgentSessions when the session driver does not support it', async () => {
    const snapshot = createSnapshot()
    const runtimeDriver = createRuntimeDriver(snapshot)
    const sessionDriver = createSessionDriver([])
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
    })

    await expect(runtime.reloadAgentSessions('agent-1')).rejects.toThrow(
      '当前运行时不支持重新加载 Agent session',
    )
  })
})
