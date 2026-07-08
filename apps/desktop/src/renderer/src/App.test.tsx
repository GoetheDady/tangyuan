import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  createDefaultSessionSummary,
  createRuntimeSnapshot,
  type DesktopPreloadApi,
  type RuntimeSnapshot
} from '@tangyuan/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

describe('App', () => {
  beforeEach(() => {
    const runtime = createMissingConfigurationSnapshot()
    const api: DesktopPreloadApi = {
      getRuntimeSnapshot: vi.fn().mockResolvedValue(runtime),
      refreshRuntime: vi.fn().mockResolvedValue(runtime),
      saveRuntimeConfiguration: vi.fn().mockResolvedValue(
        createReadyRuntimeSnapshot({
          providerId: 'anthropic',
          modelId: 'claude-sonnet-4-5',
          maskedValue: 'sk-t...7890'
        })
      ),
      cancelRuntimeConfigurationVerification: vi.fn().mockResolvedValue(runtime),
      listSessions: vi.fn().mockResolvedValue([
        createDefaultSessionSummary({
          sessionId: 'welcome',
          title: '新会话',
          updatedAt: '2026-07-08T00:00:00.000Z'
        })
      ]),
      createSession: vi.fn().mockResolvedValue(
        createDefaultSessionSummary({
          sessionId: 'session-1',
          title: '新会话',
          updatedAt: '2026-07-08T00:00:00.000Z'
        })
      ),
      getMessages: vi.fn().mockResolvedValue([]),
      sendMessage: vi.fn().mockResolvedValue([
        {
          messageId: 'message-1',
          agentId: 'tangyuan',
          sessionId: 'welcome',
          role: 'user',
          content: '你好',
          createdAt: '2026-07-08T00:00:00.000Z'
        },
        {
          messageId: 'message-2',
          agentId: 'tangyuan',
          sessionId: 'welcome',
          role: 'agent',
          content: '收到：你好',
          createdAt: '2026-07-08T00:00:00.000Z'
        }
      ]),
      cancelRun: vi.fn().mockResolvedValue(
        createDefaultSessionSummary({
          sessionId: 'welcome',
          title: '新会话',
          updatedAt: '2026-07-08T00:00:00.000Z'
        })
      )
    }

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: api
    })
  })

  it('renders the minimum desktop workbench shell', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: '汤圆' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '配置模型服务' })).toBeInTheDocument()
  })

  it('loads runtime and session data through the preload API', async () => {
    render(<App />)

    expect(await screen.findAllByText('缺少配置')).toHaveLength(2)
    expect(screen.getByText('未保存')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '新会话' })).not.toBeInTheDocument()
  })

  it('saves configuration through the preload API and masks the saved API key', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.type(await screen.findByLabelText('Provider'), 'anthropic')
    await user.type(screen.getByLabelText('Model'), 'claude-sonnet-4-5')
    await user.type(screen.getByLabelText('API Key'), 'sk-test-secret-7890')
    await user.click(screen.getByRole('button', { name: '验证并保存' }))

    expect(window.api.saveRuntimeConfiguration).toHaveBeenCalledWith({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890'
    })
    expect(await screen.findByText('sk-t...7890')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('sk-test-secret-7890')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '新会话' })).toBeInTheDocument()
  })

  it('allows users to cancel configuration verification', async () => {
    const user = userEvent.setup()
    window.api.saveRuntimeConfiguration = vi.fn(() => new Promise<RuntimeSnapshot>(() => undefined))
    render(<App />)

    await user.type(await screen.findByLabelText('Provider'), 'anthropic')
    await user.type(screen.getByLabelText('Model'), 'claude-sonnet-4-5')
    await user.type(screen.getByLabelText('API Key'), 'sk-test-secret-7890')
    await user.click(screen.getByRole('button', { name: '验证并保存' }))
    await user.click(screen.getByRole('button', { name: '取消验证' }))

    expect(window.api.cancelRuntimeConfigurationVerification).toHaveBeenCalledWith({
      verificationId: 'current'
    })
  })

  it('lets a ready user reopen the configuration screen without exposing the saved API key', async () => {
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
        listSessions: vi.fn().mockResolvedValue([]),
        createSession: vi.fn(),
        getMessages: vi.fn().mockResolvedValue([]),
        sendMessage: vi.fn().mockResolvedValue([]),
        cancelRun: vi.fn()
      } satisfies DesktopPreloadApi
    })
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '配置接口密钥' }))

    expect(screen.getByRole('heading', { name: '配置模型服务' })).toBeInTheDocument()
    expect(screen.getByText('sk-t...7890')).toBeInTheDocument()
    expect(screen.getByLabelText('API Key')).toHaveValue('')
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
        createSession: vi.fn(),
        getMessages: vi.fn().mockResolvedValue([]),
        sendMessage: vi.fn().mockResolvedValue([
          {
            messageId: 'message-1',
            agentId: 'tangyuan',
            sessionId: 'welcome',
            role: 'user',
            content: '你好',
            createdAt: '2026-07-08T00:00:00.000Z'
          },
          {
            messageId: 'message-2',
            agentId: 'tangyuan',
            sessionId: 'welcome',
            role: 'agent',
            content: '收到：你好',
            createdAt: '2026-07-08T00:00:00.000Z'
          }
        ]),
        cancelRun: vi.fn()
      } satisfies DesktopPreloadApi
    })
    render(<App />)

    await user.type(await screen.findByLabelText('消息'), '你好')
    await user.click(screen.getByRole('button', { name: '发送' }))

    expect(window.api.sendMessage).toHaveBeenCalledWith({
      agentId: 'tangyuan',
      sessionId: 'welcome',
      content: '你好'
    })
    expect(await screen.findByText('收到：你好')).toBeInTheDocument()
  })
})

/**
 * 创建 Renderer 测试使用的缺配置运行时快照。
 *
 * @returns 一个默认 Agent 下缺少 Provider、Model 和 API Key 的 RuntimeSnapshot。
 * @throws 此测试辅助方法不会主动抛出错误。
 */
function createMissingConfigurationSnapshot(): RuntimeSnapshot {
  return createRuntimeSnapshot({
    activeAgent: {
      agentId: 'tangyuan',
      displayName: '汤圆',
      homePath: '~/.tangyuan/agents/tangyuan',
      profile: {
        initialized: false,
        bootstrapRequired: true,
        soulUpdatedAt: null,
        userUpdatedAt: null
      }
    },
    providers: [],
    models: [],
    settings: {
      selectedProviderId: null,
      selectedModelId: null
    },
    auth: {
      apiKey: {
        configured: false,
        maskedValue: null
      }
    }
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
}): RuntimeSnapshot {
  return createRuntimeSnapshot({
    activeAgent: {
      agentId: 'tangyuan',
      displayName: '汤圆',
      homePath: '~/.tangyuan/agents/tangyuan',
      profile: {
        initialized: false,
        bootstrapRequired: true,
        soulUpdatedAt: null,
        userUpdatedAt: null
      }
    },
    providers: [{ providerId: input.providerId, displayName: 'Anthropic' }],
    models: [
      {
        providerId: input.providerId,
        modelId: input.modelId,
        displayName: 'Claude Sonnet 4.5'
      }
    ],
    settings: {
      selectedProviderId: input.providerId,
      selectedModelId: input.modelId
    },
    auth: {
      apiKey: {
        configured: true,
        maskedValue: input.maskedValue
      }
    }
  })
}
