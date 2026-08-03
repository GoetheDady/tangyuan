import type {
  AgentEvent,
  AgentSummary,
  BashApprovalRequest,
  QuestionClarificationRequest,
} from '@yuanxiao/contracts'

/** 将 Agent 生命周期事件归并到 Agent 摘要集合。 */
export function mergeAgentEventIntoAgents(
  agents: AgentSummary[],
  event: AgentEvent,
): AgentSummary[] {
  if (event.type === 'agent-created') {
    const exists = agents.some((agent) => agent.agentId === event.agent.agentId)
    return exists
      ? agents.map((agent) =>
          agent.agentId === event.agent.agentId ? event.agent : agent,
        )
      : [...agents, event.agent]
  }

  if (
    event.type !== 'agent-config-updated' &&
    event.type !== 'agent-archived' &&
    event.type !== 'agent-recovered'
  ) {
    return agents
  }

  return agents.map((agent) =>
    agent.agentId === event.agent.agentId ? event.agent : agent,
  )
}

/** 将审批事件归并到待审批请求集合。 */
export function mergeAgentEventIntoPendingApprovals(
  approvals: BashApprovalRequest[],
  event: AgentEvent,
): BashApprovalRequest[] {
  if (event.type === 'approval-required') {
    return [...approvals, event.approval]
  }

  if (event.type === 'approval-resolved') {
    return approvals.filter(
      (approval) => approval.approvalId !== event.approvalId,
    )
  }

  return approvals
}

/**
 * 从审批列表中提取有 pending 状态的会话 ID 列表。
 *
 * @param approvalsBySessionId - 按 session 分组的审批请求。
 * @returns 有 pending 审批的会话 ID 数组。
 */
export function computePendingApprovalSessionIds(
  approvalsBySessionId: Record<string, BashApprovalRequest[]>,
): string[] {
  return Object.entries(approvalsBySessionId)
    .filter(([, approvals]) => approvals.some((a) => a.status === 'pending'))
    .map(([sessionId]) => sessionId)
}

/** 将澄清事件归并到待澄清请求集合。 */
export function mergeAgentEventIntoPendingClarifications(
  clarifications: QuestionClarificationRequest[],
  event: AgentEvent,
): QuestionClarificationRequest[] {
  if (event.type === 'clarification-required') {
    return [...clarifications, event.clarification]
  }

  if (event.type === 'clarification-resolved') {
    return clarifications.filter(
      (clarification) =>
        clarification.clarificationId !== event.clarificationId,
    )
  }

  return clarifications
}

/** 清除指定会话集合中的待审批请求。 */
export function clearPendingApprovalsForSessions(
  approvals: BashApprovalRequest[],
  sessionIds: Iterable<string>,
): BashApprovalRequest[] {
  const affectedSessionIds = new Set(sessionIds)
  return approvals.filter(
    (approval) => !affectedSessionIds.has(approval.sessionId),
  )
}

/** 清除指定会话集合中的待澄清请求。 */
export function clearPendingClarificationsForSessions(
  clarifications: QuestionClarificationRequest[],
  sessionIds: Iterable<string>,
): QuestionClarificationRequest[] {
  const affectedSessionIds = new Set(sessionIds)
  return clarifications.filter(
    (clarification) => !affectedSessionIds.has(clarification.sessionId),
  )
}
