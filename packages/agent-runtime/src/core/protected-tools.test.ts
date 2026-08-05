import { describe, expect, it } from 'vitest'
import type { ToolApprovalGateway } from '../driver'
import { createRunCommandTool } from './protected-tools'

function createGateway() {
  const requests: Array<{
    command: string
    riskLevel: string
    riskDescription: string
  }> = []
  const gateway: ToolApprovalGateway = {
    requestBashApproval: async (params) => {
      requests.push({
        command: params.command,
        riskLevel: params.riskLevel,
        riskDescription: params.riskDescription,
      })
      return { approved: false }
    },
    validateFilePath: () => ({ allowed: true }),
    requestClarification: async () => ({ answer: '' }),
  }
  return { gateway, requests }
}

describe('createRunCommandTool', () => {
  it('硬性拦截命令直接拒绝且不创建审批请求', async () => {
    const { gateway, requests } = createGateway()
    const tool = createRunCommandTool({
      gateway,
      agentId: 'yuanxiao',
      sessionId: 'session-1',
      cwd: '/workspace/project',
    })

    const result = await tool.execute('call-1', {
      command: 'rm -rf /',
    } as never)

    expect(requests).toHaveLength(0)
    expect(result.content[0]?.text).toContain('命令被安全策略拦截')
    expect(result.content[0]?.text).toContain('删除根目录')
  })

  it('非拦截命令正常创建审批请求', async () => {
    const { gateway, requests } = createGateway()
    const tool = createRunCommandTool({
      gateway,
      agentId: 'yuanxiao',
      sessionId: 'session-1',
      cwd: '/workspace/project',
    })

    const result = await tool.execute('call-2', {
      command: 'git push',
    } as never)

    expect(requests).toHaveLength(1)
    expect(requests[0]?.command).toBe('git push')
    expect(requests[0]?.riskLevel).toBe('medium')
    expect(result.content[0]?.text).toBe('用户拒绝了此命令的执行。')
  })
})
