import { describe, expect, it, vi } from 'vitest'
import type { SkillOperationParams } from '@yuanxiao/contracts'
import type { SessionModule, SkillModule } from '../runtime/runtime-modules'
import { SkillService } from './skill-service'

const DEFAULT_AGENT = 'yuanxiao'

function createService(driver: Partial<SessionModule & SkillModule>) {
  const skills = driver as SkillModule & SessionModule
  return new SkillService({
    skills,
    sessions: skills,
    defaultAgentId: DEFAULT_AGENT,
  })
}

function sharedInstall(
  overrides: Partial<SkillOperationParams> = {},
): SkillOperationParams {
  return {
    agentId: DEFAULT_AGENT,
    operation: 'install',
    source: 'shared',
    skillName: 'demo',
    ...overrides,
  }
}

describe('SkillService', () => {
  it('list 委托 SkillModule', async () => {
    const service = createService({
      listAgentSkills: vi.fn(async () => [{ name: 'a' }] as never),
      listSharedSkills: vi.fn(async () => [{ name: 's' }] as never),
    })
    await expect(service.listAgentSkills('a1')).resolves.toEqual([
      { name: 'a' },
    ])
    await expect(service.listSharedSkills()).resolves.toEqual([{ name: 's' }])
  })

  it('install 共享 Skill 后 reload 全部 session', async () => {
    const reloadAllSessions = vi.fn(async () => undefined)
    const installSkill = vi.fn(async () => [{ name: 'demo' }] as never)
    const service = createService({ installSkill, reloadAllSessions })

    await expect(service.install(sharedInstall())).resolves.toEqual([
      { name: 'demo' },
    ])
    expect(installSkill).toHaveBeenCalledWith(sharedInstall())
    expect(reloadAllSessions).toHaveBeenCalledOnce()
  })

  it('delete 专属 Skill 后 reload 目标 Agent', async () => {
    const reloadAgentSessions = vi.fn(async () => undefined)
    const deleteSkill = vi.fn(async () => [] as never)
    const service = createService({ deleteSkill, reloadAgentSessions })
    const params = {
      agentId: DEFAULT_AGENT,
      operation: 'delete',
      source: 'agent',
      targetAgentId: 'a1',
      skillName: 'x',
    } as SkillOperationParams

    await service.delete(params)

    expect(deleteSkill).toHaveBeenCalledWith(params)
    expect(reloadAgentSessions).toHaveBeenCalledWith('a1')
  })

  it('拒绝无权操作专属 Skill', async () => {
    const service = createService({ installSkill: vi.fn() })
    await expect(
      service.install({
        agentId: 'other',
        operation: 'install',
        source: 'agent',
        targetAgentId: 'victim',
        skillName: 'x',
      }),
    ).rejects.toThrow('无权管理')
  })

  it('拒绝非元宵操作共享 Skill', async () => {
    const service = createService({ installSkill: vi.fn() })
    await expect(
      service.install(sharedInstall({ agentId: 'other' })),
    ).rejects.toThrow('只有默认 Agent')
  })
})
