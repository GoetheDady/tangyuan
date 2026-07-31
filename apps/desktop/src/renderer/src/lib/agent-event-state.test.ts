import type {
  AgentEvent,
  AgentSummary,
  BashApprovalRequest,
  QuestionClarificationRequest,
} from '@tangyuan/contracts'
import { describe, expect, it } from 'vitest'

import {
  clearPendingApprovalsForSessions,
  clearPendingClarificationsForSessions,
  mergeAgentEventIntoAgents,
  mergeAgentEventIntoPendingApprovals,
  mergeAgentEventIntoPendingClarifications,
} from './agent-event-state'

const OCCURRED_AT = '2026-07-28T10:00:00.000Z'
const FIRST_AGENT: AgentSummary = {
  agentId: 'tangyuan',
  displayName: '汤圆',
  status: 'active',
  defaultProviderId: 'anthropic',
  defaultModelId: 'claude-sonnet-4-5',
  homePath: '~/.tangyuan/agents/tangyuan',
  archivedAt: null,
  directoryStatus: 'healthy',
}
const SECOND_AGENT: AgentSummary = {
  agentId: 'agent-2',
  displayName: '研究助手',
  status: 'active',
  defaultProviderId: 'openai',
  defaultModelId: 'gpt-5',
  homePath: '~/.tangyuan/agents/agent-2',
  archivedAt: null,
  directoryStatus: 'healthy',
}

function createAgentEvent(
  type:
    | 'agent-created'
    | 'agent-config-updated'
    | 'agent-archived'
    | 'agent-recovered',
  agent: AgentSummary,
): AgentEvent {
  return { type, agentId: agent.agentId, agent, occurredAt: OCCURRED_AT }
}

const FIRST_APPROVAL: BashApprovalRequest = {
  approvalId: 'approval-1',
  agentId: 'tangyuan',
  sessionId: 'session-1',
  runId: 'run-1',
  command: 'pnpm test',
  cwd: '/workspace',
  riskDescription: '运行测试',
  status: 'pending',
  createdAt: OCCURRED_AT,
}
const SECOND_APPROVAL: BashApprovalRequest = {
  ...FIRST_APPROVAL,
  approvalId: 'approval-2',
  sessionId: 'session-2',
  command: 'pnpm typecheck',
}

const FIRST_CLARIFICATION: QuestionClarificationRequest = {
  clarificationId: 'clarification-1',
  agentId: 'tangyuan',
  sessionId: 'session-1',
  runId: 'run-1',
  question: '选择哪一个？',
  options: ['A', 'B'],
  allowCustomAnswer: true,
  status: 'pending',
  createdAt: OCCURRED_AT,
}
const SECOND_CLARIFICATION: QuestionClarificationRequest = {
  ...FIRST_CLARIFICATION,
  clarificationId: 'clarification-2',
  sessionId: 'session-2',
  question: '是否继续？',
}

const UNRELATED_EVENT: AgentEvent = {
  type: 'profile-updated',
  agentId: 'tangyuan',
  target: 'soul',
  updatedAt: OCCURRED_AT,
  occurredAt: OCCURRED_AT,
}

describe('mergeAgentEventIntoAgents', () => {
  it('创建事件会追加新 Agent', () => {
    expect(
      mergeAgentEventIntoAgents(
        [FIRST_AGENT],
        createAgentEvent('agent-created', SECOND_AGENT),
      ),
    ).toEqual([FIRST_AGENT, SECOND_AGENT])
  })

  it('重复创建事件会按 agentId 替换原摘要且不重复', () => {
    const updated = { ...SECOND_AGENT, displayName: '新研究助手' }

    expect(
      mergeAgentEventIntoAgents(
        [FIRST_AGENT, SECOND_AGENT],
        createAgentEvent('agent-created', updated),
      ),
    ).toEqual([FIRST_AGENT, updated])
  })

  it.each([
    'agent-config-updated',
    'agent-archived',
    'agent-recovered',
  ] as const)('%s 只替换已存在的目标 Agent', (type) => {
    const updated = {
      ...SECOND_AGENT,
      displayName: `${SECOND_AGENT.displayName}-${type}`,
    }

    expect(
      mergeAgentEventIntoAgents(
        [FIRST_AGENT, SECOND_AGENT],
        createAgentEvent(type, updated),
      ),
    ).toEqual([FIRST_AGENT, updated])
    expect(
      mergeAgentEventIntoAgents([FIRST_AGENT], createAgentEvent(type, updated)),
    ).toEqual([FIRST_AGENT])
  })

  it('不相关事件保持原集合引用不变', () => {
    const agents = [FIRST_AGENT, SECOND_AGENT]

    expect(mergeAgentEventIntoAgents(agents, UNRELATED_EVENT)).toBe(agents)
  })
})

