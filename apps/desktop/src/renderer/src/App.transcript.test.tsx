import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  type AgentEventListener,
  createDefaultSessionSummary,
  type DesktopPreloadApi,
  type TranscriptSnapshot,
} from '@yuanxiao/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import {
  createDeferred,
  createReadyRuntimeSnapshot,
  createResumeSessionFromApi,
  installDefaultAppApi,
  resetAppTestEnvironment,
} from './app.test-helpers'

describe('App', () => {
  afterEach(resetAppTestEnvironment)
  beforeEach(installDefaultAppApi)
  it('streams agent event deltas into the visible transcript', async () => {
    const user = userEvent.setup()
    const readyRuntime = createReadyRuntimeSnapshot({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      maskedValue: 'sk-t...7890',
    })
    const listeners: AgentEventListener[] = []
    const releaseSend = createDeferred<void>()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        getRuntimeSnapshot: vi.fn().mockResolvedValue(readyRuntime),
        refreshRuntime: vi.fn().mockResolvedValue(readyRuntime),
        saveRuntimeConfiguration: vi.fn().mockResolvedValue(readyRuntime),
        saveProvider: vi.fn().mockResolvedValue(readyRuntime),
        deleteProvider: vi.fn().mockResolvedValue(readyRuntime),
        cancelRuntimeConfigurationVerification: vi
          .fn()
          .mockResolvedValue(readyRuntime),
        listSessions: vi.fn().mockResolvedValue([
          createDefaultSessionSummary({
            sessionId: 'welcome',
            title: '新会话',
            updatedAt: '2026-07-08T00:00:00.000Z',
          }),
        ]),
        resumeSession: createResumeSessionFromApi(),
        setLastActiveSession: vi.fn().mockResolvedValue(null),
        createSession: vi.fn(),
        getTranscript: vi.fn().mockResolvedValue({
          sessionId: 'welcome',
          agentId: 'yuanxiao',
          entries: [],
          updatedAt: '2026-01-01T00:00:00.000Z',
        }),
        sendMessage: vi.fn(async () => {
          for (const listener of listeners) {
            listener({
              type: 'run-state-changed',
              agentId: 'yuanxiao',
              sessionId: 'welcome',
              state: 'running',
              occurredAt: '2026-07-08T00:00:01.000Z',
            })
            listener({
              type: 'transcript-delta',
              agentId: 'yuanxiao',
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
                    completedAt: null,
                  },
                  turns: [],
                },
              },
              occurredAt: '2026-07-08T00:00:02.000Z',
            })
            for (const [delta, occurredAt] of [
              ['你', '2026-07-08T00:00:02.000Z'],
              ['好', '2026-07-08T00:00:03.000Z'],
            ] as const) {
              listener({
                type: 'transcript-delta',
                agentId: 'yuanxiao',
                sessionId: 'welcome',
                delta: { type: 'delta-appended', index: 0, delta },
                occurredAt,
              })
            }
          }

          await releaseSend.promise

          return {
            sessionId: 'welcome',
            agentId: 'yuanxiao',
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
                  completedAt: '2026-07-08T00:00:03.000Z',
                },
                turns: [],
              },
            ],
            updatedAt: '2026-07-08T00:00:03.000Z',
          } satisfies TranscriptSnapshot
        }),
        retryMessage: vi.fn().mockResolvedValue([]),
        forkSession: vi.fn().mockResolvedValue([]),
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
            agentId: 'yuanxiao',
            displayName: '元宵',
            status: 'active' as const,
            defaultProviderId: null,
            defaultModelId: null,
            homePath: '~/.yuanxiao/agents/yuanxiao',
            archivedAt: null,
          },
        ]),
        updateAgentConfig: vi.fn(),
        getSessionModelInfo: vi.fn().mockResolvedValue({
          providerId: 'anthropic',
          modelId: 'claude-sonnet-4-5',
          displayName: 'Claude Sonnet 4.5',
          thinkingLevel: null,
          supportedThinkingLevels: [],
          supportsThinking: false,
        }),
        setSessionModel: vi.fn(),
        setSessionThinkingLevel: vi.fn(),
        archiveAgent: vi.fn(),
        recoverAgent: vi.fn(),
        archiveSession: vi.fn(),
        recoverSession: vi.fn(),
        deleteSession: vi.fn(),
        reconcileAgentDirectories: vi.fn(),
        claimAgentDirectory: vi.fn(),
        rebuildYuanxiaoHome: vi.fn(),
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
        getSkillInstallRecords: vi.fn(),
        sendNotification: vi.fn().mockResolvedValue(undefined),
      } satisfies DesktopPreloadApi,
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
      maskedValue: 'sk-t...7890',
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        getRuntimeSnapshot: vi.fn().mockResolvedValue(readyRuntime),
        refreshRuntime: vi.fn().mockResolvedValue(readyRuntime),
        saveRuntimeConfiguration: vi.fn().mockResolvedValue(readyRuntime),
        saveProvider: vi.fn().mockResolvedValue(readyRuntime),
        deleteProvider: vi.fn().mockResolvedValue(readyRuntime),
        cancelRuntimeConfigurationVerification: vi
          .fn()
          .mockResolvedValue(readyRuntime),
        listSessions: vi.fn().mockResolvedValue([
          createDefaultSessionSummary({
            sessionId: 'welcome',
            title: '新会话',
            updatedAt: '2026-07-08T00:00:00.000Z',
          }),
        ]),
        resumeSession: createResumeSessionFromApi(),
        setLastActiveSession: vi.fn().mockResolvedValue(null),
        createSession: vi.fn(),
        getTranscript: vi.fn().mockResolvedValue({
          sessionId: 'welcome',
          agentId: 'yuanxiao',
          entries: [
            {
              kind: 'user-message',
              index: 0,
              messageId: 'message-1',
              content: '用户可见消息',
              createdAt: '2026-07-08T00:00:00.000Z',
            },
            {
              kind: 'agent-reply',
              index: 1,
              messageId: 'message-2',
              content: 'Agent 可见回复',
              createdAt: '2026-07-08T00:00:01.000Z',
              attempt: null,
              turns: [],
            },
          ],
          updatedAt: '2026-07-08T00:00:02.000Z',
        }),
        sendMessage: vi.fn(),
        retryMessage: vi.fn().mockResolvedValue([]),
        forkSession: vi.fn().mockResolvedValue([]),
        cancelRun: vi.fn(),
        subscribeToAgentEvents: vi.fn(() => () => undefined),
        openExternalLink: vi.fn(),
        restoreFromBackup: vi.fn(),
        resetConfiguration: vi.fn(),
        listAgents: vi.fn().mockResolvedValue([
          {
            agentId: 'yuanxiao',
            displayName: '元宵',
            status: 'active' as const,
            defaultProviderId: null,
            defaultModelId: null,
            homePath: '~/.yuanxiao/agents/yuanxiao',
            archivedAt: null,
          },
        ]),
        updateAgentConfig: vi.fn(),
        getSessionModelInfo: vi.fn().mockResolvedValue({
          providerId: 'anthropic',
          modelId: 'claude-sonnet-4-5',
          displayName: 'Claude Sonnet 4.5',
          thinkingLevel: null,
          supportedThinkingLevels: [],
          supportsThinking: false,
        }),
        setSessionModel: vi.fn(),
        setSessionThinkingLevel: vi.fn(),
        archiveAgent: vi.fn(),
        recoverAgent: vi.fn(),
        archiveSession: vi.fn(),
        recoverSession: vi.fn(),
        deleteSession: vi.fn(),
        reconcileAgentDirectories: vi.fn(),
        claimAgentDirectory: vi.fn(),
        rebuildYuanxiaoHome: vi.fn(),
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
        getSkillInstallRecords: vi.fn(),
        sendNotification: vi.fn().mockResolvedValue(undefined),
      } satisfies DesktopPreloadApi,
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
      maskedValue: 'sk-t...7890',
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        getRuntimeSnapshot: vi.fn().mockResolvedValue(readyRuntime),
        refreshRuntime: vi.fn().mockResolvedValue(readyRuntime),
        saveRuntimeConfiguration: vi.fn().mockResolvedValue(readyRuntime),
        saveProvider: vi.fn().mockResolvedValue(readyRuntime),
        deleteProvider: vi.fn().mockResolvedValue(readyRuntime),
        cancelRuntimeConfigurationVerification: vi
          .fn()
          .mockResolvedValue(readyRuntime),
        listSessions: vi.fn().mockResolvedValue([
          createDefaultSessionSummary({
            sessionId: 'welcome',
            title: '新会话',
            updatedAt: '2026-07-08T00:00:00.000Z',
          }),
        ]),
        resumeSession: createResumeSessionFromApi(),
        setLastActiveSession: vi.fn().mockResolvedValue(null),
        createSession: vi.fn(),
        getTranscript: vi.fn().mockResolvedValue({
          sessionId: 'welcome',
          agentId: 'yuanxiao',
          entries: [
            {
              kind: 'agent-reply',
              index: 0,
              messageId: 'message-1',
              content: '# 你好\n\n这是 `代码`。',
              createdAt: '2026-07-08T00:00:00.000Z',
              attempt: null,
              turns: [],
            },
          ],
          updatedAt: '2026-07-08T00:00:02.000Z',
        }),
        sendMessage: vi.fn(),
        retryMessage: vi.fn().mockResolvedValue([]),
        forkSession: vi.fn().mockResolvedValue([]),
        cancelRun: vi.fn(),
        subscribeToAgentEvents: vi.fn(() => () => undefined),
        openExternalLink: vi.fn(),
        restoreFromBackup: vi.fn(),
        resetConfiguration: vi.fn(),
        listAgents: vi.fn().mockResolvedValue([
          {
            agentId: 'yuanxiao',
            displayName: '元宵',
            status: 'active' as const,
            defaultProviderId: null,
            defaultModelId: null,
            homePath: '~/.yuanxiao/agents/yuanxiao',
            archivedAt: null,
          },
        ]),
        updateAgentConfig: vi.fn(),
        getSessionModelInfo: vi.fn().mockResolvedValue({
          providerId: 'anthropic',
          modelId: 'claude-sonnet-4-5',
          displayName: 'Claude Sonnet 4.5',
          thinkingLevel: null,
          supportedThinkingLevels: [],
          supportsThinking: false,
        }),
        setSessionModel: vi.fn(),
        setSessionThinkingLevel: vi.fn(),
        archiveAgent: vi.fn(),
        recoverAgent: vi.fn(),
        archiveSession: vi.fn(),
        recoverSession: vi.fn(),
        deleteSession: vi.fn(),
        reconcileAgentDirectories: vi.fn(),
        claimAgentDirectory: vi.fn(),
        rebuildYuanxiaoHome: vi.fn(),
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
        getSkillInstallRecords: vi.fn(),
        sendNotification: vi.fn().mockResolvedValue(undefined),
      } satisfies DesktopPreloadApi,
    })
    render(<App />)

    // Markdown 标题应渲染
    expect(await screen.findByText('你好')).toBeInTheDocument()
    // 代码块内容应在 DOM 中
    const codeElement = document.querySelector(
      '[data-streamdown="inline-code"]',
    )
    expect(codeElement).toBeInTheDocument()
    expect(codeElement?.textContent).toContain('代码')
  })
  it('hides awaiting-response-indicator after cancel stops the active run', async () => {
    // 模拟：有一个正在运行的 session，用户点击停止后，indicator 应隐藏
    const user = userEvent.setup()
    const readyRuntime = createReadyRuntimeSnapshot({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      maskedValue: 'sk-t...7890',
    })
    const listeners: AgentEventListener[] = []
    // Deferred：控制 sendMessage 不立即 resolve（模拟长时间运行的请求）
    const releaseSend = createDeferred<void>()
    const releaseCancel = createDeferred<void>()
    const cancelledSession = {
      ...createDefaultSessionSummary({
        sessionId: 'welcome',
        title: '新会话',
        updatedAt: '2026-07-08T00:00:05.000Z',
      }),
      state: 'cancelled' as const,
    }
    const mockListSessions = vi.fn().mockResolvedValue([
      {
        ...createDefaultSessionSummary({
          sessionId: 'welcome',
          title: '新会话',
          updatedAt: '2026-07-08T00:00:00.000Z',
        }),
        state: 'running' as const,
      },
    ])

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        getRuntimeSnapshot: vi.fn().mockResolvedValue(readyRuntime),
        refreshRuntime: vi.fn().mockResolvedValue(readyRuntime),
        saveRuntimeConfiguration: vi.fn().mockResolvedValue(readyRuntime),
        saveProvider: vi.fn().mockResolvedValue(readyRuntime),
        deleteProvider: vi.fn().mockResolvedValue(readyRuntime),
        cancelRuntimeConfigurationVerification: vi
          .fn()
          .mockResolvedValue(readyRuntime),
        listSessions: mockListSessions,
        resumeSession: createResumeSessionFromApi(),
        setLastActiveSession: vi.fn().mockResolvedValue(null),
        createSession: vi.fn(),
        getTranscript: vi.fn().mockResolvedValue({
          sessionId: 'welcome',
          agentId: 'yuanxiao',
          entries: [
            {
              kind: 'user-message',
              index: 0,
              messageId: 'msg-1',
              content: '数到 30',
              createdAt: '2026-07-08T00:00:01.000Z',
            },
            {
              kind: 'agent-reply',
              index: 1,
              messageId: 'msg-2',
              content: '1',
              createdAt: '2026-07-08T00:00:02.000Z',
              attempt: {
                attemptId: 'run-1',
                runId: 'run-1',
                status: 'running',
                startedAt: '2026-07-08T00:00:01.000Z',
                completedAt: null,
              },
              turns: [],
            },
          ],
          updatedAt: '2026-07-08T00:00:02.000Z',
        }),
        sendMessage: vi.fn(async () => {
          // 模拟运行开始：先发一个 attempt-started 和 entry-appended
          for (const listener of listeners) {
            listener({
              type: 'run-state-changed',
              agentId: 'yuanxiao',
              sessionId: 'welcome',
              state: 'running',
              occurredAt: '2026-07-08T00:00:01.000Z',
            })
            listener({
              type: 'transcript-delta',
              agentId: 'yuanxiao',
              sessionId: 'welcome',
              delta: {
                type: 'entry-appended',
                entry: {
                  kind: 'agent-reply',
                  index: 1,
                  messageId: 'msg-2',
                  content: '',
                  createdAt: '2026-07-08T00:00:02.000Z',
                  attempt: {
                    attemptId: 'run-1',
                    runId: 'run-1',
                    status: 'running',
                    startedAt: '2026-07-08T00:00:01.000Z',
                    completedAt: null,
                  },
                  turns: [],
                },
              },
              occurredAt: '2026-07-08T00:00:02.000Z',
            })
          }

          await releaseSend.promise

          return {
            sessionId: 'welcome',
            agentId: 'yuanxiao',
            entries: [
              {
                kind: 'user-message',
                index: 0,
                messageId: 'msg-1',
                content: '数到 30',
                createdAt: '2026-07-08T00:00:01.000Z',
              },
              {
                kind: 'agent-reply',
                index: 1,
                messageId: 'msg-2',
                content: '1, 2, 3, ...',
                createdAt: '2026-07-08T00:00:02.000Z',
                attempt: {
                  attemptId: 'run-1',
                  runId: 'run-1',
                  status: 'cancelled',
                  startedAt: '2026-07-08T00:00:01.000Z',
                  completedAt: '2026-07-08T00:00:05.000Z',
                },
                turns: [],
              },
            ],
            updatedAt: '2026-07-08T00:00:05.000Z',
          } satisfies TranscriptSnapshot
        }),
        retryMessage: vi.fn().mockResolvedValue([]),
        forkSession: vi.fn().mockResolvedValue([]),
        cancelRun: vi.fn(async () => {
          // 模拟 cancel：更新 listSessions 并 emit turn-cancelled 事件
          mockListSessions.mockResolvedValue([cancelledSession])
          for (const listener of listeners) {
            listener({
              type: 'turn-cancelled',
              agentId: 'yuanxiao',
              sessionId: 'welcome',
              runId: 'run-1',
              occurredAt: '2026-07-08T00:00:05.000Z',
            })
            listener({
              type: 'transcript-delta',
              agentId: 'yuanxiao',
              sessionId: 'welcome',
              delta: {
                type: 'attempt-status-changed',
                index: 1,
                attempt: {
                  attemptId: 'run-1',
                  runId: 'run-1',
                  status: 'cancelled',
                  startedAt: '2026-07-08T00:00:01.000Z',
                  completedAt: '2026-07-08T00:00:05.000Z',
                },
              },
              occurredAt: '2026-07-08T00:00:05.000Z',
            })
          }
          releaseSend.resolve()
          await releaseCancel.promise
          return cancelledSession
        }),
        subscribeToAgentEvents: vi.fn((listener: AgentEventListener) => {
          listeners.push(listener)
          return () => undefined
        }),
        openExternalLink: vi.fn(),
        restoreFromBackup: vi.fn(),
        resetConfiguration: vi.fn(),
        listAgents: vi.fn().mockResolvedValue([
          {
            agentId: 'yuanxiao',
            displayName: '元宵',
            status: 'active' as const,
            defaultProviderId: null,
            defaultModelId: null,
            homePath: '~/.yuanxiao/agents/yuanxiao',
            archivedAt: null,
          },
        ]),
        updateAgentConfig: vi.fn(),
        getSessionModelInfo: vi.fn().mockResolvedValue({
          providerId: 'anthropic',
          modelId: 'claude-sonnet-4-5',
          displayName: 'Claude Sonnet 4.5',
          thinkingLevel: null,
          supportedThinkingLevels: [],
          supportsThinking: false,
        }),
        setSessionModel: vi.fn(),
        setSessionThinkingLevel: vi.fn(),
        archiveAgent: vi.fn(),
        recoverAgent: vi.fn(),
        archiveSession: vi.fn(),
        recoverSession: vi.fn(),
        deleteSession: vi.fn(),
        reconcileAgentDirectories: vi.fn(),
        claimAgentDirectory: vi.fn(),
        rebuildYuanxiaoHome: vi.fn(),
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
        getSkillInstallRecords: vi.fn(),
        sendNotification: vi.fn().mockResolvedValue(undefined),
      } satisfies DesktopPreloadApi,
    })
    render(<App />)

    // 初始加载完成：应展示 stop 按钮（因为 session state 是 running）
    await screen.findByLabelText('消息')
    expect(screen.getByRole('button', { name: '停止' })).toBeInTheDocument()

    // 点击停止按钮
    await user.click(screen.getByRole('button', { name: '停止' }))

    // 取消事件已经到达但 cancelRun IPC 尚未完成时，仍保持停止态，避免首条新消息
    // 与旧运行的收尾流程竞争。
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: '停止' })).toBeInTheDocument()
    })
    expect(
      screen.queryByRole('button', { name: '发送' }),
    ).not.toBeInTheDocument()

    releaseCancel.resolve()

    // Cancel 完成后：
    // - 停止按钮应切换为发送按钮
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: '发送' })).toBeInTheDocument()
    })
    // - indicator 应该隐藏
    expect(
      screen.queryByTestId('awaiting-response-indicator'),
    ).not.toBeInTheDocument()
  })

  it('renders user messages as plain text without Markdown parsing', async () => {
    const readyRuntime = createReadyRuntimeSnapshot({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      maskedValue: 'sk-t...7890',
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        getRuntimeSnapshot: vi.fn().mockResolvedValue(readyRuntime),
        refreshRuntime: vi.fn().mockResolvedValue(readyRuntime),
        saveRuntimeConfiguration: vi.fn().mockResolvedValue(readyRuntime),
        saveProvider: vi.fn().mockResolvedValue(readyRuntime),
        deleteProvider: vi.fn().mockResolvedValue(readyRuntime),
        cancelRuntimeConfigurationVerification: vi
          .fn()
          .mockResolvedValue(readyRuntime),
        listSessions: vi.fn().mockResolvedValue([
          createDefaultSessionSummary({
            sessionId: 'welcome',
            title: '新会话',
            updatedAt: '2026-07-08T00:00:00.000Z',
          }),
        ]),
        resumeSession: createResumeSessionFromApi(),
        setLastActiveSession: vi.fn().mockResolvedValue(null),
        createSession: vi.fn(),
        getTranscript: vi.fn().mockResolvedValue({
          sessionId: 'welcome',
          agentId: 'yuanxiao',
          entries: [
            {
              kind: 'user-message',
              index: 0,
              messageId: 'message-1',
              content: '# 这不是标题 **不是粗体**',
              createdAt: '2026-07-08T00:00:00.000Z',
            },
          ],
          updatedAt: '2026-07-08T00:00:02.000Z',
        }),
        sendMessage: vi.fn(),
        retryMessage: vi.fn().mockResolvedValue([]),
        forkSession: vi.fn().mockResolvedValue([]),
        cancelRun: vi.fn(),
        subscribeToAgentEvents: vi.fn(() => () => undefined),
        openExternalLink: vi.fn(),
        restoreFromBackup: vi.fn(),
        resetConfiguration: vi.fn(),
        listAgents: vi.fn().mockResolvedValue([
          {
            agentId: 'yuanxiao',
            displayName: '元宵',
            status: 'active' as const,
            defaultProviderId: null,
            defaultModelId: null,
            homePath: '~/.yuanxiao/agents/yuanxiao',
            archivedAt: null,
          },
        ]),
        updateAgentConfig: vi.fn(),
        getSessionModelInfo: vi.fn().mockResolvedValue({
          providerId: 'anthropic',
          modelId: 'claude-sonnet-4-5',
          displayName: 'Claude Sonnet 4.5',
          thinkingLevel: null,
          supportedThinkingLevels: [],
          supportsThinking: false,
        }),
        setSessionModel: vi.fn(),
        setSessionThinkingLevel: vi.fn(),
        archiveAgent: vi.fn(),
        recoverAgent: vi.fn(),
        archiveSession: vi.fn(),
        recoverSession: vi.fn(),
        deleteSession: vi.fn(),
        reconcileAgentDirectories: vi.fn(),
        claimAgentDirectory: vi.fn(),
        rebuildYuanxiaoHome: vi.fn(),
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
        getSkillInstallRecords: vi.fn(),
        sendNotification: vi.fn().mockResolvedValue(undefined),
      } satisfies DesktopPreloadApi,
    })
    render(<App />)

    // 用户消息纯文本 - 不应有 streamdown 属性
    expect(
      await screen.findByText('# 这不是标题 **不是粗体**'),
    ).toBeInTheDocument()
    const markdownElement = document.querySelector('[data-streamdown]')
    expect(markdownElement).toBeNull()
  })
})
