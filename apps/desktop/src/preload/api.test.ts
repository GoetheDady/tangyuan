import {
  DESKTOP_AGENT_EVENT_CHANNEL,
  DESKTOP_IPC_CHANNELS,
  type AgentEvent,
  type DesktopIpcChannel,
  type DesktopIpcResponse
} from '@tangyuan/contracts'
import { describe, expect, it } from 'vitest'
import { createTangyuanPreloadApi, type IpcInvoke, type IpcSubscribe } from './api'

describe('createTangyuanPreloadApi', () => {
  it('exposes a typed renderer API backed by the allowed IPC channels', async () => {
    const calls: Array<[DesktopIpcChannel, ...unknown[]]> = []
    const invoke: IpcInvoke = async (channel, ...payload) => {
      calls.push([channel, ...payload])

      return undefined as unknown as DesktopIpcResponse<typeof channel>
    }
    const subscriptions: Array<[typeof DESKTOP_AGENT_EVENT_CHANNEL, AgentEvent['type']]> = []
    const subscribe: IpcSubscribe = (channel, listener) => {
      listener({
        type: 'turn-started',
        agentId: 'tangyuan',
        sessionId: 'session-1',
        runId: 'run-1',
        occurredAt: '2026-07-08T00:00:00.000Z'
      })
      subscriptions.push([channel, 'turn-started'])

      return () => undefined
    }
    const api = createTangyuanPreloadApi(invoke, subscribe)

    expect(Object.keys(api).sort()).toEqual([
      'answerClarification',
      'approveBash',
      'approveSkillOperation',
      'archiveAgent',
      'cancelClarification',
      'cancelRun',
      'cancelRuntimeConfigurationVerification',
      'claimAgentDirectory',
      'createSession',
      'deleteSkill',
      'getMessages',
      'getPendingApprovals',
      'getPendingClarifications',
      'getPendingSkillApprovals',
      'getRuntimeSnapshot',
      'getSessionModelInfo',
      'getSkillInstallRecords',
      'getSoul',
      'getTranscript',
      'getUserProfile',
      'installSkill',
      'listAgentSkills',
      'listAgents',
      'listSessions',
      'listSharedSkills',
      'openExternalLink',
      'rebuildTangyuanHome',
      'reconcileAgentDirectories',
      'recoverAgent',
      'refreshRuntime',
      'rejectBash',
      'rejectSkillOperation',
      'resetConfiguration',
      'restoreFromBackup',
      'retryMessage',
      'saveRuntimeConfiguration',
      'sendMessage',
      'setSessionModel',
      'setSessionThinkingLevel',
      'subscribeToAgentEvents',
      'updateAgentConfig',
      'updateSoul',
      'updateUserProfile'
    ])

    await api.getRuntimeSnapshot()
    await api.refreshRuntime()
    await api.saveRuntimeConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890'
    })
    await api.cancelRuntimeConfigurationVerification({ verificationId: 'verify-1' })
    await api.listSessions()
    await api.createSession({ agentId: 'tangyuan', title: '新会话' })
    await api.getTranscript({ agentId: 'tangyuan', sessionId: 'session-1' })
    await api.sendMessage({
      agentId: 'tangyuan',
      sessionId: 'session-1',
      content: '你好'
    })
    await api.cancelRun({ agentId: 'tangyuan', sessionId: 'session-1' })
    await api.listAgents()
    await api.updateAgentConfig({ agentId: 'tangyuan', defaultModelId: 'claude-sonnet-4-5' })
    await api.getSessionModelInfo({ agentId: 'tangyuan', sessionId: 'session-1' })
    await api.setSessionModel({
      agentId: 'tangyuan',
      sessionId: 'session-1',
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5'
    })
    await api.setSessionThinkingLevel({
      agentId: 'tangyuan',
      sessionId: 'session-1',
      level: 'medium'
    })
    await api.archiveAgent({ agentId: 'agent-1' })
    await api.recoverAgent({ agentId: 'agent-1' })
    await api.reconcileAgentDirectories()
    await api.claimAgentDirectory({ agentId: 'agent-1', displayName: '测试 Agent' })
    await api.rebuildTangyuanHome()
    await api.restoreFromBackup()
    await api.resetConfiguration()
    await api.openExternalLink({ url: 'https://example.com' })
    await api.listAgentSkills({ agentId: 'agent-1' })
    await api.listSharedSkills()
    await api.approveBash({ approvalId: 'approval-1' })
    await api.rejectBash({ approvalId: 'approval-2' })
    await api.getPendingApprovals()
    await api.installSkill({
      operation: 'install',
      source: 'shared',
      agentId: 'tangyuan',
      skillName: 'test-skill',
      skillDirPath: '/tmp/test-skill'
    })
    await api.deleteSkill({
      operation: 'delete',
      source: 'agent',
      agentId: 'agent-1',
      targetAgentId: 'agent-1',
      skillName: 'test-skill'
    })
    await api.approveSkillOperation({ approvalId: 'approval-3' })
    await api.rejectSkillOperation({ approvalId: 'approval-4' })
    await api.getPendingSkillApprovals()
    await api.getSkillInstallRecords()
    api.subscribeToAgentEvents(() => undefined)

    expect(calls).toEqual([
      [DESKTOP_IPC_CHANNELS.runtimeGetSnapshot],
      [DESKTOP_IPC_CHANNELS.runtimeRefresh],
      [
        DESKTOP_IPC_CHANNELS.runtimeSaveConfiguration,
        {
          providerId: 'anthropic',
          modelId: 'claude-sonnet-4-5',
          apiKey: 'sk-test-secret-7890'
        }
      ],
      [DESKTOP_IPC_CHANNELS.runtimeCancelConfigurationVerification, { verificationId: 'verify-1' }],
      [DESKTOP_IPC_CHANNELS.sessionsList],
      [
        DESKTOP_IPC_CHANNELS.sessionsCreate,
        {
          agentId: 'tangyuan',
          title: '新会话'
        }
      ],
      [
        DESKTOP_IPC_CHANNELS.sessionsGetMessages,
        {
          agentId: 'tangyuan',
          sessionId: 'session-1'
        }
      ],
      [
        DESKTOP_IPC_CHANNELS.sessionsGetTranscript,
        {
          agentId: 'tangyuan',
          sessionId: 'session-1'
        }
      ],
      [
        DESKTOP_IPC_CHANNELS.sessionsSendMessage,
        {
          agentId: 'tangyuan',
          sessionId: 'session-1',
          content: '你好'
        }
      ],
      [
        DESKTOP_IPC_CHANNELS.sessionsCancelRun,
        {
          agentId: 'tangyuan',
          sessionId: 'session-1'
        }
      ],
      [DESKTOP_IPC_CHANNELS.agentsList],
      [
        DESKTOP_IPC_CHANNELS.agentsUpdateConfig,
        { agentId: 'tangyuan', defaultModelId: 'claude-sonnet-4-5' }
      ],
      [DESKTOP_IPC_CHANNELS.sessionsGetModelInfo, { agentId: 'tangyuan', sessionId: 'session-1' }],
      [
        DESKTOP_IPC_CHANNELS.sessionsSetModel,
        {
          agentId: 'tangyuan',
          sessionId: 'session-1',
          providerId: 'anthropic',
          modelId: 'claude-sonnet-4-5'
        }
      ],
      [
        DESKTOP_IPC_CHANNELS.sessionsSetThinkingLevel,
        {
          agentId: 'tangyuan',
          sessionId: 'session-1',
          level: 'medium'
        }
      ],
      [DESKTOP_IPC_CHANNELS.agentsArchive, { agentId: 'agent-1' }],
      [DESKTOP_IPC_CHANNELS.agentsRecover, { agentId: 'agent-1' }],
      [DESKTOP_IPC_CHANNELS.agentsReconcile],
      [
        DESKTOP_IPC_CHANNELS.agentsClaimDirectory,
        { agentId: 'agent-1', displayName: '测试 Agent' }
      ],
      [DESKTOP_IPC_CHANNELS.agentsRebuildTangyuan],
      [DESKTOP_IPC_CHANNELS.runtimeRestoreFromBackup],
      [DESKTOP_IPC_CHANNELS.runtimeResetConfiguration],
      [DESKTOP_IPC_CHANNELS.openExternalLink, { url: 'https://example.com' }],
      [DESKTOP_IPC_CHANNELS.skillsListAgent, { agentId: 'agent-1' }],
      [DESKTOP_IPC_CHANNELS.skillsListShared],
      [DESKTOP_IPC_CHANNELS.sessionsApproveBash, { approvalId: 'approval-1' }],
      [DESKTOP_IPC_CHANNELS.sessionsRejectBash, { approvalId: 'approval-2' }],
      [DESKTOP_IPC_CHANNELS.sessionsGetPendingApprovals],
      [
        DESKTOP_IPC_CHANNELS.skillsInstall,
        {
          operation: 'install',
          source: 'shared',
          agentId: 'tangyuan',
          skillName: 'test-skill',
          skillDirPath: '/tmp/test-skill'
        }
      ],
      [
        DESKTOP_IPC_CHANNELS.skillsDelete,
        {
          operation: 'delete',
          source: 'agent',
          agentId: 'agent-1',
          targetAgentId: 'agent-1',
          skillName: 'test-skill'
        }
      ],
      [DESKTOP_IPC_CHANNELS.skillsApproveOperation, { approvalId: 'approval-3' }],
      [DESKTOP_IPC_CHANNELS.skillsRejectOperation, { approvalId: 'approval-4' }],
      [DESKTOP_IPC_CHANNELS.skillsGetPendingApprovals],
      [DESKTOP_IPC_CHANNELS.skillsGetInstallRecords]
    ])
    expect(subscriptions).toEqual([[DESKTOP_AGENT_EVENT_CHANNEL, 'turn-started']])
  })
})
