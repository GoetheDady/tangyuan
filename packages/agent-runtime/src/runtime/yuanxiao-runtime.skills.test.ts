import { describe, expect, it } from 'vitest'
import { createYuanxiaoRuntimeForTesting } from './yuanxiao-runtime'
import {
  createRuntimeDriver,
  createSessionDriver,
  createSnapshot,
} from './yuanxiao-runtime.test-helpers'

describe('YuanxiaoRuntime', () => {
  describe('skill management', () => {
    it('rejects shared skill install by non-yuanxiao agent', async () => {
      const runtimeDriver = createRuntimeDriver(createSnapshot())
      const sessionDriver = createSessionDriver([])
      const runtime = createYuanxiaoRuntimeForTesting({
        configuration: runtimeDriver,
        sessions: sessionDriver,
        agents: sessionDriver,
        profiles: sessionDriver,
        skills: sessionDriver,
      })

      await expect(
        runtime.installSkill({
          operation: 'install',
          source: 'shared',
          agentId: 'agent-1',
          skillName: 'test-skill',
        }),
      ).rejects.toThrow('只有默认 Agent「元宵」可以管理共享 Skill')
    })

    it('rejects shared skill delete by non-yuanxiao agent', async () => {
      const runtimeDriver = createRuntimeDriver(createSnapshot())
      const sessionDriver = createSessionDriver([])
      const runtime = createYuanxiaoRuntimeForTesting({
        configuration: runtimeDriver,
        sessions: sessionDriver,
        agents: sessionDriver,
        profiles: sessionDriver,
        skills: sessionDriver,
      })

      await expect(
        runtime.deleteSkill({
          operation: 'delete',
          source: 'shared',
          agentId: 'agent-1',
          skillName: 'test-skill',
        }),
      ).rejects.toThrow('只有默认 Agent「元宵」可以管理共享 Skill')
    })

    it('rejects agent skill operation by another agent', async () => {
      const runtimeDriver = createRuntimeDriver(createSnapshot())
      const sessionDriver = createSessionDriver([])
      const runtime = createYuanxiaoRuntimeForTesting({
        configuration: runtimeDriver,
        sessions: sessionDriver,
        agents: sessionDriver,
        profiles: sessionDriver,
        skills: sessionDriver,
      })

      await expect(
        runtime.installSkill({
          operation: 'install',
          source: 'agent',
          agentId: 'agent-2',
          targetAgentId: 'agent-1',
          skillName: 'test-skill',
          skillDirPath: '/tmp/test-skill',
        }),
      ).rejects.toThrow('无权管理')
    })

  })
})
