import { type AgentEvent } from './index'
import {
  TANGYUAN_DEFAULT_AGENT_ID,
  agentEventSchema,
} from '@tangyuan/contracts'
import { describe, expect, it } from 'vitest'
import { createTangyuanRuntimeForTesting } from './TangyuanRuntime'
import {
  createReadySnapshot,
  createRuntimeDriver,
  createSessionDriver,
  createSessionSummary,
} from './tangyuan-runtime.test-helpers'

describe('bash 审批事件', () => {
  it('approval-required 携带非空 runId，不会被 agentEventSchema 拒绝', () => {
    const session = createSessionSummary('session-1')
    const runtimeDriver = createRuntimeDriver(createReadySnapshot())
    const sessionDriver = createSessionDriver([session])
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
    })

    // 复刻 ipc.ts：每条公开事件都经 agentEventSchema 校验后广播。
    const received: AgentEvent[] = []
    runtime.subscribe((event) => {
      agentEventSchema.parse(event)
      received.push(event)
    })

    // 先让 session 进入 active run（bash 工具执行时一定处于某个 run 内）。
    sessionDriver.emit({
      type: 'attempt-started',
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: session.sessionId,
      runId: 'run-1',
      occurredAt: '2026-07-23T00:00:00.000Z',
    })

    const gateway = runtime.createToolApprovalGateway()

    // 调用方（gateway.ts 的 bash 工具）传入空 runId；
    // 审批网关应用 active run 的真实 runId 补齐，避免 schema 报错。
    expect(() => {
      void gateway.requestBashApproval({
        agentId: TANGYUAN_DEFAULT_AGENT_ID,
        sessionId: session.sessionId,
        runId: '',
        command: 'ls -la',
        cwd: '/tmp',
        riskDescription: '列目录',
      })
    }).not.toThrow()

    const approvalEvent = received.find(
      (event) => event.type === 'approval-required',
    )
    expect(approvalEvent).toBeDefined()
    if (approvalEvent?.type === 'approval-required') {
      expect(approvalEvent.approval.runId).toBe('run-1')
    }
  })
})
