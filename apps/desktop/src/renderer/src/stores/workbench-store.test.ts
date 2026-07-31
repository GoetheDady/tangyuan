import type {
  AgentEvent,
  AgentSessionSummary,
  AgentSummary,
  BashApprovalRequest,
  QuestionClarificationRequest,
  RuntimeSnapshot,
  TranscriptSnapshot,
} from '@tangyuan/contracts'
import { createRuntimeSnapshot } from '@tangyuan/contracts'
import { describe, expect, it } from 'vitest'

import { createWorkbenchStore } from './workbench-store'

const NOW = '2026-07-29T10:00:00.000Z'

const TANGYUAN: AgentSummary = {
  agentId: 'tangyuan',
  displayName: '汤圆',
  status: 'active',
  defaultProviderId: 'openai',
  defaultModelId: 'gpt-5',
  homePath: '~/.tangyuan/agents/tangyuan',
  archivedAt: null,
  directoryStatus: 'healthy',
}

const RESEARCHER: AgentSummary = {
  ...TANGYUAN,
  agentId: 'researcher',
  displayName: '研究助手',
  homePath: '~/.tangyuan/agents/researcher',
}

function createRuntime(): RuntimeSnapshot {
  return createRuntimeSnapshot({
    activeAgent: {
      agentId: TANGYUAN.agentId,
      displayName: TANGYUAN.displayName,
      homePath: TANGYUAN.homePath,
      profile: {
        initialized: true,
        bootstrapRequired: false,
        soulUpdatedAt: NOW,
        userUpdatedAt: NOW,
      },
    },
    agents: [TANGYUAN, RESEARCHER],
    providers: [{ providerId: 'openai', displayName: 'OpenAI' }],
    models: [{ providerId: 'openai', modelId: 'gpt-5', displayName: 'GPT-5' }],
    settings: { selectedProviderId: 'openai', selectedModelId: 'gpt-5' },
    configuredProviders: {
      openai: { configured: true, maskedValue: 'sk-...1234' },
    },
    auth: { apiKey: { configured: true, maskedValue: 'sk-...1234' } },
  })
}

function createSession(
  agentId: string,
  sessionId: string,
): AgentSessionSummary {
  return {
    agentId,
    sessionId,
    title: sessionId,
    state: 'idle',
    updatedAt: NOW,
  }
}

function createTranscript(
  agentId: string,
  sessionId: string,
): TranscriptSnapshot {
  return { agentId, sessionId, entries: [], updatedAt: NOW }
}

function createApproval(
  agentId: string,
  sessionId: string,
): BashApprovalRequest {
  return {
    approvalId: `approval-${sessionId}`,
    agentId,
    sessionId,
    runId: `run-${sessionId}`,
    command: 'pnpm test',
    cwd: '/workspace',
    riskDescription: '运行测试',
    status: 'pending',
    createdAt: NOW,
  }
}

function createClarification(
  agentId: string,
  sessionId: string,
): QuestionClarificationRequest {
  return {
    clarificationId: `clarification-${sessionId}`,
    agentId,
    sessionId,
    runId: `run-${sessionId}`,
    question: '是否继续？',
    options: ['继续', '停止'],
    allowCustomAnswer: false,
    status: 'pending',
    createdAt: NOW,
  }
}

