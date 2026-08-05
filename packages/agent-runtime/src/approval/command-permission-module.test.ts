import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentEvent, BashApprovalRequest } from '@yuanxiao/contracts'
import { CommandPermissionModule } from './command-permission-module'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  )
})

function makeRequest(
  overrides: Partial<BashApprovalRequest> = {},
): BashApprovalRequest {
  return {
    approvalId: 'approval-1',
    agentId: 'yuanxiao',
    sessionId: 'session-1',
    runId: 'run-1',
    command: 'bun test',
    cwd: '/workspace/project',
    riskLevel: 'normal',
    riskDescription: '命令将以当前 macOS 用户权限执行。',
    status: 'pending',
    createdAt: '2026-08-04T00:00:00.000Z',
    ...overrides,
  }
}

async function createModule(filePath?: string) {
  const events: AgentEvent[] = []
  const module = new CommandPermissionModule({
    ...(filePath ? { filePath } : {}),
    emit: (event) => events.push(event),
    now: () => '2026-08-04T00:00:00.000Z',
  })
  return { module, events }
}

async function waitForEventCount(
  events: AgentEvent[],
  expectedCount: number,
): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (events.length === expectedCount) return
    await new Promise<void>((resolve) => setTimeout(resolve, 1))
  }
  expect(events).toHaveLength(expectedCount)
}

describe('CommandPermissionModule', () => {
  it('按 Agent、cwd 与命令持久化许可并跨会话免审', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yuanxiao-command-permission-'))
    tempRoots.push(root)
    const filePath = join(root, 'command-permissions.json')
    const first = await createModule(filePath)
    const pending = first.module.request(makeRequest())

    await waitForEventCount(first.events, 1)
    await first.module.approve({ approvalId: 'approval-1', remember: true })
    await expect(pending).resolves.toEqual({ approved: true })

    const restarted = await createModule(filePath)
    await expect(
      restarted.module.request(
        makeRequest({ approvalId: 'approval-2', sessionId: 'session-2' }),
      ),
    ).resolves.toEqual({ approved: true })
    expect(restarted.events).toHaveLength(0)

    const otherCwd = restarted.module.request(
      makeRequest({ approvalId: 'approval-3', cwd: '/workspace/other' }),
    )
    await waitForEventCount(restarted.events, 1)
    restarted.module.reject('approval-3')
    await expect(otherCwd).resolves.toEqual({ approved: false })
  })

  it('高风险命令即使选择长期允许也只批准本次', async () => {
    const { module, events } = await createModule()
    const first = module.request(
      makeRequest({
        command: 'rm -rf ./build',
        riskLevel: 'high',
        riskDescription: '高风险命令：递归强制删除。',
      }),
    )

    await waitForEventCount(events, 1)
    await module.approve({ approvalId: 'approval-1', remember: true })
    await expect(first).resolves.toEqual({ approved: true })

    const second = module.request(
      makeRequest({
        approvalId: 'approval-2',
        sessionId: 'session-2',
        command: 'rm -rf ./build',
        riskLevel: 'high',
        riskDescription: '高风险命令：递归强制删除。',
      }),
    )
    await waitForEventCount(events, 3)
    module.reject('approval-2')
    await expect(second).resolves.toEqual({ approved: false })
  })
})
