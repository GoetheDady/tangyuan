import type {
  AgentEvent,
  AgentSessionSummary,
  AgentSummary,
  BashApprovalRequest,
  QuestionClarificationRequest,
  RuntimeSnapshot,
  TranscriptSnapshot,
} from '@yuanxiao/contracts'
import { createRuntimeSnapshot } from '@yuanxiao/contracts'
import { describe, expect, it } from 'vitest'

import { computePendingApprovalSessionIds } from '../lib/agent-event-state'
import {
  createWorkbenchStore,
} from './workbench-store'

const NOW = '2026-07-29T10:00:00.000Z'

const YUANXIAO: AgentSummary = {
  agentId: 'yuanxiao',
  displayName: '元宵',
  status: 'active',
  defaultProviderId: 'openai',
  defaultModelId: 'gpt-5',
  homePath: '~/.yuanxiao/agents/yuanxiao',
  archivedAt: null,
  directoryStatus: 'healthy',
}

const RESEARCHER: AgentSummary = {
  ...YUANXIAO,
  agentId: 'researcher',
  displayName: '研究助手',
  homePath: '~/.yuanxiao/agents/researcher',
}

function createRuntime(): RuntimeSnapshot {
  return createRuntimeSnapshot({
    activeAgent: {
      agentId: YUANXIAO.agentId,
      displayName: YUANXIAO.displayName,
      homePath: YUANXIAO.homePath,
      profile: {
        initialized: true,
        bootstrapRequired: false,
        soulUpdatedAt: NOW,
        userUpdatedAt: NOW,
      },
    },
    agents: [YUANXIAO, RESEARCHER],
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
    command: 'bun run test',
    cwd: '/workspace',
    riskDescription: '运行测试',
    riskLevel: 'normal',
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
      activeSession: null,
    })

    first.getState().updateComposerDraft('只属于第一个实例')
    first.getState().completeInitialization()

    expect(second.getState().composerDraft).toBe('')
    expect(second.getState().isInitializing).toBe(true)
    expect(first.getState()).not.toHaveProperty('activeAgentId')
    expect(first.getState()).not.toHaveProperty('activeSessionId')
    expect(first).not.toHaveProperty('setState')
  })

  it('通过一次领域 transition 装载启动工作台数据', () => {
    const store = createWorkbenchStore()
    const runtime = createRuntime()
    const session = createSession('researcher', 'session-1')
    const archived = {
      ...createSession('researcher', 'session-archived'),
      archivedAt: NOW,
    }
    const transcript = createTranscript('researcher', 'session-1')

    store.getState().restoreWorkbench({
      runtime,
      activeSession: session,
      sessions: [archived, session],
      transcript,
    })

    expect(store.getState()).toMatchObject({
      runtime,
      agents: [YUANXIAO, RESEARCHER],
      activeSession: session,
      sessionsByAgentId: { researcher: [session] },
      archivedSessionsByAgentId: { researcher: [archived] },
      transcriptsBySessionId: { 'session-1': transcript },
      isInitializing: false,
    })
  })

  it('装载 Runtime 刷新快照并同步 Agent 摘要', () => {
    const store = createWorkbenchStore()
    const runtime = createRuntime()

    store.getState().refreshRuntime(runtime)

    expect(store.getState().runtime).toBe(runtime)
    expect(store.getState().agents).toEqual([YUANXIAO, RESEARCHER])
  })

  it('替换指定 Agent 的 session 列表且不污染其他 Agent', () => {
    const store = createWorkbenchStore()
    const firstSession = createSession('yuanxiao', 'session-1')
    const secondSession = createSession('researcher', 'session-2')

    store.getState().replaceSessionCatalog('yuanxiao', [firstSession])
    store.getState().replaceSessionCatalog('researcher', [secondSession])
    store
      .getState()
      .replaceSessionCatalog('yuanxiao', [
        { ...firstSession, title: '更新后的会话' },
      ])

    expect(store.getState().sessionsByAgentId).toEqual({
      yuanxiao: [{ ...firstSession, title: '更新后的会话' }],
      researcher: [secondSession],
    })
  })

  it('在一个 action 中按顺序批量归并多个 session 的 transcript delta', () => {
    const store = createWorkbenchStore()
    let notifications = 0
    store.subscribe(() => {
      notifications += 1
    })

    store.getState().applyTranscriptEvents([
      {
        type: 'transcript-delta',
        agentId: 'yuanxiao',
        sessionId: 'session-1',
        delta: {
          type: 'entry-appended',
          entry: {
            kind: 'agent-reply',
            index: 0,
            messageId: 'reply-1',
            content: '你',
            createdAt: NOW,
            attempt: null,
            turns: [],
          },
        },
        occurredAt: NOW,
      },
      {
        type: 'transcript-delta',
        agentId: 'researcher',
        sessionId: 'session-2',
        delta: {
          type: 'entry-appended',
          entry: {
            kind: 'user-message',
            index: 0,
            messageId: 'message-2',
            content: '独立会话',
            createdAt: NOW,
          },
        },
        occurredAt: NOW,
      },
      {
        type: 'transcript-delta',
        agentId: 'yuanxiao',
        sessionId: 'session-1',
        delta: { type: 'delta-appended', index: 0, delta: '好' },
        occurredAt: NOW,
      },
    ])

    expect(notifications).toBe(1)
    expect(store.getState().transcriptsBySessionId).toMatchObject({
      'session-1': { agentId: 'yuanxiao', entries: [{ content: '你好' }] },
      'session-2': {
        agentId: 'researcher',
        entries: [{ content: '独立会话' }],
      },
    })
  })

  it('按事件所属 Agent 归并 session 和 Agent 摘要', () => {
    const store = createWorkbenchStore()
    const firstSession = createSession('yuanxiao', 'session-1')
    const secondSession = createSession('researcher', 'session-2')
    store.getState().refreshRuntime(createRuntime())
    store.getState().replaceSessionCatalog('yuanxiao', [firstSession])
    store.getState().replaceSessionCatalog('researcher', [secondSession])

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

    expect(store.getState().sessionsByAgentId.yuanxiao).toEqual([firstSession])
    expect(store.getState().sessionsByAgentId.researcher).toEqual([
      {
        ...secondSession,
        state: 'running',
        updatedAt: '2026-07-29T10:01:00.000Z',
      },
    ])
    expect(store.getState().agents).toEqual([YUANXIAO, renamedResearcher])
  })

  it('通过事件按 session 加入和解决临时请求', () => {
    const store = createWorkbenchStore()
    const firstApproval = createApproval('yuanxiao', 'session-1')
    const secondApproval = createApproval('researcher', 'session-2')
    const firstClarification = createClarification('yuanxiao', 'session-1')

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
    expect(
      computePendingApprovalSessionIds(
        store.getState().pendingApprovalsBySessionId,
      ),
    ).toEqual(['session-2'])
  })

  it('按 session 打开、更新和清理 transcript', () => {
    const store = createWorkbenchStore()
    store.getState().openSession(createTranscript('yuanxiao', 'session-1'))
    store.getState().openSession(createTranscript('researcher', 'session-2'))

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
    expect(store.getState().transcriptsBySessionId['session-1']).toBeDefined()
    expect(
      store.getState().transcriptsBySessionId['session-2']?.entries,
    ).toHaveLength(1)
  })

  it('发送状态、审批和澄清请求按 session 隔离并可语义清理', () => {
    const store = createWorkbenchStore()
    const firstApproval = createApproval('yuanxiao', 'session-1')
    const secondApproval = createApproval('researcher', 'session-2')
    const firstClarification = createClarification('yuanxiao', 'session-1')
    const secondClarification = createClarification('researcher', 'session-2')

    store.getState().startSessionExecution({ sessionId: 'session-1' })
    store.getState().startSessionExecution({ sessionId: 'session-2' })
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
      type: 'clarification-required',
      agentId: secondClarification.agentId,
      sessionId: secondClarification.sessionId,
      clarification: secondClarification,
      occurredAt: NOW,
    })
    store.getState().endSessionExecution('session-1')
    store.getState().applyAgentEvent({
      type: 'approval-resolved',
      agentId: firstApproval.agentId,
      sessionId: firstApproval.sessionId,
      approvalId: firstApproval.approvalId,
      status: 'approved',
      occurredAt: NOW,
    })

    expect(store.getState().sendingBySessionId).toEqual({
      'session-1': false,
      'session-2': true,
    })
    expect(store.getState().pendingApprovalsBySessionId).toEqual({
      'session-1': [],
      'session-2': [secondApproval],
    })
    expect(store.getState().pendingClarificationsBySessionId).toEqual({
      'session-1': [firstClarification],
      'session-2': [secondClarification],
    })
    expect(
      computePendingApprovalSessionIds(
        store.getState().pendingApprovalsBySessionId,
      ),
    ).toEqual(['session-2'])
  })

  it('执行完成通过一次 transition 更新 transcript、会话目录与发送状态', () => {
    const store = createWorkbenchStore()
    const running = {
      ...createSession('yuanxiao', 'session-1'),
      state: 'running' as const,
    }
    const completed = { ...running, state: 'completed' as const }
    const transcript = createTranscript('yuanxiao', 'session-1')
    store.getState().replaceSessionCatalog('yuanxiao', [running])
    store.getState().startSessionExecution({ sessionId: 'session-1' })

    store.getState().completeSessionExecution({
      agentId: 'yuanxiao',
      sessionId: 'session-1',
      allSessions: [completed],
      transcript,
    })

    expect(store.getState().sendingBySessionId['session-1']).toBe(false)
    expect(store.getState().transcriptsBySessionId['session-1']).toBe(transcript)
    expect(store.getState().sessionsByAgentId.yuanxiao).toEqual([completed])
  })

  it('分叉完成通过一次 transition 写入目录、继承 transcript 与草稿', () => {
    const store = createWorkbenchStore()
    const parent = createSession('yuanxiao', 'parent')
    const child = createSession('yuanxiao', 'child')
    const transcript = createTranscript('yuanxiao', 'child')

    store.getState().completeSessionFork({
      agentId: 'yuanxiao',
      allSessions: [child, parent],
      transcript,
      composerDraft: '原始用户消息',
    })

    expect(store.getState().sessionsByAgentId.yuanxiao).toEqual([child, parent])
    expect(store.getState().transcriptsBySessionId.child).toBe(transcript)
    expect(store.getState().composerDraft).toBe('原始用户消息')
  })

  it('谱系删除通过一次 transition 清理目录和全部会话投影', () => {
    const store = createWorkbenchStore()
    const parent = createSession('yuanxiao', 'parent')
    const child = createSession('yuanxiao', 'child')
    const survivor = createSession('yuanxiao', 'survivor')
    const approval = createApproval('yuanxiao', 'parent')
    const clarification = createClarification('yuanxiao', 'child')
    store
      .getState()
      .replaceSessionCatalog('yuanxiao', [parent, child, survivor])
    store.getState().openSession(createTranscript('yuanxiao', 'parent'))
    store.getState().openSession(createTranscript('yuanxiao', 'child'))
    store.getState().startSessionExecution({ sessionId: 'parent' })
    store.getState().startSessionExecution({ sessionId: 'child' })
    store.getState().applyAgentEvent({
      type: 'approval-required',
      agentId: 'yuanxiao',
      sessionId: 'parent',
      approval,
      occurredAt: NOW,
    })
    store.getState().applyAgentEvent({
      type: 'clarification-required',
      agentId: 'yuanxiao',
      sessionId: 'child',
      clarification,
      occurredAt: NOW,
    })

    store.getState().removeSessionLineage({
      agentId: 'yuanxiao',
      allSessions: [survivor],
      affectedSessionIds: ['parent', 'child'],
    })

    expect(store.getState().sessionsByAgentId.yuanxiao).toEqual([survivor])
    for (const sessionId of ['parent', 'child']) {
      expect(store.getState().transcriptsBySessionId).not.toHaveProperty(sessionId)
      expect(store.getState().sendingBySessionId).not.toHaveProperty(sessionId)
      expect(store.getState().pendingApprovalsBySessionId).not.toHaveProperty(
        sessionId,
      )
      expect(store.getState().pendingClarificationsBySessionId).not.toHaveProperty(
        sessionId,
      )
    }
  })

  it('一次替换完整会话目录并按 Agent、归档状态分片', () => {
    const store = createWorkbenchStore()
    const archivedA = {
      ...createSession('yuanxiao', 'archived-a'),
      archivedAt: NOW,
    }
    const archivedB = {
      ...createSession('researcher', 'archived-b'),
      archivedAt: NOW,
    }

    const activeA = createSession('yuanxiao', 'active-a')
    const activeB = createSession('researcher', 'active-b')
    store.getState().replaceSessionCatalog('yuanxiao', [archivedA, activeA])
    store.getState().replaceSessionCatalog('researcher', [activeB, archivedB])

    expect(store.getState().archivedSessionsByAgentId).toEqual({
      yuanxiao: [archivedA],
      researcher: [archivedB],
    })
    expect(store.getState().sessionsByAgentId).toEqual({
      yuanxiao: [activeA],
      researcher: [activeB],
    })
  })

  it('composer 草稿只通过语义 action 修改', () => {
    const store = createWorkbenchStore()

    store.getState().updateComposerDraft('准备发送')
    store.getState().updateComposerDraft('')

    expect(store.getState().composerDraft).toBe('')
  })
})
