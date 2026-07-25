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
  it('turn-cancelled 触发时自动清理该 session 的待审批请求', () => {
    const session = createSessionSummary('session-1')
    const runtimeDriver = createRuntimeDriver(createReadySnapshot())
    const sessionDriver = createSessionDriver([session])
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
    })

    const received: AgentEvent[] = []
    runtime.subscribe((event) => {
      agentEventSchema.parse(event)
      received.push(event)
    })

    // 启动 run
    sessionDriver.emit({
      type: 'attempt-started',
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: session.sessionId,
      runId: 'run-1',
      occurredAt: '2026-07-23T00:00:00.000Z',
    })

    const gateway = runtime.createToolApprovalGateway()

    // 注册一个 bash 审批请求
    void gateway.requestBashApproval({
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: session.sessionId,
      runId: '',
      command: 'ls -la',
      cwd: '/tmp',
      riskDescription: '列目录',
    })

    // 确认审批已被登记
    expect(runtime.getPendingApprovals()).toHaveLength(1)

    // 模拟 run 被异常取消（不经过 cancelRun，直接由 Driver 发出 turn-cancelled）
    sessionDriver.emit({
      type: 'turn-cancelled',
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: session.sessionId,
      runId: 'run-1',
      occurredAt: '2026-07-23T00:00:01.000Z',
    })

    // turn-cancelled 后待审批请求应已被清理
    expect(runtime.getPendingApprovals()).toHaveLength(0)
  })

  it('turn-failed 触发时自动清理该 session 的待审批请求', () => {
    const session = createSessionSummary('session-2')
    const runtimeDriver = createRuntimeDriver(createReadySnapshot())
    const sessionDriver = createSessionDriver([session])
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver,
      sessionDriver,
    })

    // 启动 run
    sessionDriver.emit({
      type: 'attempt-started',
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: session.sessionId,
      runId: 'run-1',
      occurredAt: '2026-07-23T00:00:00.000Z',
    })

    const gateway = runtime.createToolApprovalGateway()

    // 注册 bash 审批
    void gateway.requestBashApproval({
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: session.sessionId,
      runId: '',
      command: 'rm -rf /tmp/test',
      cwd: '/tmp',
      riskDescription: '删除目录',
    })

    expect(runtime.getPendingApprovals()).toHaveLength(1)

    // 模拟 run 失败
    sessionDriver.emit({
      type: 'turn-failed',
      agentId: TANGYUAN_DEFAULT_AGENT_ID,
      sessionId: session.sessionId,
      runId: 'run-1',
      error: { code: 'unknown', message: '模型错误', recoverable: true },
      occurredAt: '2026-07-23T00:00:01.000Z',
    })

    expect(runtime.getPendingApprovals()).toHaveLength(0)
  })

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
