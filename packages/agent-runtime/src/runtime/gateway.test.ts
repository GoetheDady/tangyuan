import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const createAgentSession = vi.fn()
const createModelRuntime = vi.fn()
const InMemoryCredentialStore = vi.fn(function InMemoryCredentialStore() {})
let sessionFileSequence = 0
const createReadToolDefinition = vi.fn((_cwd: string) => ({
  name: 'read',
  label: 'read',
  description: 'Read file',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
  },
  async execute() {
    return { content: [{ type: 'text', text: 'content' }], details: undefined }
  },
}))

vi.mock('@earendil-works/pi-coding-agent', () => ({
  ModelRuntime: {
    create: createModelRuntime,
  },
  SessionManager: {
    inMemory: vi.fn(() => ({})),
    create: vi.fn(
      (_cwd: string, sessionDir: string, options?: { id?: string }) => {
        const sessionId = options?.id ?? 'session'
        const sessionFile = join(
          sessionDir,
          `gateway-test-${process.pid}-${sessionFileSequence++}-${sessionId}.jsonl`,
        )
        return {
          getSessionFile: () => sessionFile,
          getHeader: () => ({
            type: 'session',
            version: 3,
            id: sessionId,
            timestamp: '2026-01-01T00:00:00.000Z',
            cwd: _cwd,
          }),
        }
      },
    ),
    open: vi.fn((sessionFile: string) => ({
      getSessionFile: () => sessionFile,
    })),
  },
  SettingsManager: {
    inMemory: () => ({}),
  },
  DefaultResourceLoader: class {
    async reload(): Promise<void> {}
  },
  createAgentSession,
  createReadToolDefinition,
}))

vi.mock('@earendil-works/pi-ai', () => ({
  InMemoryCredentialStore,
}))

createModelRuntime.mockImplementation(async () => ({
  setRuntimeApiKey: vi.fn(async () => undefined),
  getModel: vi.fn(() => ({
    id: 'model',
    provider: 'anthropic',
    name: 'Model',
  })),
  getModels: vi.fn(() => []),
  getProviders: vi.fn(() => []),
}))

import type {
  PiSdkCreateSessionRequest,
  PiSdkOpenSessionRequest,
} from '../driver'
import { RealPiSdkGateway } from './gateway'

