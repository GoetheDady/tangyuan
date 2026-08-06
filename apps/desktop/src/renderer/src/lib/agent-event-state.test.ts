import type {
  AgentEvent,
  AgentSummary,
} from '@yuanxiao/contracts'
import { describe, expect, it } from 'vitest'

import {
  mergeAgentEventIntoAgents,
} from './agent-event-state'

const OCCURRED_AT = '2026-07-28T10:00:00.000Z'
const FIRST_AGENT: AgentSummary = {
  agentId: 'yuanxiao',
  displayName: '元宵',
  status: 'active',
  defaultProviderId: 'anthropic',
  defaultModelId: 'claude-sonnet-4-5',
  homePath: '~/.yuanxiao/agents/yuanxiao',
  archivedAt: null,
  directoryStatus: 'healthy',
}
const SECOND_AGENT: AgentSummary = {
  agentId: 'agent-2',
  displayName: '研究助手',
  status: 'active',
  defaultProviderId: 'openai',
  defaultModelId: 'gpt-5',
  homePath: '~/.yuanxiao/agents/agent-2',
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

const UNRELATED_EVENT: AgentEvent = {
  type: 'profile-updated',
  agentId: 'yuanxiao',
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