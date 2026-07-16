import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  type AgentEventListener,
  type AgentMessage,
  createDefaultSessionSummary,
  createRuntimeSnapshot,
  type DesktopPreloadApi,
  type RuntimeSnapshot,
} from '@tangyuan/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

describe('App', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    window.location.hash = '#/'
  })

  beforeEach(() => {
    window.location.hash = '#/'
    const runtime = createMissingConfigurationSnapshot()
    const api: DesktopPreloadApi = {
      getRuntimeSnapshot: vi.fn().mockResolvedValue(runtime),
      refreshRuntime: vi.fn().mockResolvedValue(runtime),
      saveRuntimeConfiguration: vi.fn().mockResolvedValue(
        createReadyRuntimeSnapshot({
          providerId: 'anthropic',
          modelId: 'claude-sonnet-4-5',
          maskedValue: 'sk-t...7890',
        }),
      ),
      cancelRuntimeConfigurationVerification:
        vi.fn().mockResolvedValue(runtime),
      listSessions: vi.fn().mockResolvedValue([
        createDefaultSessionSummary({
          sessionId: 'welcome',
          title: '新会话',
          updatedAt: '2026-07-08T00:00:00.000Z',
        }),
      ]),
      createSession: vi.fn().mockResolvedValue(
        createDefaultSessionSummary({
          sessionId: 'session-1',
          title: '新会话',
          updatedAt: '2026-07-08T00:00:00.000Z',
        }),
      ),
      getMessages: vi.fn().mockResolvedValue([]),
      sendMessage: vi.fn().mockResolvedValue([
        {
          messageId: 'message-1',
          agentId: 'tangyuan',
          sessionId: 'welcome',
          role: 'user',
          content: '你好',
          createdAt: '2026-07-08T00:00:00.000Z',
        },
        {
          messageId: 'message-2',
          agentId: 'tangyuan',
          sessionId: 'welcome',
          role: 'agent',
          content: '收到：你好',
          createdAt: '2026-07-08T00:00:00.000Z',
        },
      ]),
      cancelRun: vi.fn().mockResolvedValue(
        createDefaultSessionSummary({
          sessionId: 'welcome',
          title: '新会话',
          updatedAt: '2026-07-08T00:00:00.000Z',
        }),
      ),
      subscribeToAgentEvents: vi.fn(() => () => undefined),
      openExternalLink: vi.fn(),
      restoreFromBackup: vi.fn(),
      resetConfiguration: vi.fn(),
    }

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: api,
    })
  })

  it('renders the setup page when configuration is missing', async () => {
    render(<App />)

    expect(
      await screen.findByRole('heading', { name: '配置模型服务' }),
    ).toBeInTheDocument()
    expect(screen.getByText('控制台')).toBeInTheDocument()
  })

  it('does not show chat controls while configuration is missing', async () => {
    render(<App />)

    expect(
      await screen.findByRole('heading', { name: '配置模型服务' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '新会话' }),
    ).not.toBeInTheDocument()
    expect(window.api.listSessions).not.toHaveBeenCalled()
  })

  it('renders model options with unique keys across providers', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    window.api.getRuntimeSnapshot = vi.fn().mockResolvedValue(
      createMissingConfigurationSnapshot({
        providers: [
          { providerId: 'openai', displayName: 'OpenAI' },
          { providerId: 'openrouter', displayName: 'OpenRouter' },
        ],
        models: [
          {
            providerId: 'openai',
            modelId: 'gpt-4',
            displayName: 'GPT-4',
          },
          {
            providerId: 'openrouter',
            modelId: 'gpt-4',
            displayName: 'GPT-4 via OpenRouter',
          },
        ],
      }),
    )

    try {
      render(<App />)

      await screen.findByText('配置模型服务')
      await waitFor(() => {
        expect(
          consoleError.mock.calls.some((call) =>
            call.some(
              (argument) =>
                typeof argument === 'string' &&
                argument.includes(
                  'Encountered two children with the same key',
                ),
            ),
          ),
        ).toBe(false)
      })
    } finally {
      consoleError.mockRestore()
    }
  })

  it('saves configuration through the preload API and masks the saved API key', async () => {
    const user = userEvent.setup()
    render(<App />)

    // 等待 Anthropic 卡片渲染完成
    const modelSelect = (await screen.findByLabelText('Model', {
      selector: '#model-anthropic',
    })) as HTMLSelectElement
    const apiKeyInput = screen.getByLabelText('API Key', {
      selector: '#api-key-anthropic',
    }) as HTMLInputElement

    await user.selectOptions(modelSelect, 'claude-sonnet-4-5')
    await user.type(apiKeyInput, 'sk-test-secret-7890')
    await user.click(screen.getByRole('button', { name: '验证并保存' }))

    expect(window.api.saveRuntimeConfiguration).toHaveBeenCalledWith({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    await waitFor(() => {
      expect(window.location.hash).toBe('#/chat/tangyuan')
    })
    expect(
      screen.queryByDisplayValue('sk-test-secret-7890'),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('sk-t...7890')).not.toBeInTheDocument()
  })

  it('opens a bootstrap session immediately after saving configuration when profile is uninitialized', async () => {
    const user = userEvent.setup()
    window.api.listSessions = vi.fn().mockResolvedValue([])
    window.api.createSession = vi.fn().mockResolvedValue(
      createDefaultSessionSummary({
        sessionId: 'bootstrap-session',
        title: 'Bootstrap 初始化',
        updatedAt: '2026-07-08T00:00:00.000Z',
      }),
    )
    render(<App />)

    const modelSelect = (await screen.findByLabelText('Model', {
      selector: '#model-anthropic',
    })) as HTMLSelectElement
    const apiKeyInput = screen.getByLabelText('API Key', {
      selector: '#api-key-anthropic',
    }) as HTMLInputElement

    await user.selectOptions(modelSelect, 'claude-sonnet-4-5')
    await user.type(apiKeyInput, 'sk-test-secret-7890')
    await user.click(screen.getByRole('button', { name: '验证并保存' }))

    expect(window.api.createSession).toHaveBeenCalledWith({
      agentId: 'tangyuan',
      title: 'Bootstrap 初始化',
    })
    await waitFor(() => {
      expect(window.location.hash).toBe('#/chat/tangyuan')
    })
  })

  it('allows users to cancel configuration verification', async () => {
    const user = userEvent.setup()
    window.api.saveRuntimeConfiguration = vi.fn(
      () => new Promise<RuntimeSnapshot>(() => undefined),
    )
    render(<App />)

    const modelSelect = (await screen.findByLabelText('Model', {
      selector: '#model-anthropic',
    })) as HTMLSelectElement
    const apiKeyInput = screen.getByLabelText('API Key', {
      selector: '#api-key-anthropic',
    }) as HTMLInputElement

    await user.selectOptions(modelSelect, 'claude-sonnet-4-5')
    await user.type(apiKeyInput, 'sk-test-secret-7890')
    await user.click(screen.getByRole('button', { name: '验证并保存' }))
    await user.click(screen.getByRole('button', { name: '取消验证' }))

    expect(
      window.api.cancelRuntimeConfigurationVerification,
    ).toHaveBeenCalledWith({
      verificationId: 'current',
    })
  })

  it('does not expose a configuration entry after runtime is ready', async () => {
    const readyRuntime = createReadyRuntimeSnapshot({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      maskedValue: 'sk-t...7890',
      profileInitialized: true,
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        getRuntimeSnapshot: vi.fn().mockResolvedValue(readyRuntime),
        refreshRuntime: vi.fn().mockResolvedValue(readyRuntime),
        saveRuntimeConfiguration: vi.fn().mockResolvedValue(readyRuntime),
        cancelRuntimeConfigurationVerification:
          vi.fn().mockResolvedValue(readyRuntime),
        listSessions: vi.fn().mockResolvedValue([]),
        createSession: vi.fn(),
        getMessages: vi.fn().mockResolvedValue([]),
        sendMessage: vi.fn().mockResolvedValue([]),
        cancelRun: vi.fn(),
        subscribeToAgentEvents: vi.fn(() => () => undefined),
        openExternalLink: vi.fn(),
        restoreFromBackup: vi.fn(),
        resetConfiguration: vi.fn(),
      } satisfies DesktopPreloadApi,
    })
    render(<App />)

    expect(
      await screen.findByRole('heading', { name: '汤圆' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '配置接口密钥' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('sk-t...7890')).not.toBeInTheDocument()
  })

  it('opens a bootstrap session on startup when runtime is ready but profile is uninitialized', async () => {
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
        cancelRuntimeConfigurationVerification:
          vi.fn().mockResolvedValue(readyRuntime),
        listSessions: vi.fn().mockResolvedValue([]),
        createSession: vi.fn().mockResolvedValue(
          createDefaultSessionSummary({
            sessionId: 'bootstrap-session',
            title: 'Bootstrap 初始化',
            updatedAt: '2026-07-08T00:00:00.000Z',
          }),
        ),
        getMessages: vi.fn().mockResolvedValue([]),
        sendMessage: vi.fn().mockResolvedValue([]),
        cancelRun: vi.fn(),
        subscribeToAgentEvents: vi.fn(() => () => undefined),
        openExternalLink: vi.fn(),
        restoreFromBackup: vi.fn(),
        resetConfiguration: vi.fn(),
      } satisfies DesktopPreloadApi,
    })
    render(<App />)

    expect(await screen.findAllByText('Bootstrap 初始化')).toHaveLength(2)
    expect(window.api.createSession).toHaveBeenCalledWith({
      agentId: 'tangyuan',
      title: 'Bootstrap 初始化',
    })
  })

  it('sends the first message through the preload API and renders the transcript', async () => {
    const user = userEvent.setup()
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
        cancelRuntimeConfigurationVerification:
          vi.fn().mockResolvedValue(readyRuntime),
        listSessions: vi.fn().mockResolvedValue([
          createDefaultSessionSummary({
            sessionId: 'welcome',
            title: '新会话',
            updatedAt: '2026-07-08T00:00:00.000Z',
          }),
        ]),
        createSession: vi.fn(),
        getMessages: vi.fn().mockResolvedValue([]),
        sendMessage: vi.fn().mockResolvedValue([
          {
            messageId: 'message-1',
            agentId: 'tangyuan',
            sessionId: 'welcome',
            role: 'user',
            content: '你好',
            createdAt: '2026-07-08T00:00:00.000Z',
          },
          {
            messageId: 'message-2',
            agentId: 'tangyuan',
            sessionId: 'welcome',
            role: 'agent',
            content: '收到：你好',
            createdAt: '2026-07-08T00:00:00.000Z',
          },
        ]),
        cancelRun: vi.fn(),
        subscribeToAgentEvents: vi.fn(() => () => undefined),
        openExternalLink: vi.fn(),
        restoreFromBackup: vi.fn(),
        resetConfiguration: vi.fn(),
      } satisfies DesktopPreloadApi,
    })
    window.location.hash = '#/chat/tangyuan'
    window.location.hash = '#/chat/tangyuan'
    render(<App />)

    await screen.findByText('大语言模型对话')
    await screen.findByLabelText('消息')
    await waitFor(
      () => {
        expect(
          screen.getByRole('button', { name: '发送' }),
        ).toBeInTheDocument()
      },
      { timeout: 3000 },
    )

    await user.type(screen.getByLabelText('消息'), '你好')
    await user.click(screen.getByRole('button', { name: '发送' }))

    expect(window.api.sendMessage).toHaveBeenCalledWith({
      agentId: 'tangyuan',
      sessionId: 'welcome',
      content: '你好',
    })
    await waitFor(
      () => {
        expect(screen.getByText('收到：你好')).toBeInTheDocument()
      },
      { timeout: 5000 },
    )
  })

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
        cancelRuntimeConfigurationVerification:
          vi.fn().mockResolvedValue(readyRuntime),
        listSessions: vi.fn().mockResolvedValue([
          createDefaultSessionSummary({
            sessionId: 'welcome',
            title: '新会话',
            updatedAt: '2026-07-08T00:00:00.000Z',
          }),
        ]),
        createSession: vi.fn(),
        getMessages: vi.fn().mockResolvedValue([]),
        sendMessage: vi.fn(async () => {
          for (const listener of listeners) {
            listener({
              type: 'turn-started',
              agentId: 'tangyuan',
              sessionId: 'welcome',
              runId: 'run-1',
              occurredAt: '2026-07-08T00:00:01.000Z',
            })
            listener({
              type: 'message-delta',
              agentId: 'tangyuan',
              sessionId: 'welcome',
              runId: 'run-1',
              messageId: 'agent-message-1',
              delta: '你',
              occurredAt: '2026-07-08T00:00:02.000Z',
            })
            listener({
              type: 'message-delta',
              agentId: 'tangyuan',
              sessionId: 'welcome',
              runId: 'run-1',
              messageId: 'agent-message-1',
              delta: '好',
              occurredAt: '2026-07-08T00:00:03.000Z',
            })
          }

          await releaseSend.promise

          return [
            {
              messageId: 'agent-message-1',
              agentId: 'tangyuan',
              sessionId: 'welcome',
              role: 'agent',
              content: '你好',
              createdAt: '2026-07-08T00:00:02.000Z',
            },
          ] satisfies AgentMessage[]
        }),
        cancelRun: vi.fn(),
        subscribeToAgentEvents: vi.fn(
          (listener: AgentEventListener) => {
            listeners.push(listener)

            return () => undefined
          },
        ),
        openExternalLink: vi.fn(),
        restoreFromBackup: vi.fn(),
        resetConfiguration: vi.fn(),
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
        cancelRuntimeConfigurationVerification:
          vi.fn().mockResolvedValue(readyRuntime),
        listSessions: vi.fn().mockResolvedValue([
          createDefaultSessionSummary({
            sessionId: 'welcome',
            title: '新会话',
            updatedAt: '2026-07-08T00:00:00.000Z',
          }),
        ]),
        createSession: vi.fn(),
        getMessages: vi.fn().mockResolvedValue([
          {
            messageId: 'message-1',
            agentId: 'tangyuan',
            sessionId: 'welcome',
            role: 'user',
            content: '你好',
            createdAt: '2026-07-08T00:00:00.000Z',
          },
          {
            messageId: 'message-2',
            agentId: 'tangyuan',
            sessionId: 'welcome',
            role: 'system',
            content: '正在调用工具',
            createdAt: '2026-07-08T00:00:01.000Z',
          },
          {
            messageId: 'message-3',
            agentId: 'tangyuan',
            sessionId: 'welcome',
            role: 'agent',
            content: '你好呀',
            createdAt: '2026-07-08T00:00:02.000Z',
          },
        ] satisfies AgentMessage[]),
        sendMessage: vi.fn(),
        cancelRun: vi.fn(),
        subscribeToAgentEvents: vi.fn(() => () => undefined),
        openExternalLink: vi.fn(),
        restoreFromBackup: vi.fn(),
        resetConfiguration: vi.fn(),
      } satisfies DesktopPreloadApi,
    })
    render(<App />)

    expect(await screen.findByText('你好')).toBeInTheDocument()
    expect(screen.getByText('你好呀')).toBeInTheDocument()
    expect(screen.queryByText('正在调用工具')).not.toBeInTheDocument()
  })
})

