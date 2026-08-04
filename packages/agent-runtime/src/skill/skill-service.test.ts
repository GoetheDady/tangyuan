import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent, SkillOperationParams } from '@yuanxiao/contracts'
import type { SessionModule, SkillModule } from '../runtime/runtime-modules'
import { SkillService } from './skill-service'

const DEFAULT_AGENT = 'yuanxiao'

function createService(driver: Partial<SessionModule & SkillModule>) {
  const events: AgentEvent[] = []
  const skills = {
    preflightSkillOperation: vi.fn(async () => ({
      description: '测试用途的 skill',
      hasScripts: false,
    })),
    ...driver,
  }
  const service = new SkillService({
    skills: skills as SkillModule,
    sessions: skills as SessionModule,
    defaultAgentId: DEFAULT_AGENT,
    emit: (event) => events.push(event),
    now: () => '2024-01-01T00:00:00.000Z',
  })
  return { service, events }
}

async function pendingApprovalId(service: SkillService): Promise<string> {
  await vi.waitFor(() => {
    expect(service.getPendingApprovals()).toHaveLength(1)
  })
  return service.getPendingApprovals()[0]!.approvalId
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
  } as SkillOperationParams
}

describe('SkillService', () => {
  it('list 委托 Driver', async () => {
    const { service } = createService({
      listAgentSkills: vi.fn(async () => [{ name: 'a' }] as never),
      listSharedSkills: vi.fn(async () => [{ name: 's' }] as never),
    })
    expect(await service.listAgentSkills('a1')).toEqual([{ name: 'a' }])
    expect(await service.listSharedSkills()).toEqual([{ name: 's' }])
  })

  it('install 共享 Skill：审批通过后执行并 reload 全部 session', async () => {
    const reloadAllSessions = vi.fn(async () => {})
    const installSkill = vi.fn(async () => [{ name: 'demo' }] as never)
    const { service } = createService({ installSkill, reloadAllSessions })

    const promise = service.install(sharedInstall())
    // 审批被登记后批准
    const approvalId = await pendingApprovalId(service)
    service.approveOperation(approvalId)

    expect(await promise).toEqual([{ name: 'demo' }])
    expect(installSkill).toHaveBeenCalledTimes(1)
    expect(reloadAllSessions).toHaveBeenCalledTimes(1)
  })

  it('install 用户拒绝时抛错且不执行', async () => {
    const installSkill = vi.fn(async () => [] as never)
    const { service } = createService({ installSkill })

    const promise = service.install(sharedInstall())
    const approvalId = await pendingApprovalId(service)
    service.rejectOperation(approvalId)

    await expect(promise).rejects.toThrow('用户拒绝了 Skill 操作')
    expect(installSkill).not.toHaveBeenCalled()
  })

  it('install 专属 Skill 由非授权 Agent 发起时拒绝', async () => {
    const { service } = createService({ installSkill: vi.fn() })
    await expect(
      service.install({
        agentId: 'other',
        operation: 'install',
        source: 'agent',
        targetAgentId: 'victim',
        skillName: 'x',
      } as SkillOperationParams),
    ).rejects.toThrow('无权管理')
  })

  it('install 共享 Skill 非元宵发起时拒绝', async () => {
    const { service } = createService({ installSkill: vi.fn() })
    await expect(
      service.install(sharedInstall({ agentId: 'other' })),
    ).rejects.toThrow('只有默认 Agent')
  })

  it('delete 专属 Skill：审批通过后 reload 目标 Agent', async () => {
    const reloadAgentSessions = vi.fn(async () => {})
    const deleteSkill = vi.fn(async () => [] as never)
    const { service } = createService({ deleteSkill, reloadAgentSessions })

    const params = {
      agentId: DEFAULT_AGENT,
      operation: 'delete',
      source: 'agent',
      targetAgentId: 'a1',
      skillName: 'x',
    } as SkillOperationParams

    const promise = service.delete(params)
    service.approveOperation(await pendingApprovalId(service))
    await promise

    expect(deleteSkill).toHaveBeenCalledTimes(1)
    expect(reloadAgentSessions).toHaveBeenCalledWith('a1')
  })

  it('rejectAllApprovals 清空待审批', async () => {
    const { service } = createService({ installSkill: vi.fn() })
    void service.install(sharedInstall()).catch(() => {})
    await pendingApprovalId(service)
    service.rejectAllApprovals()
    expect(service.getPendingApprovals()).toHaveLength(0)
  })

  it('预检失败时不产生审批，也不执行安装', async () => {
    const installSkill = vi.fn(async () => [] as never)
    const { service, events } = createService({
      preflightSkillOperation: vi.fn(async () => {
        throw new Error('Skill 目录缺少 SKILL.md')
      }),
      installSkill,
    })

    await expect(service.install(sharedInstall())).rejects.toThrow(
      'Skill 目录缺少 SKILL.md',
    )
    expect(service.getPendingApprovals()).toEqual([])
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: 'skill-approval-required' }),
    )
    expect(installSkill).not.toHaveBeenCalled()
  })

  it('审批载荷使用预检得到的描述、脚本风险和同名覆盖信息', async () => {
    const installSkill = vi.fn(async () => [] as never)
    const { service } = createService({
      preflightSkillOperation: vi.fn(async () => ({
        description: '会执行本地脚本',
        hasScripts: true,
        conflict: {
          overriddenPath: '/shared/demo/SKILL.md',
          overriddenSource: 'shared' as const,
        },
      })),
      installSkill,
    })

    const promise = service.install(
      sharedInstall({
        source: 'agent',
        targetAgentId: DEFAULT_AGENT,
        skillDirPath: '/tmp/demo',
      }),
    )
    const approvalId = await pendingApprovalId(service)
    expect(service.getPendingApprovals()[0]).toMatchObject({
      description: '会执行本地脚本',
      hasScripts: true,
      conflict: {
        overriddenPath: '/shared/demo/SKILL.md',
        overriddenSource: 'shared',
      },
    })

    service.rejectOperation(approvalId)
    await expect(promise).rejects.toThrow('用户拒绝了 Skill 操作')
  })
})
