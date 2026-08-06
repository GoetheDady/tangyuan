import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const createAgentSession = vi.fn()
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
  AuthStorage: {
    inMemory: () => ({ setRuntimeApiKey: vi.fn() }),
  },
  ModelRegistry: {
    inMemory: () => ({ find: vi.fn(() => ({ id: 'model' })) }),
  },
  SessionManager: {
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

import type {
  PiSdkCreateSessionRequest,
  PiSdkOpenSessionRequest,
} from '../driver'
import { RealPiSdkGateway } from './gateway'

describe('RealPiSdkGateway profile tools', () => {
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
          getLastAssistantText: () => '回复',
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
        getLastAssistantText: () => null,
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
        getLastAssistantText: () => null,
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