describe('mergeAgentEventIntoPendingApprovals', () => {
  it('按到达顺序加入审批请求，重复 approvalId 也保持现有追加语义', () => {
    const updated = { ...FIRST_APPROVAL, command: 'pnpm -r test' }

    expect(
      mergeAgentEventIntoPendingApprovals([FIRST_APPROVAL, SECOND_APPROVAL], {
        type: 'approval-required',
        agentId: updated.agentId,
        sessionId: updated.sessionId,
        approval: updated,
        occurredAt: OCCURRED_AT,
      }),
    ).toEqual([FIRST_APPROVAL, SECOND_APPROVAL, updated])
  })

  it('解决审批后删除对应请求', () => {
    expect(
      mergeAgentEventIntoPendingApprovals([FIRST_APPROVAL, SECOND_APPROVAL], {
        type: 'approval-resolved',
        agentId: FIRST_APPROVAL.agentId,
        sessionId: FIRST_APPROVAL.sessionId,
        approvalId: FIRST_APPROVAL.approvalId,
        status: 'approved',
        occurredAt: OCCURRED_AT,
      }),
    ).toEqual([SECOND_APPROVAL])
  })

  it('未知审批和不相关事件保持集合内容不变', () => {
    const approvals = [FIRST_APPROVAL, SECOND_APPROVAL]

    expect(
      mergeAgentEventIntoPendingApprovals(approvals, {
        type: 'approval-resolved',
        agentId: FIRST_APPROVAL.agentId,
        sessionId: FIRST_APPROVAL.sessionId,
        approvalId: 'unknown-approval',
        status: 'rejected',
        occurredAt: OCCURRED_AT,
      }),
    ).toEqual(approvals)
    expect(
      mergeAgentEventIntoPendingApprovals(approvals, UNRELATED_EVENT),
    ).toBe(approvals)
  })

  it('按 session 集合清理请求，不影响其他 session', () => {
    expect(
      clearPendingApprovalsForSessions(
        [FIRST_APPROVAL, SECOND_APPROVAL],
        ['session-1', 'unknown-session'],
      ),
    ).toEqual([SECOND_APPROVAL])
  })
})

describe('mergeAgentEventIntoPendingClarifications', () => {
  it('按到达顺序加入澄清请求，重复 clarificationId 也保持现有追加语义', () => {
    const updated = { ...FIRST_CLARIFICATION, question: '更新后的问题？' }

    expect(
      mergeAgentEventIntoPendingClarifications(
        [FIRST_CLARIFICATION, SECOND_CLARIFICATION],
        {
          type: 'clarification-required',
          agentId: updated.agentId,
          sessionId: updated.sessionId,
          clarification: updated,
          occurredAt: OCCURRED_AT,
        },
      ),
    ).toEqual([FIRST_CLARIFICATION, SECOND_CLARIFICATION, updated])
  })

  it('解决澄清后删除对应请求', () => {
    expect(
      mergeAgentEventIntoPendingClarifications(
        [FIRST_CLARIFICATION, SECOND_CLARIFICATION],
        {
          type: 'clarification-resolved',
          agentId: FIRST_CLARIFICATION.agentId,
          sessionId: FIRST_CLARIFICATION.sessionId,
          clarificationId: FIRST_CLARIFICATION.clarificationId,
          answer: 'A',
          status: 'answered',
          occurredAt: OCCURRED_AT,
        },
      ),
    ).toEqual([SECOND_CLARIFICATION])
  })

  it('未知澄清和不相关事件保持集合内容不变', () => {
    const clarifications = [FIRST_CLARIFICATION, SECOND_CLARIFICATION]

    expect(
      mergeAgentEventIntoPendingClarifications(clarifications, {
        type: 'clarification-resolved',
        agentId: FIRST_CLARIFICATION.agentId,
        sessionId: FIRST_CLARIFICATION.sessionId,
        clarificationId: 'unknown-clarification',
        answer: '',
        status: 'cancelled',
        occurredAt: OCCURRED_AT,
      }),
    ).toEqual(clarifications)
    expect(
      mergeAgentEventIntoPendingClarifications(clarifications, UNRELATED_EVENT),
    ).toBe(clarifications)
  })

  it('按 session 集合清理请求，不影响其他 session', () => {
    expect(
      clearPendingClarificationsForSessions(
        [FIRST_CLARIFICATION, SECOND_CLARIFICATION],
        ['session-1', 'unknown-session'],
      ),
    ).toEqual([SECOND_CLARIFICATION])
  })
})
