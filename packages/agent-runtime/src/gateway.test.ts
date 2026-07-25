import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
      agentId: 'tangyuan',
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
      agentId: 'tangyuan',
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

describe('RealPiSdkGateway write/edit path protection', () => {
  const mockToolApprovalGateway = {
    requestBashApproval: vi.fn(),
    validateFilePath: vi.fn(
      (_params: { agentId: string; path: string; operation: string }): {
        allowed: boolean
        reason?: string
      } => {
        return { allowed: true }
      },
    ),
    requestClarification: vi.fn(),
  }

  function createSessionRequest(
    overrides: Partial<PiSdkCreateSessionRequest> = {},
  ): PiSdkCreateSessionRequest {
    return {
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test',
      agentId: 'tangyuan',
      sessionId: 'session-write-edit',
      sdkSessionFile: '/tmp/session.json',
      cwd: '/tmp',
      agentSkillsPath: '/tmp/agent/skills',
      sharedSkillsPath: '/tmp/shared/skills',
      onUpdateSoul: vi.fn(),
      onUpdateUserProfile: vi.fn(),
      toolApprovalGateway: mockToolApprovalGateway,
      ...overrides,
    }
  }

  function openSessionRequest(
    overrides: Partial<PiSdkOpenSessionRequest> = {},
  ): PiSdkOpenSessionRequest {
    return {
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test',
      agentId: 'tangyuan',
      sessionId: 'session-write-edit',
      sdkSessionFile: '/tmp/session.json',
      cwd: '/tmp',
      agentSkillsPath: '/tmp/agent/skills',
      sharedSkillsPath: '/tmp/shared/skills',
      onUpdateSoul: vi.fn(),
      onUpdateUserProfile: vi.fn(),
      toolApprovalGateway: mockToolApprovalGateway,
      ...overrides,
    }
  }

  it('新建会话中注册带路径保护的 write 和 edit 工具', async () => {
    createAgentSession.mockResolvedValueOnce({
      session: {
        subscribe: () => () => undefined,
        prompt: vi.fn(async () => undefined),
        getLastAssistantText: () => null,
        abort: vi.fn(async () => undefined),
        dispose: vi.fn(),
      },
    })

    await new RealPiSdkGateway().createSession(createSessionRequest())

    const options = createAgentSession.mock.calls.at(-1)?.[0] as {
      customTools: Array<{ name: string }>
      excludedToolNames?: string[]
    }
    const toolNames = options.customTools.map((tool) => tool.name)

    expect(toolNames).toContain('write')
    expect(toolNames).toContain('edit')
    expect(options.excludedToolNames).toContain('write')
    expect(options.excludedToolNames).toContain('edit')
  })

  it('打开历史会话中也注册带路径保护的 write 和 edit 工具', async () => {
    createAgentSession.mockResolvedValueOnce({
      session: {
        subscribe: () => () => undefined,
        prompt: vi.fn(async () => undefined),
        getLastAssistantText: () => null,
        abort: vi.fn(async () => undefined),
        dispose: vi.fn(),
      },
    })

    await new RealPiSdkGateway().openSession(openSessionRequest())

    const options = createAgentSession.mock.calls.at(-1)?.[0] as {
      customTools: Array<{ name: string }>
      excludedToolNames?: string[]
    }
    const toolNames = options.customTools.map((tool) => tool.name)

    expect(toolNames).toContain('write')
    expect(toolNames).toContain('edit')
    expect(options.excludedToolNames).toContain('write')
    expect(options.excludedToolNames).toContain('edit')
  })

  it('write 工具拒绝受保护的 soul.md 路径', async () => {
    mockToolApprovalGateway.validateFilePath.mockReturnValueOnce({
      allowed: false,
      reason: '不允许写入 Agent 灵魂文件：/home/soul.md。请使用 update_soul 工具修改 Agent 灵魂。',
    } as { allowed: boolean; reason?: string })

    createAgentSession.mockResolvedValueOnce({
      session: {
        subscribe: () => () => undefined,
        prompt: vi.fn(async () => undefined),
        getLastAssistantText: () => null,
        abort: vi.fn(async () => undefined),
        dispose: vi.fn(),
      },
    })

    await new RealPiSdkGateway().createSession(createSessionRequest())

    const options = createAgentSession.mock.calls.at(-1)?.[0] as {
      customTools: Array<{
        name: string
        execute: (
          toolCallId: string,
          params: Record<string, unknown>,
        ) => Promise<{ content: Array<{ type: string; text: string }> }>
      }>
    }
    const writeTool = options.customTools.find((tool) => tool.name === 'write')
    expect(writeTool).toBeDefined()

    const result = await writeTool!.execute('call-1', {
      path: '/home/soul.md',
      content: 'malicious',
    })

    expect(result.content[0]?.text).toContain('update_soul')
  })

  it('edit 工具拒绝受保护的 user.md 路径', async () => {
    mockToolApprovalGateway.validateFilePath.mockReturnValueOnce({
      allowed: false,
      reason: '不允许编辑共享用户画像文件：/home/profile/user.md。请使用 update_user_profile 工具修改用户画像。',
    } as { allowed: boolean; reason?: string })

    createAgentSession.mockResolvedValueOnce({
      session: {
        subscribe: () => () => undefined,
        prompt: vi.fn(async () => undefined),
        getLastAssistantText: () => null,
        abort: vi.fn(async () => undefined),
        dispose: vi.fn(),
      },
    })

    await new RealPiSdkGateway().createSession(createSessionRequest())

    const options = createAgentSession.mock.calls.at(-1)?.[0] as {
      customTools: Array<{
        name: string
        execute: (
          toolCallId: string,
          params: Record<string, unknown>,
        ) => Promise<{ content: Array<{ type: string; text: string }> }>
      }>
    }
    const editTool = options.customTools.find((tool) => tool.name === 'edit')
    expect(editTool).toBeDefined()

    const result = await editTool!.execute('call-1', {
      path: '/home/profile/user.md',
      edits: [{ oldText: 'a', newText: 'b' }],
    })

    expect(result.content[0]?.text).toContain('update_user_profile')
  })

  it('write 工具允许写入普通工作空间文件', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'tangyuan-test-'))
    const testFile = join(tmpDir, 'notes.txt')

    createAgentSession.mockResolvedValueOnce({
      session: {
        subscribe: () => () => undefined,
        prompt: vi.fn(async () => undefined),
        getLastAssistantText: () => null,
        abort: vi.fn(async () => undefined),
        dispose: vi.fn(),
      },
    })

    await new RealPiSdkGateway().createSession(
      createSessionRequest({ cwd: tmpDir }),
    )

    const options = createAgentSession.mock.calls.at(-1)?.[0] as {
      customTools: Array<{
        name: string
        execute: (
          toolCallId: string,
          params: Record<string, unknown>,
        ) => Promise<{ content: Array<{ type: string; text: string }> }>
      }>
    }
    const writeTool = options.customTools.find((tool) => tool.name === 'write')
    expect(writeTool).toBeDefined()

    mockToolApprovalGateway.validateFilePath.mockReturnValueOnce({
      allowed: true,
    })

    const result = await writeTool!.execute('call-1', {
      path: testFile,
      content: 'hello world',
    })

    expect(result.content[0]?.text).toContain('已写入')

    // 验证文件确实被写入
    const { readFile } = await import('node:fs/promises')
    const content = await readFile(testFile, 'utf8')
    expect(content).toBe('hello world')

    // 清理
    await import('node:fs/promises').then(({ rm }) =>
      rm(tmpDir, { recursive: true, force: true }),
    )
  })

  it('edit 工具允许编辑普通工作空间文件', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'tangyuan-test-'))
    const testFile = join(tmpDir, 'notes.txt')
    await writeFile(testFile, 'hello world', 'utf8')

    createAgentSession.mockResolvedValueOnce({
      session: {
        subscribe: () => () => undefined,
        prompt: vi.fn(async () => undefined),
        getLastAssistantText: () => null,
        abort: vi.fn(async () => undefined),
        dispose: vi.fn(),
      },
    })

    await new RealPiSdkGateway().createSession(
      createSessionRequest({ cwd: tmpDir }),
    )

    const options = createAgentSession.mock.calls.at(-1)?.[0] as {
      customTools: Array<{
        name: string
        execute: (
          toolCallId: string,
          params: Record<string, unknown>,
        ) => Promise<{ content: Array<{ type: string; text: string }> }>
      }>
    }
    const editTool = options.customTools.find((tool) => tool.name === 'edit')
    expect(editTool).toBeDefined()

    mockToolApprovalGateway.validateFilePath.mockReturnValueOnce({
      allowed: true,
    })

    const result = await editTool!.execute('call-1', {
      path: testFile,
      edits: [{ oldText: 'hello', newText: 'hi' }],
    })

    expect(result.content[0]?.text).toContain('已编辑')

    // 验证文件确实被编辑
    const { readFile } = await import('node:fs/promises')
    const content = await readFile(testFile, 'utf8')
    expect(content).toBe('hi world')

    // 清理
    await import('node:fs/promises').then(({ rm }) =>
      rm(tmpDir, { recursive: true, force: true }),
    )
  })

  it('edit 工具拒绝非唯一的 oldText', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'tangyuan-test-'))
    const testFile = join(tmpDir, 'notes.txt')
    await writeFile(testFile, 'hello hello', 'utf8')

    createAgentSession.mockResolvedValueOnce({
      session: {
        subscribe: () => () => undefined,
        prompt: vi.fn(async () => undefined),
        getLastAssistantText: () => null,
        abort: vi.fn(async () => undefined),
        dispose: vi.fn(),
      },
    })

    await new RealPiSdkGateway().createSession(
      createSessionRequest({ cwd: tmpDir }),
    )

    const options = createAgentSession.mock.calls.at(-1)?.[0] as {
      customTools: Array<{
        name: string
        execute: (
          toolCallId: string,
          params: Record<string, unknown>,
        ) => Promise<{ content: Array<{ type: string; text: string }> }>
      }>
    }
    const editTool = options.customTools.find((tool) => tool.name === 'edit')
    expect(editTool).toBeDefined()

    mockToolApprovalGateway.validateFilePath.mockReturnValueOnce({
      allowed: true,
    })

    const result = await editTool!.execute('call-1', {
      path: testFile,
      edits: [{ oldText: 'hello', newText: 'hi' }],
    })

    expect(result.content[0]?.text).toContain('出现了 2 次')

    // 清理
    await import('node:fs/promises').then(({ rm }) =>
      rm(tmpDir, { recursive: true, force: true }),
    )
  })
})