describe('createWorkbenchStore', () => {
  it('创建不共享残留状态的默认 vanilla store', () => {
    const first = createWorkbenchStore()
    const second = createWorkbenchStore()

    expect(first.getState()).toMatchObject({
      runtime: null,
      agents: [],
      sessionsByAgentId: {},
      transcriptsBySessionId: {},
      sendingBySessionId: {},
      pendingApprovalsBySessionId: {},
      pendingClarificationsBySessionId: {},
      composerDraft: '',
      isInitializing: true,
      alwaysAllowedCommandsBySessionId: {},
    })

    first.getState().updateComposerDraft('只属于第一个实例')
    first.getState().finishInitialization()

    expect(second.getState().composerDraft).toBe('')
    expect(second.getState().isInitializing).toBe(true)
    expect(first).not.toHaveProperty('setState')
  })

  it('装载 Main Runtime 快照并同步 Agent 摘要', () => {
    const store = createWorkbenchStore()
    const runtime = createRuntime()

    store.getState().loadRuntimeSnapshot(runtime)

    expect(store.getState().runtime).toBe(runtime)
    expect(store.getState().agents).toEqual([TANGYUAN, RESEARCHER])
  })

  it('替换指定 Agent 的 session 列表且不污染其他 Agent', () => {
    const store = createWorkbenchStore()
    const firstSession = createSession('tangyuan', 'session-1')
    const secondSession = createSession('researcher', 'session-2')

    store.getState().replaceAgentSessions('tangyuan', [firstSession])
    store.getState().replaceAgentSessions('researcher', [secondSession])
    store
      .getState()
      .replaceAgentSessions('tangyuan', [
        { ...firstSession, title: '更新后的会话' },
      ])

    expect(store.getState().sessionsByAgentId).toEqual({
      tangyuan: [{ ...firstSession, title: '更新后的会话' }],
      researcher: [secondSession],
    })
  })

  it('按事件所属 Agent 归并 session 和 Agent 摘要', () => {
    const store = createWorkbenchStore()
    const firstSession = createSession('tangyuan', 'session-1')
    const secondSession = createSession('researcher', 'session-2')
    store.getState().loadRuntimeSnapshot(createRuntime())
    store.getState().replaceAgentSessions('tangyuan', [firstSession])
    store.getState().replaceAgentSessions('researcher', [secondSession])

    const runEvent: AgentEvent = {
      type: 'attempt-started',
      agentId: 'researcher',
      sessionId: 'session-2',
      runId: 'run-2',
      occurredAt: '2026-07-29T10:01:00.000Z',
    }
    const renamedResearcher = { ...RESEARCHER, displayName: '资料研究员' }
    store.getState().applyAgentEvent(runEvent)
    store.getState().applyAgentEvent({
      type: 'agent-config-updated',
      agentId: 'researcher',
      agent: renamedResearcher,
      occurredAt: NOW,
    })

    expect(store.getState().sessionsByAgentId.tangyuan).toEqual([firstSession])
    expect(store.getState().sessionsByAgentId.researcher).toEqual([
      {
        ...secondSession,
        state: 'running',
        updatedAt: '2026-07-29T10:01:00.000Z',
      },
    ])
    expect(store.getState().agents).toEqual([TANGYUAN, renamedResearcher])
  })

  it('通过事件按 session 加入和解决临时请求', () => {
    const store = createWorkbenchStore()
    const firstApproval = createApproval('tangyuan', 'session-1')
    const secondApproval = createApproval('researcher', 'session-2')
    const firstClarification = createClarification('tangyuan', 'session-1')

    store.getState().applyAgentEvent({
      type: 'approval-required',
      agentId: firstApproval.agentId,
      sessionId: firstApproval.sessionId,
      approval: firstApproval,
      occurredAt: NOW,
    })
    store.getState().applyAgentEvent({
      type: 'approval-required',
      agentId: secondApproval.agentId,
      sessionId: secondApproval.sessionId,
      approval: secondApproval,
      occurredAt: NOW,
    })
    store.getState().applyAgentEvent({
      type: 'clarification-required',
      agentId: firstClarification.agentId,
      sessionId: firstClarification.sessionId,
      clarification: firstClarification,
      occurredAt: NOW,
    })
    store.getState().applyAgentEvent({
      type: 'approval-resolved',
      agentId: firstApproval.agentId,
      sessionId: firstApproval.sessionId,
      approvalId: firstApproval.approvalId,
      status: 'approved',
      occurredAt: NOW,
    })

    expect(store.getState().pendingApprovalsBySessionId).toEqual({
      'session-1': [],
      'session-2': [secondApproval],
    })
    expect(store.getState().pendingClarificationsBySessionId).toEqual({
      'session-1': [firstClarification],
    })
  })

  it('按 session 打开、更新和清理 transcript', () => {
    const store = createWorkbenchStore()
    store.getState().openTranscript(createTranscript('tangyuan', 'session-1'))
    store.getState().openTranscript(createTranscript('researcher', 'session-2'))

    store.getState().applyAgentEvent({
      type: 'transcript-delta',
      agentId: 'researcher',
      sessionId: 'session-2',
      delta: {
        type: 'entry-appended',
        entry: {
          kind: 'user-message',
          index: 0,
          messageId: 'message-1',
          content: '只更新第二个会话',
          createdAt: NOW,
        },
      },
      occurredAt: NOW,
    })
    store.getState().clearTranscript('session-1')

    expect(store.getState().transcriptsBySessionId['session-1']).toBeUndefined()
    expect(
      store.getState().transcriptsBySessionId['session-2']?.entries,
    ).toHaveLength(1)
  })

  it('发送状态、审批和澄清请求按 session 隔离并可语义清理', () => {
    const store = createWorkbenchStore()
    const firstApproval = createApproval('tangyuan', 'session-1')
    const secondApproval = createApproval('researcher', 'session-2')
    const firstClarification = createClarification('tangyuan', 'session-1')
    const secondClarification = createClarification('researcher', 'session-2')

    store.getState().beginSending('session-1')
    store.getState().beginSending('session-2')
    store.getState().addPendingApproval(firstApproval)
    store.getState().addPendingApproval(secondApproval)
    store.getState().addPendingClarification(firstClarification)
    store.getState().addPendingClarification(secondClarification)
    store.getState().finishSending('session-1')
    store
      .getState()
      .resolvePendingApproval('session-1', firstApproval.approvalId)
    store.getState().clearSessionRequests('session-2')

    expect(store.getState().sendingBySessionId).toEqual({
      'session-1': false,
      'session-2': true,
    })
    expect(store.getState().pendingApprovalsBySessionId).toEqual({
      'session-1': [],
      'session-2': [],
    })
    expect(store.getState().pendingClarificationsBySessionId).toEqual({
      'session-1': [firstClarification],
      'session-2': [],
    })
  })

  it('composer 草稿和进程内始终允许命令只通过语义 action 修改', () => {
    const store = createWorkbenchStore()

    store.getState().updateComposerDraft('准备发送')
    store.getState().allowCommandForProcess('session-1', 'pnpm test')
    store.getState().allowCommandForProcess('session-1', 'pnpm test')
    store.getState().allowCommandForProcess('session-2', 'pnpm typecheck')
    store.getState().clearComposerDraft()

    expect(store.getState().composerDraft).toBe('')
    expect(store.getState().alwaysAllowedCommandsBySessionId).toEqual({
      'session-1': ['pnpm test'],
      'session-2': ['pnpm typecheck'],
    })
  })
})