describe('RealPiSdkGateway profile tools', () => {
  it('从隔离 ModelRuntime 投影 Provider 与去重后的模型列表', async () => {
    createModelRuntime.mockResolvedValueOnce({
      getProviders: () => [
        { id: 'openai', name: 'OpenAI' },
        { id: 'anthropic', name: 'Anthropic' },
      ],
      getModels: () => [
        { provider: 'openai', id: 'gpt-5', name: 'GPT-5' },
        { provider: 'anthropic', id: 'claude', name: 'Claude' },
        { provider: 'openai', id: 'gpt-5', name: 'GPT-5 duplicate' },
      ],
    })

    await expect(
      new RealPiSdkGateway().listProvidersAndModels(),
    ).resolves.toEqual({
      providers: [
        { providerId: 'anthropic', displayName: 'Anthropic' },
        { providerId: 'openai', displayName: 'OpenAI' },
      ],
      models: [
        {
          providerId: 'openai',
          modelId: 'gpt-5',
          displayName: 'GPT-5',
        },
        {
          providerId: 'anthropic',
          modelId: 'claude',
          displayName: 'Claude',
        },
      ],
    })
    expect(createModelRuntime).toHaveBeenCalledWith({
      credentials: expect.any(InMemoryCredentialStore),
      modelsPath: null,
      allowModelNetwork: false,
    })
  })

  it('验证配置时使用无工具内存会话并在结束后释放资源', async () => {
    const runtime = {
      setRuntimeApiKey: vi.fn(async () => undefined),
      getModel: vi.fn(() => ({ id: 'model', provider: 'anthropic' })),
    }
    createModelRuntime.mockResolvedValueOnce(runtime)
    const prompt = vi.fn(async () => undefined)
    const dispose = vi.fn()
    createAgentSession.mockResolvedValueOnce({
      session: {
        prompt,
        abort: vi.fn(async () => undefined),
        dispose,
      },
    })
    const controller = new AbortController()

    await new RealPiSdkGateway().verifyConfiguration({
      providerId: 'anthropic',
      modelId: 'model',
      apiKey: 'sk-test',
      prompt: 'Reply with OK.',
      signal: controller.signal,
    })

    expect(prompt).toHaveBeenCalledWith('Reply with OK.')
    expect(createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        modelRuntime: runtime,
        noTools: 'all',
      }),
    )
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('运行中取消验证时即使 SDK prompt 正常结束也抛出 AbortError', async () => {
    createModelRuntime.mockResolvedValueOnce({
      setRuntimeApiKey: vi.fn(async () => undefined),
      getModel: vi.fn(() => ({ id: 'model', provider: 'anthropic' })),
    })
    const controller = new AbortController()
    const abort = vi.fn(async () => undefined)
    const dispose = vi.fn()
    createAgentSession.mockResolvedValueOnce({
      session: {
        prompt: vi.fn(async () => {
          controller.abort()
        }),
        abort,
        dispose,
      },
    })

    await expect(
      new RealPiSdkGateway().verifyConfiguration({
        providerId: 'anthropic',
        modelId: 'model',
        apiKey: 'sk-test',
        prompt: 'Reply with OK.',
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(abort).toHaveBeenCalledOnce()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('使用 ModelRuntime 和 text_delta 事件完成单轮补全', async () => {
    const model = { id: 'model', provider: 'anthropic', name: 'Model' }
    const runtime = {
      setRuntimeApiKey: vi.fn(async () => undefined),
      getModel: vi.fn(() => model),
    }
    createModelRuntime.mockResolvedValueOnce(runtime)
    const listener = vi.fn()
    createAgentSession.mockResolvedValueOnce({
      session: {
        subscribe: (nextListener: (event: unknown) => void) => {
          listener.mockImplementation(nextListener)
          return () => undefined
        },
        prompt: vi.fn(async () => {
          listener({
            type: 'message_update',
            assistantMessageEvent: { type: 'text_delta', delta: '来自 ' },
          })
          listener({
            type: 'message_update',
            assistantMessageEvent: { type: 'text_delta', delta: '事件' },
          })
        }),
        abort: vi.fn(async () => undefined),
        dispose: vi.fn(),
      },
    })

    const result = await new RealPiSdkGateway().singleTurnCompletion({
      providerId: 'anthropic',
      modelId: 'model',
      apiKey: 'sk-test',
      prompt: '返回文本',
    })

    expect(result).toBe('来自 事件')
    expect(runtime.setRuntimeApiKey).toHaveBeenCalledWith(
      'anthropic',
      'sk-test',
      { allowNetwork: false },
    )
    expect(createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({ modelRuntime: runtime, noTools: 'all' }),
    )
  })

  it('会话 prompt 只返回最后一个 SDK 回合的文本', async () => {
    createModelRuntime.mockResolvedValueOnce({
      setRuntimeApiKey: vi.fn(async () => undefined),
      getModel: vi.fn(() => ({ id: 'model', provider: 'anthropic' })),
    })
    let listener: ((event: unknown) => void) | undefined
    createAgentSession.mockResolvedValueOnce({
      session: {
        subscribe: (nextListener: (event: unknown) => void) => {
          listener = nextListener
          return () => undefined
        },
        prompt: vi.fn(async () => {
          listener?.({ type: 'turn_start' })
          listener?.({
            type: 'message_update',
            assistantMessageEvent: { type: 'text_delta', delta: '中间说明' },
          })
          listener?.({ type: 'turn_start' })
          listener?.({
            type: 'message_update',
            assistantMessageEvent: { type: 'text_delta', delta: '最终回答' },
          })
        }),
        abort: vi.fn(async () => undefined),
        dispose: vi.fn(),
      },
    })
    const handle = await new RealPiSdkGateway().createSession({
      providerId: 'anthropic',
      modelId: 'model',
      apiKey: 'sk-test',
      agentId: 'yuanxiao',
      sessionId: 'session-last-turn',
      sdkSessionFile: '/tmp/session-last-turn.jsonl',
      cwd: '/tmp',
      agentSkillsPath: '/tmp/agent/skills',
      sharedSkillsPath: '/tmp/shared/skills',
      onUpdateSoul: vi.fn(),
      onUpdateUserProfile: vi.fn(),
    })

    await expect(handle.prompt('继续')).resolves.toBe('最终回答')
  })

  it('会话 handle 暴露完整的 Pi 会话控制能力', async () => {
    let currentModel = {
      id: 'model',
      provider: 'anthropic',
      name: 'Model',
    }
    const runtime = {
      setRuntimeApiKey: vi.fn(async () => undefined),
      getModel: vi.fn((providerId: string, modelId: string) => ({
        id: modelId,
        provider: providerId,
        name: `${providerId}/${modelId}`,
      })),
    }
    createModelRuntime.mockResolvedValueOnce(runtime)
    let listener: ((event: unknown) => void) | undefined
    const abort = vi.fn(async () => undefined)
    const dispose = vi.fn()
    const setModel = vi.fn(async (model) => {
      currentModel = model
    })
    const setThinkingLevel = vi.fn()
    const reload = vi.fn(async () => undefined)
    createAgentSession.mockResolvedValueOnce({
      session: {
        subscribe: (nextListener: (event: unknown) => void) => {
          listener = nextListener
          return () => undefined
        },
        prompt: vi.fn(async () => {
          listener?.({
            type: 'message_update',
            assistantMessageEvent: { type: 'text_delta', delta: '已完成' },
          })
        }),
        abort,
        dispose,
        setModel,
        setThinkingLevel,
        get model() {
          return currentModel
        },
        thinkingLevel: 'medium',
        supportsThinking: () => true,
        getAvailableThinkingLevels: () => ['off', 'low', 'medium'],
        reload,
      },
    })
    const request: PiSdkCreateSessionRequest = {
      providerId: 'anthropic',
      modelId: 'model',
      apiKey: 'sk-test',
      agentId: 'yuanxiao',
      sessionId: 'session-handle',
      sdkSessionFile: '/tmp/session.jsonl',
      cwd: '/tmp',
      agentSkillsPath: '/tmp/agent/skills',
      sharedSkillsPath: '/tmp/shared/skills',
      onUpdateSoul: vi.fn(),
      onUpdateUserProfile: vi.fn(),
    }
    const handle = await new RealPiSdkGateway().createSession(request)

    await expect(handle.prompt('你好')).resolves.toBe('已完成')
    await handle.setModel('openai', 'gpt-5', 'sk-openai')
    await handle.setThinkingLevel('low')
    handle.setSystemPromptContext('新的身份上下文')
    await handle.reload()
    await handle.abort()
    handle.dispose()

    expect(setModel).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'openai', id: 'gpt-5' }),
    )
    expect(setThinkingLevel).toHaveBeenCalledWith('low')
    await expect(handle.getModelInfo()).resolves.toEqual({
      providerId: 'openai',
      modelId: 'gpt-5',
      displayName: 'openai/gpt-5',
      thinkingLevel: 'medium',
      supportedThinkingLevels: ['off', 'low', 'medium'],
      supportsThinking: true,
    })
    expect(reload).toHaveBeenCalledOnce()
    expect(abort).toHaveBeenCalledOnce()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it.each([
    { name: 'Error', thrownValue: new Error('renderer event failed') },
    { name: 'falsy 值', thrownValue: undefined },
  ])(
    '事件监听器抛出 $name 时仍在持久化完成后继续抛出',
    async ({ thrownValue }) => {
      let listener: ((event: unknown) => void) | undefined
      let persisted = false
      createAgentSession.mockResolvedValueOnce({
        session: {
          subscribe: (nextListener: (event: unknown) => void) => {
            listener = nextListener
            return () => undefined
          },
          prompt: vi.fn(async () => {
            listener?.({
              type: 'message_update',
              assistantMessageEvent: { type: 'text_delta', delta: '回复' },
            })
            persisted = true
          }),
          abort: vi.fn(async () => undefined),
          dispose: vi.fn(),
        },
      })
      const request: PiSdkCreateSessionRequest = {
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        apiKey: 'sk-test',
        agentId: 'yuanxiao',
        sessionId: 'session-listener-error',
        sdkSessionFile: '/tmp/session.json',
        cwd: '/tmp',
        agentSkillsPath: '/tmp/agent/skills',
        sharedSkillsPath: '/tmp/shared/skills',
        onUpdateSoul: vi.fn(),
        onUpdateUserProfile: vi.fn(),
      }
      const handle = await new RealPiSdkGateway().createSession(request)

      await expect(
        handle.prompt('你好', {
          onEvent: () => {
            throw thrownValue
          },
        }),
      ).rejects.toBe(thrownValue)
      expect(persisted).toBe(true)
    },
  )

  it('创建会话时传入 SettingsManager.inMemory() 以隔离外部 Pi 配置', async () => {
    createAgentSession.mockResolvedValueOnce({
      session: {
        subscribe: () => () => undefined,
        prompt: vi.fn(async () => undefined),
        abort: vi.fn(async () => undefined),
        dispose: vi.fn(),
      },
    })
    const request: PiSdkCreateSessionRequest = {
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test',
      agentId: 'yuanxiao',
      sessionId: 'session-settings',
      sdkSessionFile: '/tmp/session.json',
      cwd: '/tmp',
      agentSkillsPath: '/tmp/agent/skills',
      sharedSkillsPath: '/tmp/shared/skills',
      onUpdateSoul: vi.fn(),
      onUpdateUserProfile: vi.fn(),
    }

    await new RealPiSdkGateway().createSession(request)

    const options = createAgentSession.mock.calls[0]?.[0] as {
      settingsManager: unknown
    }
    expect(options.settingsManager).toBeDefined()
  })

  it('在新建会话中注册共享用户画像工具并绑定受控回调', async () => {
    createAgentSession.mockResolvedValueOnce({
      session: {
        subscribe: () => () => undefined,
        prompt: vi.fn(async () => undefined),
        abort: vi.fn(async () => undefined),
        dispose: vi.fn(),
      },
    })
    const onUpdateUserProfile = vi.fn().mockResolvedValue({
      target: 'user',
      status: 'updated',
      version: 'sha256:new',
    })
    const request: PiSdkCreateSessionRequest = {
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test',
      agentId: 'yuanxiao',
      sessionId: 'session-1',
      sdkSessionFile: '/tmp/session.json',
      cwd: '/tmp',
      agentSkillsPath: '/tmp/agent/skills',
      sharedSkillsPath: '/tmp/shared/skills',
      onUpdateSoul: vi.fn(),
      onUpdateUserProfile,
    }

    await new RealPiSdkGateway().createSession(request)

    const options = createAgentSession.mock.calls.at(-1)?.[0] as {
      customTools: Array<{
        name: string
        parameters: unknown
        execute: (
          toolCallId: string,
          params: { content: string },
        ) => Promise<unknown>
      }>
    }
    const profileTool = options.customTools.find(
      (tool) => tool.name === 'update_user_profile',
    )

    expect(profileTool).toBeDefined()
    expect(profileTool?.parameters).toEqual({
      type: 'object',
      properties: { content: { type: 'string', minLength: 1 } },
      required: ['content'],
      additionalProperties: false,
    })
    await profileTool?.execute('call-1', { content: '完整用户画像' })
    expect(onUpdateUserProfile).toHaveBeenCalledWith('完整用户画像')
  })

  it('在打开历史会话时也注册共享用户画像工具', async () => {
    createAgentSession.mockResolvedValueOnce({
      session: {
        subscribe: () => () => undefined,
        prompt: vi.fn(async () => undefined),
        abort: vi.fn(async () => undefined),
        dispose: vi.fn(),
      },
    })
    const request: PiSdkOpenSessionRequest = {
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test',
      agentId: 'yuanxiao',
      sessionId: 'session-2',
      sdkSessionFile: '/tmp/session.json',
      cwd: '/tmp',
      agentSkillsPath: '/tmp/agent/skills',
      sharedSkillsPath: '/tmp/shared/skills',
      onUpdateSoul: vi.fn(),
      onUpdateUserProfile: vi.fn(),
    }

    await new RealPiSdkGateway().openSession(request)

    const options = createAgentSession.mock.calls.at(-1)?.[0] as {
      customTools: Array<{ name: string }>
    }
    expect(options.customTools.map((tool) => tool.name)).toContain(
      'update_user_profile',
    )
  })
})
