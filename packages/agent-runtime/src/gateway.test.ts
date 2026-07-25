import { describe, expect, it, vi } from 'vitest'

const createAgentSession = vi.fn()

vi.mock('@earendil-works/pi-coding-agent', () => ({
  AuthStorage: {
    inMemory: () => ({ setRuntimeApiKey: vi.fn() }),
  },
  ModelRegistry: {
    inMemory: () => ({ find: vi.fn(() => ({ id: 'model' })) }),
  },
  SessionManager: {
    create: vi.fn(() => ({ getSessionFile: () => '/tmp/session.json' })),
    open: vi.fn(() => ({ getSessionFile: () => '/tmp/session.json' })),
  },
  DefaultResourceLoader: class {
    async reload(): Promise<void> {}
  },
  createAgentSession,
}))

import type {
  PiSdkCreateSessionRequest,
  PiSdkOpenSessionRequest,
} from './pi-sdk-driver-contracts'
import { RealPiSdkGateway } from './gateway'

describe('RealPiSdkGateway profile tools', () => {
  it('在新建会话中注册共享用户画像工具并绑定受控回调', async () => {
    createAgentSession.mockResolvedValueOnce({
      session: {
        subscribe: () => () => undefined,
        prompt: vi.fn(async () => undefined),
        getLastAssistantText: () => null,
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
      sessionId: 'session-1',
      sdkSessionFile: '/tmp/session.json',
      cwd: '/tmp',
      agentSkillsPath: '/tmp/agent/skills',
      sharedSkillsPath: '/tmp/shared/skills',
      onUpdateSoul: vi.fn(),
      onUpdateUserProfile,
    }

    await new RealPiSdkGateway().createSession(request)

    const options = createAgentSession.mock.calls[0]?.[0] as {
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
        getLastAssistantText: () => null,
        abort: vi.fn(async () => undefined),
        dispose: vi.fn(),
      },
    })
    const request: PiSdkOpenSessionRequest = {
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test',
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
