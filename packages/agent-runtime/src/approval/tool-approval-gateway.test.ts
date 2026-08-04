import { describe, expect, it, vi } from 'vitest'
import type { CommandPermissionModule } from './command-permission-module'
import type { ClarificationRegistry } from './clarification-registry'
import { createToolApprovalGateway } from './tool-approval-gateway'

function createGateway(resolveRunId = () => 'run-active') {
  const commandPermissions = {
    request: vi.fn(async () => ({ approved: true })),
  } as unknown as CommandPermissionModule & {
    request: ReturnType<typeof vi.fn>
  }
  const clarifications = {
    register: vi.fn(async () => ({ answer: 'A' })),
  } as unknown as ClarificationRegistry & { register: ReturnType<typeof vi.fn> }

  const gateway = createToolApprovalGateway({
    commandPermissions,
    clarifications,
    resolveRunId,
    now: () => '2024-01-01T00:00:00.000Z',
  })
  return { gateway, commandPermissions, clarifications }
}

describe('createToolApprovalGateway', () => {
  it('requestBashApproval 组装请求并委托登记表', async () => {
    const { gateway, commandPermissions } = createGateway()

    const result = await gateway.requestBashApproval({
      agentId: 'yuanxiao',
      sessionId: 's1',
      command: 'ls',
      cwd: '/tmp',
      riskLevel: 'normal',
      riskDescription: '低',
    } as never)

    expect(result).toEqual({ approved: true })
    expect(commandPermissions.request).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'yuanxiao',
        sessionId: 's1',
        runId: 'run-active',
        command: 'ls',
        riskLevel: 'normal',
        status: 'pending',
        createdAt: '2024-01-01T00:00:00.000Z',
      }),
    )
  })

  it('requestBashApproval 优先使用参数自带的 runId', async () => {
    const { gateway, commandPermissions } = createGateway()
    await gateway.requestBashApproval({
      agentId: 'yuanxiao',
      sessionId: 's1',
      runId: 'run-explicit',
      command: 'ls',
      cwd: '/tmp',
      riskLevel: 'normal',
      riskDescription: '低',
    } as never)
    expect(commandPermissions.request.mock.calls[0]![0].runId).toBe(
      'run-explicit',
    )
  })

  it('validateFilePath 拦截受保护路径', () => {
    const { gateway } = createGateway()
    const result = gateway.validateFilePath({
      agentId: 'yuanxiao',
      path: '/home/agents/yuanxiao/soul.md',
      operation: 'write',
    })
    expect(result.allowed).toBe(false)
  })

  it('requestClarification 组装请求并委托登记表', async () => {
    const { gateway, clarifications } = createGateway()
    const result = await gateway.requestClarification({
      agentId: 'yuanxiao',
      sessionId: 's1',
      question: '选哪个？',
      options: ['A', 'B'],
      allowCustomAnswer: true,
    } as never)

    expect(result).toEqual({ answer: 'A' })
    expect(clarifications.register).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 's1',
        runId: 'run-active',
        question: '选哪个？',
        status: 'pending',
      }),
    )
  })
})
