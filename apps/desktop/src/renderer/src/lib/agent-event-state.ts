import type {
  AgentEvent,
  AgentSummary,
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
