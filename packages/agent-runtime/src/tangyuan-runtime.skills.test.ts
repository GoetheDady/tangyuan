import { describe, expect, it } from 'vitest'
import { createTangyuanRuntimeForTesting } from './TangyuanRuntime'
import {
  createRuntimeDriver,
  createSessionDriver,
  createSnapshot,
} from './tangyuan-runtime.test-helpers'

describe('TangyuanRuntime', () => {
  describe('skill management', () => {
    it('rejects shared skill install by non-tangyuan agent', async () => {
      const runtimeDriver = createRuntimeDriver(createSnapshot())
      const sessionDriver = createSessionDriver([])
      const runtime = createTangyuanRuntimeForTesting({
        runtimeDriver,
        sessionDriver,
      })

      await expect(
        runtime.installSkill({
          operation: 'install',
          source: 'shared',
          agentId: 'agent-1',
          skillName: 'test-skill',
        }),
      ).rejects.toThrow('只有默认 Agent「汤圆」可以管理共享 Skill')
    })

    it('rejects shared skill delete by non-tangyuan agent', async () => {
      const runtimeDriver = createRuntimeDriver(createSnapshot())
      const sessionDriver = createSessionDriver([])
      const runtime = createTangyuanRuntimeForTesting({
        runtimeDriver,
        sessionDriver,
      })

      await expect(
        runtime.deleteSkill({
          operation: 'delete',
          source: 'shared',
          agentId: 'agent-1',
          skillName: 'test-skill',
        }),
      ).rejects.toThrow('只有默认 Agent「汤圆」可以管理共享 Skill')
    })

    it('rejects agent skill operation by another agent', async () => {
      const runtimeDriver = createRuntimeDriver(createSnapshot())
      const sessionDriver = createSessionDriver([])
      const runtime = createTangyuanRuntimeForTesting({
        runtimeDriver,
        sessionDriver,
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

    it('rejects install when session driver does not support it', async () => {
      const runtimeDriver = createRuntimeDriver(createSnapshot())
      const sessionDriver = createSessionDriver([])
      const runtime = createTangyuanRuntimeForTesting({
        runtimeDriver,
        sessionDriver,
      })

      await expect(
        runtime.installSkill({
          operation: 'install',
          source: 'shared',
          agentId: 'tangyuan',
          skillName: 'test-skill',
        }),
      ).rejects.toThrow('当前运行时不支持安装 Skill')
    })

    it('rejects delete when session driver does not support it', async () => {
      const runtimeDriver = createRuntimeDriver(createSnapshot())
      const sessionDriver = createSessionDriver([])
      const runtime = createTangyuanRuntimeForTesting({
        runtimeDriver,
        sessionDriver,
      })

      await expect(
        runtime.deleteSkill({
          operation: 'delete',
          source: 'agent',
          agentId: 'agent-1',
          targetAgentId: 'agent-1',
          skillName: 'test-skill',
        }),
      ).rejects.toThrow('当前运行时不支持删除 Skill')
    })

    it('returns empty pending skill approvals initially', () => {
      const runtimeDriver = createRuntimeDriver(createSnapshot())
      const sessionDriver = createSessionDriver([])
      const runtime = createTangyuanRuntimeForTesting({
        runtimeDriver,
        sessionDriver,
      })

      expect(runtime.getPendingSkillApprovals()).toEqual([])
    })
  })
})