/**
 * 创建 Renderer 测试使用的缺配置运行时快照。
 *
 * @returns 一个默认 Agent 下缺少 Provider、Model 和 API Key 的 RuntimeSnapshot。
 * @throws 此测试辅助方法不会主动抛出错误。
 */
function createMissingConfigurationSnapshot(
  resources: Pick<RuntimeSnapshot, 'providers' | 'models'> = {
    providers: [{ providerId: 'anthropic', displayName: 'Anthropic' }],
    models: [
      {
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        displayName: 'Claude Sonnet 4.5',
      },
    ],
  },
): RuntimeSnapshot {
  return createRuntimeSnapshot({
    activeAgent: {
      agentId: 'tangyuan',
      displayName: '汤圆',
      homePath: '~/.tangyuan/agents/tangyuan',
      profile: {
        initialized: false,
        bootstrapRequired: true,
        soulUpdatedAt: null,
        userUpdatedAt: null,
      },
    },
    providers: resources.providers,
    models: resources.models,
    settings: {
      selectedProviderId: null,
      selectedModelId: null,
    },
    configuredProviders: {},
    auth: {
      apiKey: {
        configured: false,
        maskedValue: null,
      },
    },
  })
}

/**
 * 创建 Renderer 测试使用的已就绪运行时快照。
 *
 * @param input - 已保存的 Provider、Model 和 API Key 脱敏值。
 * @returns 一个默认 Agent 下配置完整的 RuntimeSnapshot。
 * @throws 此测试辅助方法不会主动抛出错误。
 */
