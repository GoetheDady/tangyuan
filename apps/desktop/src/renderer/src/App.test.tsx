import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  createDefaultSessionSummary,
  type DesktopPreloadApi,
  type RuntimeSnapshot
} from '@tangyuan/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import {
  createMissingConfigurationSnapshot,
  createReadyRuntimeSnapshot,
  installDefaultAppApi,
  resetAppTestEnvironment
} from './app.test-helpers'

describe('App', () => {
  afterEach(resetAppTestEnvironment)
  beforeEach(installDefaultAppApi)
  it('在 Agent 详情设置页展示 Agent 灵魂编辑入口', async () => {
    window.location.hash = '#/console/agents/tangyuan'

    render(<App />)

    expect(await screen.findByLabelText('Agent 灵魂')).toBeInTheDocument()
    expect(window.api.getSoul).toHaveBeenCalledWith({ agentId: 'tangyuan' })
  })
  it('renders the setup page when configuration is missing', async () => {
    render(<App />)

    expect(await screen.findByRole('heading', { name: '连接模型服务' })).toBeInTheDocument()
    expect(screen.getByText('首次配置')).toBeInTheDocument()
  })
  it('does not show chat controls while configuration is missing', async () => {
    render(<App />)

    expect(await screen.findByRole('heading', { name: '连接模型服务' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '新会话' })).not.toBeInTheDocument()
    expect(window.api.listSessions).not.toHaveBeenCalled()
  })
  it('启动时恢复最后打开的自定义 Agent 分叉会话', async () => {
    const readyRuntime = createReadyRuntimeSnapshot({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      maskedValue: 'sk-t...7890',
      profileInitialized: true
    })
    readyRuntime.agents.push({
      agentId: 'agent-2',
      displayName: '研究助手',
      status: 'active',
      defaultProviderId: 'anthropic',
      defaultModelId: 'claude-sonnet-4-5',
      homePath: '~/.tangyuan/agents/agent-2',
      archivedAt: null,
      directoryStatus: 'healthy'
    })
    const forkSession = {
      agentId: 'agent-2',
      sessionId: 'fork-session',
      title: '分叉会话',
      state: 'idle' as const,
      updatedAt: '2026-07-28T09:00:00.000Z',
      forkedFrom: { sessionId: 'parent-session', entryId: 'message-1' }
    }
    const parentSession = {
      agentId: 'agent-2',
      sessionId: 'parent-session',
      title: '父会话',
      state: 'idle' as const,
      updatedAt: '2026-07-28T08:00:00.000Z'
    }
    window.api.getRuntimeSnapshot = vi.fn().mockResolvedValue(readyRuntime)
    window.api.getLastActiveSession = vi.fn().mockResolvedValue({
      agentId: 'agent-2',
      sessionId: 'fork-session',
      updatedAt: '2026-07-28T10:00:00.000Z'
    })
    window.api.listSessions = vi.fn().mockResolvedValue([forkSession, parentSession])
    window.api.getTranscript = vi.fn().mockResolvedValue({
      agentId: 'agent-2',
      sessionId: 'fork-session',
      entries: [],
      updatedAt: '2026-07-28T10:00:00.000Z'
    })

    render(<App />)

    expect(await screen.findAllByText('分叉会话')).toHaveLength(2)
    await waitFor(() => {
      expect(window.location.hash).toBe('#/chat/agent-2/fork-session')
    })
    expect(window.api.listSessions).toHaveBeenCalledWith({ agentId: 'agent-2' })
    expect(window.api.getTranscript).toHaveBeenCalledWith({
      agentId: 'agent-2',
      sessionId: 'fork-session'
    })
    expect(screen.getByText('分叉自「父会话」')).toBeInTheDocument()
  })
  it('Runtime 判定无可恢复会话后不重新打开谱系不可用摘要', async () => {
    const readyRuntime = createReadyRuntimeSnapshot({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      maskedValue: 'sk-t...7890',
      profileInitialized: true
    })
    const unavailableSession = {
      ...createDefaultSessionSummary({
        sessionId: 'unavailable-session',
        title: '谱系不可用会话',
        updatedAt: '2026-07-28T09:00:00.000Z'
      }),
      forkedFrom: { sessionId: 'missing-parent', entryId: 'message-1' }
    }
    const newSession = createDefaultSessionSummary({
      sessionId: 'new-session',
      title: '新会话',
      updatedAt: '2026-07-28T10:00:00.000Z'
    })
    window.api.getRuntimeSnapshot = vi.fn().mockResolvedValue(readyRuntime)
    window.api.getLastActiveSession = vi.fn().mockResolvedValue(null)
    window.api.listSessions = vi.fn().mockResolvedValue([unavailableSession])
    window.api.createSession = vi.fn().mockResolvedValue(newSession)
    window.api.getTranscript = vi.fn(async ({ agentId, sessionId }) => ({
      agentId,
      sessionId,
      entries: [],
      updatedAt: '2026-07-28T10:00:00.000Z'
    }))

    render(<App />)

    expect(await screen.findAllByText('新会话')).toHaveLength(2)
    await waitFor(() => {
      expect(window.location.hash).toBe('#/chat/tangyuan/new-session')
    })
    expect(window.api.createSession).toHaveBeenCalledWith({
      agentId: 'tangyuan',
      title: '新会话'
    })
    expect(window.api.getTranscript).not.toHaveBeenCalledWith({
      agentId: 'tangyuan',
      sessionId: 'unavailable-session'
    })
  })
  it('切换 Agent 并选择会话时更新最后激活记录', async () => {
    const user = userEvent.setup()
    const readyRuntime = createReadyRuntimeSnapshot({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      maskedValue: 'sk-t...7890',
      profileInitialized: true
    })
    readyRuntime.agents.push({
      agentId: 'agent-2',
      displayName: '研究助手',
      status: 'active',
      defaultProviderId: 'anthropic',
      defaultModelId: 'claude-sonnet-4-5',
      homePath: '~/.tangyuan/agents/agent-2',
      archivedAt: null,
      directoryStatus: 'healthy'
    })
    const defaultSession = createDefaultSessionSummary({
      sessionId: 'default-session',
      title: '默认会话',
      updatedAt: '2026-07-28T09:00:00.000Z'
    })
    const agentSession = {
      ...createDefaultSessionSummary({
        sessionId: 'agent-session',
        title: '研究会话',
        updatedAt: '2026-07-28T10:00:00.000Z'
      }),
      agentId: 'agent-2'
    }
    window.api.getRuntimeSnapshot = vi.fn().mockResolvedValue(readyRuntime)
    window.api.getLastActiveSession = vi.fn().mockResolvedValue(null)
    window.api.listSessions = vi
      .fn()
      .mockResolvedValueOnce([defaultSession])
      .mockResolvedValue([agentSession])
    window.api.getTranscript = vi.fn().mockImplementation(async (request) => ({
      agentId: request.agentId,
      sessionId: request.sessionId,
      entries: [],
      updatedAt: '2026-07-28T10:00:00.000Z'
    }))

    render(<App />)

    await user.click(await screen.findByRole('button', { name: '切换到 Agent 研究助手' }))
    await user.click(await screen.findByRole('treeitem', { name: /研究会话/ }))

    await waitFor(() => {
      expect(window.api.setLastActiveSession).toHaveBeenCalledWith({
        agentId: 'agent-2',
        sessionId: 'agent-session'
      })
    })
    expect(window.api.listSessions).toHaveBeenCalledWith({ agentId: 'agent-2' })
  })
  it('聊天主界面的三栏背景从左到右逐级变浅', async () => {
    const readyRuntime = createReadyRuntimeSnapshot({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      maskedValue: 'sk-t...7890',
      profileInitialized: true
    })
    readyRuntime.agents.push({
      agentId: 'agent-2',
      displayName: '研究助手',
      status: 'active',
      defaultProviderId: 'anthropic',
      defaultModelId: 'claude-sonnet-4-5',
      homePath: '~/.tangyuan/agents/agent-2',
      archivedAt: null,
      directoryStatus: 'healthy'
    })
    window.api.getRuntimeSnapshot = vi.fn().mockResolvedValue(readyRuntime)

    render(<App />)

    expect(await screen.findByTestId('chat-agent-rail')).toHaveClass(
      'border-split',
      'bg-sidebar'
    )
    expect(screen.getByTestId('chat-session-pane')).toHaveClass('bg-background/50')
    expect(screen.getByTestId('chat-sidebar')).toHaveClass('border-split')
    expect(screen.getByTestId('chat-main')).toHaveClass('bg-background')
    expect(screen.getByRole('button', { name: '切换到 Agent 研究助手' })).toHaveClass(
      'border-border',
      'bg-card',
      'hover:bg-background'
    )
  })
  it('renders model options with unique keys across providers', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    window.api.getRuntimeSnapshot = vi.fn().mockResolvedValue(
      createMissingConfigurationSnapshot({
        providers: [
          { providerId: 'openai', displayName: 'OpenAI' },
          { providerId: 'openrouter', displayName: 'OpenRouter' }
        ],
        models: [
          {
            providerId: 'openai',
            modelId: 'gpt-4',
            displayName: 'GPT-4'
          },
          {
            providerId: 'openrouter',
            modelId: 'gpt-4',
            displayName: 'GPT-4 via OpenRouter'
          }
        ]
      })
    )

    try {
      render(<App />)

      await screen.findByText('连接模型服务')
      await waitFor(() => {
        expect(
          consoleError.mock.calls.some((call) =>
            call.some(
              (argument) =>
                typeof argument === 'string' &&
                argument.includes('Encountered two children with the same key')
            )
          )
        ).toBe(false)
      })
    } finally {
      consoleError.mockRestore()
    }
  })
  it('saves configuration through the preload API and masks the saved API key', async () => {
    const user = userEvent.setup()
    render(<App />)

    // 等待表单渲染完成
    const modelTrigger = await screen.findByTestId('setup-model-select')
    const apiKeyInput = (await screen.findByTestId('setup-api-key-input')) as HTMLInputElement

    await user.click(modelTrigger)
    await user.click(screen.getByRole('option', { name: 'Claude Sonnet 4.5' }))
    await user.type(apiKeyInput, 'sk-test-secret-7890')
    await user.click(screen.getByRole('button', { name: '验证并继续' }))

    expect(window.api.saveRuntimeConfiguration).toHaveBeenCalledWith({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890'
    })
    await waitFor(() => {
      expect(window.location.hash).toBe('#/chat/tangyuan')
    })
    expect(screen.queryByDisplayValue('sk-test-secret-7890')).not.toBeInTheDocument()
    expect(screen.queryByText('sk-t...7890')).not.toBeInTheDocument()
  })
  it('opens a bootstrap session immediately after saving configuration when profile is uninitialized', async () => {
    const user = userEvent.setup()
    window.api.listSessions = vi.fn().mockResolvedValue([])
    window.api.createSession = vi.fn().mockResolvedValue(
      createDefaultSessionSummary({
        sessionId: 'bootstrap-session',
        title: 'Bootstrap 初始化',
        updatedAt: '2026-07-08T00:00:00.000Z'
      })
    )
    render(<App />)

    const modelTrigger = await screen.findByTestId('setup-model-select')
    const apiKeyInput = (await screen.findByTestId('setup-api-key-input')) as HTMLInputElement

    await user.click(modelTrigger)
    await user.click(screen.getByRole('option', { name: 'Claude Sonnet 4.5' }))
    await user.type(apiKeyInput, 'sk-test-secret-7890')
    await user.click(screen.getByRole('button', { name: '验证并继续' }))

    expect(window.api.createSession).toHaveBeenCalledWith({
      agentId: 'tangyuan',
      title: 'Bootstrap 初始化'
    })
    await waitFor(() => {
      expect(window.location.hash).toBe('#/chat/tangyuan')
    })
  })
  it('allows users to cancel configuration verification', async () => {
    const user = userEvent.setup()
    window.api.saveRuntimeConfiguration = vi.fn(() => new Promise<RuntimeSnapshot>(() => undefined))
    render(<App />)

    const modelTrigger = await screen.findByTestId('setup-model-select')
    const apiKeyInput = (await screen.findByTestId('setup-api-key-input')) as HTMLInputElement

    await user.click(modelTrigger)
    await user.click(screen.getByRole('option', { name: 'Claude Sonnet 4.5' }))
    await user.type(apiKeyInput, 'sk-test-secret-7890')
    await user.click(screen.getByRole('button', { name: '验证并继续' }))
    await user.click(screen.getByText('取消验证'))

    expect(window.api.cancelRuntimeConfigurationVerification).toHaveBeenCalledWith({
      verificationId: 'current'
    })
  })
  it('does not expose a configuration entry after runtime is ready', async () => {
    const readyRuntime = createReadyRuntimeSnapshot({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      maskedValue: 'sk-t...7890',
      profileInitialized: true
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        getRuntimeSnapshot: vi.fn().mockResolvedValue(readyRuntime),
        refreshRuntime: vi.fn().mockResolvedValue(readyRuntime),
        saveRuntimeConfiguration: vi.fn().mockResolvedValue(readyRuntime),
        cancelRuntimeConfigurationVerification: vi.fn().mockResolvedValue(readyRuntime),
        listSessions: vi.fn().mockResolvedValue([]),
        getLastActiveSession: vi.fn().mockResolvedValue(null),
        setLastActiveSession: vi.fn().mockResolvedValue(null),
        createSession: vi.fn().mockResolvedValue(
          createDefaultSessionSummary({
            sessionId: 'auto-session',
            title: '新会话',
            updatedAt: '2026-07-08T00:00:00.000Z'
          })
        ),
        getTranscript: vi.fn().mockResolvedValue({
          sessionId: 'auto-session',
          agentId: 'tangyuan',
          entries: [],
          updatedAt: '2026-01-01T00:00:00.000Z'
        }),
        sendMessage: vi.fn().mockResolvedValue([]),
        retryMessage: vi.fn().mockResolvedValue([]),
        forkSession: vi.fn().mockResolvedValue([]),
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

    expect(await screen.findByRole('heading', { name: '汤圆' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '配置接口密钥' })).not.toBeInTheDocument()
    expect(screen.queryByText('sk-t...7890')).not.toBeInTheDocument()
    expect(window.api.createSession).toHaveBeenCalledWith({
      agentId: 'tangyuan',
      title: '新会话'
    })
  })
  it('opens a bootstrap session on startup when runtime is ready but profile is uninitialized', async () => {
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
        listSessions: vi.fn().mockResolvedValue([]),
        getLastActiveSession: vi.fn().mockResolvedValue(null),
        setLastActiveSession: vi.fn().mockResolvedValue(null),
        createSession: vi.fn().mockResolvedValue(
          createDefaultSessionSummary({
            sessionId: 'bootstrap-session',
            title: 'Bootstrap 初始化',
            updatedAt: '2026-07-08T00:00:00.000Z'
          })
        ),
        getTranscript: vi.fn().mockResolvedValue({
          sessionId: '',
          agentId: 'tangyuan',
          entries: [],
          updatedAt: '2026-01-01T00:00:00.000Z'
        }),
        sendMessage: vi.fn().mockResolvedValue([]),
        retryMessage: vi.fn().mockResolvedValue([]),
        forkSession: vi.fn().mockResolvedValue([]),
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

    expect(await screen.findAllByText('Bootstrap 初始化')).toHaveLength(2)
    expect(window.api.createSession).toHaveBeenCalledWith({
      agentId: 'tangyuan',
      title: 'Bootstrap 初始化'
    })
  })
  it('sends the first message through the preload API and renders the transcript', async () => {
    const user = userEvent.setup()
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
        getLastActiveSession: vi.fn().mockResolvedValue({
          agentId: 'tangyuan',
          sessionId: 'welcome',
          updatedAt: '2026-07-08T00:00:00.000Z'
        }),
        setLastActiveSession: vi.fn().mockResolvedValue(null),
        createSession: vi.fn(),
        getTranscript: vi.fn().mockResolvedValue({
          sessionId: '',
          agentId: 'tangyuan',
          entries: [],
          updatedAt: '2026-01-01T00:00:00.000Z'
        }),
        sendMessage: vi.fn().mockResolvedValue({
          sessionId: 'welcome',
          agentId: 'tangyuan',
          entries: [
            {
              kind: 'user-message',
              index: 0,
              messageId: 'message-1',
              content: '你好',
              createdAt: '2026-07-08T00:00:00.000Z'
            },
            {
              kind: 'agent-reply',
              index: 1,
              messageId: 'message-2',
              content: '收到：你好',
              createdAt: '2026-07-08T00:00:00.000Z',
              attempt: null,
              turns: [],
              inReplyTo: 'message-1'
            }
          ],
          updatedAt: '2026-07-08T00:00:01.000Z'
        }),
        retryMessage: vi.fn().mockResolvedValue([]),
        forkSession: vi.fn().mockResolvedValue([]),
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
    window.location.hash = '#/chat/tangyuan'
    render(<App />)

    await screen.findByText('大语言模型对话')
    await screen.findByLabelText('消息')
    await waitFor(
      () => {
        expect(screen.getByRole('button', { name: '发送' })).toBeInTheDocument()
      },
      { timeout: 3000 }
    )

    await user.type(screen.getByLabelText('消息'), '你好')
    await user.click(screen.getByRole('button', { name: '发送' }))

    expect(window.api.sendMessage).toHaveBeenCalledWith({
      agentId: 'tangyuan',
      sessionId: 'welcome',
      content: '你好'
    })
    await waitFor(
      () => {
        expect(screen.getByText('收到：你好')).toBeInTheDocument()
      },
      { timeout: 5000 }
    )
  })
})
