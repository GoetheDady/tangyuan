import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  type AgentEventListener,
  createDefaultSessionSummary,
  type DesktopPreloadApi,
  type TranscriptSnapshot
} from '@tangyuan/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import {
  createDeferred,
  createReadyRuntimeSnapshot,
  installDefaultAppApi,
  resetAppTestEnvironment
} from './app.test-helpers'

describe('App', () => {
  afterEach(resetAppTestEnvironment)
  beforeEach(installDefaultAppApi)
  it('streams agent event deltas into the visible transcript', async () => {
    const user = userEvent.setup()
    const readyRuntime = createReadyRuntimeSnapshot({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      maskedValue: 'sk-t...7890'
    })
    const listeners: AgentEventListener[] = []
    const releaseSend = createDeferred<void>()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        getRuntimeSnapshot: vi.fn().mockResolvedValue(readyRuntime),
        refreshRuntime: vi.fn().mockResolvedValue(readyRuntime),
        saveRuntimeConfiguration: vi.fn().mockResolvedValue(readyRuntime),
        cancelRuntimeConfigurationVerification: vi.fn().mockResolvedValue(readyRuntime),
        listSessions: vi.fn().mockResolvedValue([
          createDefaultSessionSummary({
            sessionId: 'welcome',
            title: '新会话',
            updatedAt: '2026-07-08T00:00:00.000Z'
          })
        ]),
        createSession: vi.fn(),
        getTranscript: vi.fn().mockResolvedValue({
          sessionId: 'welcome',
          agentId: 'tangyuan',
          entries: [],
          updatedAt: '2026-01-01T00:00:00.000Z'
        }),
        sendMessage: vi.fn(async () => {
          for (const listener of listeners) {
            listener({
              type: 'run-state-changed',
              agentId: 'tangyuan',
              sessionId: 'welcome',
              state: 'running',
              occurredAt: '2026-07-08T00:00:01.000Z'
            })
            listener({
              type: 'transcript-delta',
              agentId: 'tangyuan',
              sessionId: 'welcome',
              delta: {
                type: 'entry-appended',
                entry: {
                  kind: 'agent-reply',
                  index: 0,
                  messageId: 'agent-message-1',
                  content: '',
                  createdAt: '2026-07-08T00:00:02.000Z',
                  attempt: {
                    attemptId: 'run-1',
                    runId: 'run-1',
                    status: 'running',
                    startedAt: '2026-07-08T00:00:01.000Z',
                    completedAt: null
                  },
                  turns: []
                }
              },
              occurredAt: '2026-07-08T00:00:02.000Z'
            })
            for (const [delta, occurredAt] of [
              ['你', '2026-07-08T00:00:02.000Z'],
              ['好', '2026-07-08T00:00:03.000Z']
            ] as const) {
              listener({
                type: 'transcript-delta',
                agentId: 'tangyuan',
                sessionId: 'welcome',
                delta: { type: 'delta-appended', index: 0, delta },
                occurredAt
              })
            }
          }

          await releaseSend.promise

          return {
            sessionId: 'welcome',
            agentId: 'tangyuan',
            entries: [
              {
                kind: 'agent-reply',
                index: 0,
                messageId: 'agent-message-1',
                content: '你好',
                createdAt: '2026-07-08T00:00:02.000Z',
                attempt: {
                  attemptId: 'run-1',
                  runId: 'run-1',
                  status: 'completed',
                  startedAt: '2026-07-08T00:00:01.000Z',
                  completedAt: '2026-07-08T00:00:03.000Z'
                },
                turns: []
              }
            ],
            updatedAt: '2026-07-08T00:00:03.000Z'
          } satisfies TranscriptSnapshot
        }),
        retryMessage: vi.fn().mockResolvedValue([]),
        cancelRun: vi.fn(),
        subscribeToAgentEvents: vi.fn((listener: AgentEventListener) => {
          listeners.push(listener)

          return () => undefined
        }),
        openExternalLink: vi.fn(),
        restoreFromBackup: vi.fn(),
        resetConfiguration: vi.fn(),
        listAgents: vi.fn().mockResolvedValue([
          {
            agentId: 'tangyuan',
            displayName: '汤圆',
            status: 'active' as const,
            defaultProviderId: null,
            defaultModelId: null,
            homePath: '~/.tangyuan/agents/tangyuan',
            archivedAt: null
          }
        ]),
        updateAgentConfig: vi.fn(),
        getSessionModelInfo: vi.fn().mockResolvedValue({
          providerId: 'anthropic',
          modelId: 'claude-sonnet-4-5',
          displayName: 'Claude Sonnet 4.5',
          thinkingLevel: null,
          supportedThinkingLevels: [],
          supportsThinking: false
        }),
        setSessionModel: vi.fn(),
        setSessionThinkingLevel: vi.fn(),
        archiveAgent: vi.fn(),
        recoverAgent: vi.fn(),
        reconcileAgentDirectories: vi.fn(),
        claimAgentDirectory: vi.fn(),
        rebuildTangyuanHome: vi.fn(),
        getSoul: vi.fn(),
        getUserProfile: vi.fn(),
        updateSoul: vi.fn(),
        updateUserProfile: vi.fn(),
        listAgentSkills: vi.fn(),
        listSharedSkills: vi.fn(),
        approveBash: vi.fn(),
        rejectBash: vi.fn(),
        getPendingApprovals: vi.fn(),
        answerClarification: vi.fn(),
        cancelClarification: vi.fn(),
        getPendingClarifications: vi.fn().mockResolvedValue([]),
        installSkill: vi.fn(),
        deleteSkill: vi.fn(),
        approveSkillOperation: vi.fn(),
        rejectSkillOperation: vi.fn(),
        getPendingSkillApprovals: vi.fn(),
        getSkillInstallRecords: vi.fn()
      } satisfies DesktopPreloadApi
    })
    render(<App />)

    await user.type(await screen.findByLabelText('消息'), '开始')
    await user.click(screen.getByRole('button', { name: '发送' }))

    expect(await screen.findByText('你好')).toBeInTheDocument()
    expect(screen.getAllByText('运行中').length).toBeGreaterThan(0)
    releaseSend.resolve()
  })
  it('hides system messages from the chat transcript', async () => {
    const readyRuntime = createReadyRuntimeSnapshot({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      maskedValue: 'sk-t...7890'
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        getRuntimeSnapshot: vi.fn().mockResolvedValue(readyRuntime),
        refreshRuntime: vi.fn().mockResolvedValue(readyRuntime),
        saveRuntimeConfiguration: vi.fn().mockResolvedValue(readyRuntime),
        cancelRuntimeConfigurationVerification: vi.fn().mockResolvedValue(readyRuntime),
        listSessions: vi.fn().mockResolvedValue([
          createDefaultSessionSummary({
            sessionId: 'welcome',
            title: '新会话',
            updatedAt: '2026-07-08T00:00:00.000Z'
          })
        ]),
        createSession: vi.fn(),
        getTranscript: vi.fn().mockResolvedValue({
          sessionId: 'welcome',
          agentId: 'tangyuan',
          entries: [
            {
              kind: 'user-message',
              index: 0,
              messageId: 'message-1',
              content: '用户可见消息',
              createdAt: '2026-07-08T00:00:00.000Z'
            },
            {
              kind: 'agent-reply',
              index: 1,
              messageId: 'message-2',
              content: 'Agent 可见回复',
              createdAt: '2026-07-08T00:00:01.000Z',
              attempt: null,
              turns: []
            }
          ],
          updatedAt: '2026-07-08T00:00:02.000Z'
        }),
        sendMessage: vi.fn(),
        retryMessage: vi.fn().mockResolvedValue([]),
        cancelRun: vi.fn(),
        subscribeToAgentEvents: vi.fn(() => () => undefined),
        openExternalLink: vi.fn(),
        restoreFromBackup: vi.fn(),
        resetConfiguration: vi.fn(),
        listAgents: vi.fn().mockResolvedValue([
          {
            agentId: 'tangyuan',
            displayName: '汤圆',
            status: 'active' as const,
            defaultProviderId: null,
            defaultModelId: null,
            homePath: '~/.tangyuan/agents/tangyuan',
            archivedAt: null
          }
        ]),
        updateAgentConfig: vi.fn(),
        getSessionModelInfo: vi.fn().mockResolvedValue({
          providerId: 'anthropic',
          modelId: 'claude-sonnet-4-5',
          displayName: 'Claude Sonnet 4.5',
          thinkingLevel: null,
          supportedThinkingLevels: [],
          supportsThinking: false
        }),
        setSessionModel: vi.fn(),
        setSessionThinkingLevel: vi.fn(),
        archiveAgent: vi.fn(),
        recoverAgent: vi.fn(),
        reconcileAgentDirectories: vi.fn(),
        claimAgentDirectory: vi.fn(),
        rebuildTangyuanHome: vi.fn(),
        getSoul: vi.fn(),
        getUserProfile: vi.fn(),
        updateSoul: vi.fn(),
        updateUserProfile: vi.fn(),
        listAgentSkills: vi.fn(),
        listSharedSkills: vi.fn(),
        approveBash: vi.fn(),
        rejectBash: vi.fn(),
        getPendingApprovals: vi.fn(),
        answerClarification: vi.fn(),
        cancelClarification: vi.fn(),
        getPendingClarifications: vi.fn().mockResolvedValue([]),
        installSkill: vi.fn(),
        deleteSkill: vi.fn(),
        approveSkillOperation: vi.fn(),
        rejectSkillOperation: vi.fn(),
        getPendingSkillApprovals: vi.fn(),
        getSkillInstallRecords: vi.fn()
      } satisfies DesktopPreloadApi
    })
    render(<App />)

    expect(await screen.findByText('用户可见消息')).toBeInTheDocument()
    expect(screen.getByText('Agent 可见回复')).toBeInTheDocument()
    expect(screen.queryByText('正在调用工具')).not.toBeInTheDocument()
  })
  it('renders agent messages with Markdown (code blocks, bold, lists)', async () => {
    const readyRuntime = createReadyRuntimeSnapshot({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      maskedValue: 'sk-t...7890'
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        getRuntimeSnapshot: vi.fn().mockResolvedValue(readyRuntime),
        refreshRuntime: vi.fn().mockResolvedValue(readyRuntime),
        saveRuntimeConfiguration: vi.fn().mockResolvedValue(readyRuntime),
        cancelRuntimeConfigurationVerification: vi.fn().mockResolvedValue(readyRuntime),
        listSessions: vi.fn().mockResolvedValue([
          createDefaultSessionSummary({
            sessionId: 'welcome',
            title: '新会话',
            updatedAt: '2026-07-08T00:00:00.000Z'
          })
        ]),
        createSession: vi.fn(),
        getTranscript: vi.fn().mockResolvedValue({
          sessionId: 'welcome',
          agentId: 'tangyuan',
          entries: [
            {
              kind: 'agent-reply',
              index: 0,
              messageId: 'message-1',
              content: '# 你好\n\n这是 `代码`。',
              createdAt: '2026-07-08T00:00:00.000Z',
              attempt: null,
              turns: []
            }
          ],
          updatedAt: '2026-07-08T00:00:02.000Z'
        }),
        sendMessage: vi.fn(),
        retryMessage: vi.fn().mockResolvedValue([]),
        cancelRun: vi.fn(),
        subscribeToAgentEvents: vi.fn(() => () => undefined),
        openExternalLink: vi.fn(),
        restoreFromBackup: vi.fn(),
        resetConfiguration: vi.fn(),
        listAgents: vi.fn().mockResolvedValue([
          {
            agentId: 'tangyuan',
            displayName: '汤圆',
            status: 'active' as const,
            defaultProviderId: null,
            defaultModelId: null,
            homePath: '~/.tangyuan/agents/tangyuan',
            archivedAt: null
          }
        ]),
        updateAgentConfig: vi.fn(),
        getSessionModelInfo: vi.fn().mockResolvedValue({
          providerId: 'anthropic',
          modelId: 'claude-sonnet-4-5',
          displayName: 'Claude Sonnet 4.5',
          thinkingLevel: null,
          supportedThinkingLevels: [],
          supportsThinking: false
        }),
        setSessionModel: vi.fn(),
        setSessionThinkingLevel: vi.fn(),
        archiveAgent: vi.fn(),
        recoverAgent: vi.fn(),
        reconcileAgentDirectories: vi.fn(),
        claimAgentDirectory: vi.fn(),
        rebuildTangyuanHome: vi.fn(),
        getSoul: vi.fn(),
        getUserProfile: vi.fn(),
        updateSoul: vi.fn(),
        updateUserProfile: vi.fn(),
        listAgentSkills: vi.fn(),
        listSharedSkills: vi.fn(),
        approveBash: vi.fn(),
        rejectBash: vi.fn(),
        getPendingApprovals: vi.fn(),
        answerClarification: vi.fn(),
        cancelClarification: vi.fn(),
        getPendingClarifications: vi.fn().mockResolvedValue([]),
        installSkill: vi.fn(),
        deleteSkill: vi.fn(),
        approveSkillOperation: vi.fn(),
        rejectSkillOperation: vi.fn(),
        getPendingSkillApprovals: vi.fn(),
        getSkillInstallRecords: vi.fn()
      } satisfies DesktopPreloadApi
    })
    render(<App />)

    // Markdown 标题应渲染
    expect(await screen.findByText('你好')).toBeInTheDocument()
    // 代码块内容应在 DOM 中
    const codeElement = document.querySelector('[data-streamdown="inline-code"]')
    expect(codeElement).toBeInTheDocument()
    expect(codeElement?.textContent).toContain('代码')
  })
  it('renders user messages as plain text without Markdown parsing', async () => {
    const readyRuntime = createReadyRuntimeSnapshot({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      maskedValue: 'sk-t...7890'
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        getRuntimeSnapshot: vi.fn().mockResolvedValue(readyRuntime),
        refreshRuntime: vi.fn().mockResolvedValue(readyRuntime),
        saveRuntimeConfiguration: vi.fn().mockResolvedValue(readyRuntime),
        cancelRuntimeConfigurationVerification: vi.fn().mockResolvedValue(readyRuntime),
        listSessions: vi.fn().mockResolvedValue([
          createDefaultSessionSummary({
            sessionId: 'welcome',
            title: '新会话',
            updatedAt: '2026-07-08T00:00:00.000Z'
          })
        ]),
        createSession: vi.fn(),
        getTranscript: vi.fn().mockResolvedValue({
          sessionId: 'welcome',
          agentId: 'tangyuan',
          entries: [
            {
              kind: 'user-message',
              index: 0,
              messageId: 'message-1',
              content: '# 这不是标题 **不是粗体**',
              createdAt: '2026-07-08T00:00:00.000Z'
            }
          ],
          updatedAt: '2026-07-08T00:00:02.000Z'
        }),
        sendMessage: vi.fn(),
        retryMessage: vi.fn().mockResolvedValue([]),
        cancelRun: vi.fn(),
        subscribeToAgentEvents: vi.fn(() => () => undefined),
        openExternalLink: vi.fn(),
        restoreFromBackup: vi.fn(),
        resetConfiguration: vi.fn(),
        listAgents: vi.fn().mockResolvedValue([
          {
            agentId: 'tangyuan',
            displayName: '汤圆',
            status: 'active' as const,
            defaultProviderId: null,
            defaultModelId: null,
            homePath: '~/.tangyuan/agents/tangyuan',
            archivedAt: null
          }
        ]),
        updateAgentConfig: vi.fn(),
        getSessionModelInfo: vi.fn().mockResolvedValue({
          providerId: 'anthropic',
          modelId: 'claude-sonnet-4-5',
          displayName: 'Claude Sonnet 4.5',
          thinkingLevel: null,
          supportedThinkingLevels: [],
          supportsThinking: false
        }),
        setSessionModel: vi.fn(),
        setSessionThinkingLevel: vi.fn(),
        archiveAgent: vi.fn(),
        recoverAgent: vi.fn(),
        reconcileAgentDirectories: vi.fn(),
        claimAgentDirectory: vi.fn(),
        rebuildTangyuanHome: vi.fn(),
        getSoul: vi.fn(),
        getUserProfile: vi.fn(),
        updateSoul: vi.fn(),
        updateUserProfile: vi.fn(),
        listAgentSkills: vi.fn(),
        listSharedSkills: vi.fn(),
        approveBash: vi.fn(),
        rejectBash: vi.fn(),
        getPendingApprovals: vi.fn(),
        answerClarification: vi.fn(),
        cancelClarification: vi.fn(),
        getPendingClarifications: vi.fn().mockResolvedValue([]),
        installSkill: vi.fn(),
        deleteSkill: vi.fn(),
        approveSkillOperation: vi.fn(),
        rejectSkillOperation: vi.fn(),
        getPendingSkillApprovals: vi.fn(),
        getSkillInstallRecords: vi.fn()
      } satisfies DesktopPreloadApi
    })
    render(<App />)

    // 用户消息纯文本 - 不应有 streamdown 属性
    expect(await screen.findByText('# 这不是标题 **不是粗体**')).toBeInTheDocument()
    const markdownElement = document.querySelector('[data-streamdown]')
    expect(markdownElement).toBeNull()
  })
})