function createReadyRuntimeSnapshot(input: {
  providerId: string
  modelId: string
  maskedValue: string
  profileInitialized?: boolean
}): RuntimeSnapshot {
  return createRuntimeSnapshot({
    activeAgent: {
      agentId: 'tangyuan',
      displayName: '汤圆',
      homePath: '~/.tangyuan/agents/tangyuan',
      profile: {
        initialized: input.profileInitialized ?? false,
        bootstrapRequired: !(input.profileInitialized ?? false),
        soulUpdatedAt: null,
        userUpdatedAt: null,
      },
    },
    providers: [
      { providerId: input.providerId, displayName: 'Anthropic' },
    ],
    models: [
      {
        providerId: input.providerId,
        modelId: input.modelId,
        displayName: 'Claude Sonnet 4.5',
      },
    ],
    settings: {
      selectedProviderId: input.providerId,
      selectedModelId: input.modelId,
    },
    configuredProviders: {
      [input.providerId]: {
        configured: true,
        maskedValue: input.maskedValue,
      },
    },
    auth: {
      apiKey: {
        configured: true,
        maskedValue: input.maskedValue,
      },
    },
  })
}

/**
 * 创建可手动 resolve 的 Promise，用于控制 Renderer 测试里的异步发送。
 *
 * @returns Promise 和对应 resolve 函数。
 * @throws 此测试辅助方法不会主动抛出错误。
 */
function createDeferred<T>(): {
  promise: Promise<T>
  resolve(value?: T): void
} {
  let resolve!: (value?: T) => void
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve as (value?: T) => void
  })

  return { promise, resolve }
}
