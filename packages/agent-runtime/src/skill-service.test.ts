import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent, SkillOperationParams } from '@tangyuan/contracts'
import type { AgentSessionDriver } from './index'
import { SkillService } from './skill-service'

const DEFAULT_AGENT = 'tangyuan'

function createService(driver: Partial<AgentSessionDriver>) {
  const events: AgentEvent[] = []
  const service = new SkillService({
    sessionDriver: driver as AgentSessionDriver,
    defaultAgentId: DEFAULT_AGENT,
    emit: (event) => events.push(event),
    now: () => '2024-01-01T00:00:00.000Z',
  })
  return { service, events }
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
    const approvalId = service.getPendingApprovals()[0]!.approvalId
    service.approveOperation(approvalId)

    expect(await promise).toEqual([{ name: 'demo' }])
    expect(installSkill).toHaveBeenCalledTimes(1)
    expect(reloadAllSessions).toHaveBeenCalledTimes(1)
  })

  it('install 用户拒绝时抛错且不执行', async () => {
    const installSkill = vi.fn(async () => [] as never)
    const { service } = createService({ installSkill })

    const promise = service.install(sharedInstall())
    const approvalId = service.getPendingApprovals()[0]!.approvalId
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

  it('install 共享 Skill 非汤圆发起时拒绝', async () => {
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
    service.approveOperation(service.getPendingApprovals()[0]!.approvalId)
    await promise

    expect(deleteSkill).toHaveBeenCalledTimes(1)
    expect(reloadAgentSessions).toHaveBeenCalledWith('a1')
  })

  it('getInstallRecords 缺少能力时抛错', async () => {
    const { service } = createService({})
    await expect(service.getInstallRecords()).rejects.toThrow(
      '不支持读取 Skill 安装记录',
    )
  })

  it('rejectAllApprovals 清空待审批', async () => {
    const { service } = createService({ installSkill: vi.fn() })
    void service.install(sharedInstall()).catch(() => {})
    expect(service.getPendingApprovals()).toHaveLength(1)
    service.rejectAllApprovals()
    expect(service.getPendingApprovals()).toHaveLength(0)
  })
})
