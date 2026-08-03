import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
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

describe('RealPiSdkGateway write/edit path protection', () => {
  const mockToolApprovalGateway = {
    requestBashApproval: vi.fn(),
    validateFilePath: vi.fn(
      (_params: {
        agentId: string
        path: string
        operation: string
      }): {
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
      agentId: 'yuanxiao',
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
      agentId: 'yuanxiao',
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
      excludeTools?: string[]
    }
    const toolNames = options.customTools.map((tool) => tool.name)

    expect(toolNames).toContain('read_file')
    expect(toolNames).toContain('run_command')
    expect(toolNames).toContain('write_file')
    expect(toolNames).toContain('edit_file')
    expect(options.excludeTools).toEqual(['read', 'bash', 'write', 'edit'])
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
      excludeTools?: string[]
    }
    const toolNames = options.customTools.map((tool) => tool.name)

    expect(toolNames).toContain('read_file')
    expect(toolNames).toContain('run_command')
    expect(toolNames).toContain('write_file')
    expect(toolNames).toContain('edit_file')
    expect(options.excludeTools).toEqual(['read', 'bash', 'write', 'edit'])
  })

  it('write 工具拒绝受保护的 soul.md 路径', async () => {
    mockToolApprovalGateway.validateFilePath.mockReturnValueOnce({
      allowed: false,
      reason:
        '不允许写入 Agent 灵魂文件：/home/soul.md。请使用 update_soul 工具修改 Agent 灵魂。',
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
    const writeTool = options.customTools.find(
      (tool) => tool.name === 'write_file',
    )
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
      reason:
        '不允许编辑共享用户画像文件：/home/profile/user.md。请使用 update_user_profile 工具修改用户画像。',
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
    const editTool = options.customTools.find(
      (tool) => tool.name === 'edit_file',
    )
    expect(editTool).toBeDefined()

    const result = await editTool!.execute('call-1', {
      path: '/home/profile/user.md',
      edits: [{ oldText: 'a', newText: 'b' }],
    })

    expect(result.content[0]?.text).toContain('update_user_profile')
  })

  it('write 工具允许写入普通工作空间文件', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'yuanxiao-test-'))
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
    const writeTool = options.customTools.find(
      (tool) => tool.name === 'write_file',
    )
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
    const tmpDir = await mkdtemp(join(tmpdir(), 'yuanxiao-test-'))
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
    const editTool = options.customTools.find(
      (tool) => tool.name === 'edit_file',
    )
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
    const tmpDir = await mkdtemp(join(tmpdir(), 'yuanxiao-test-'))
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
    const editTool = options.customTools.find(
      (tool) => tool.name === 'edit_file',
    )
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

describe('RealPiSdkGateway 审批与路径拒绝不产生副作用', () => {
  const mockToolApprovalGateway = {
    requestBashApproval: vi.fn(),
    validateFilePath: vi.fn(
      (_params: {
        agentId: string
        path: string
        operation: string
      }): {
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
      agentId: 'yuanxiao',
      sessionId: 'session-side-effect',
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

  it('run_command 工具拒绝审批时不执行命令（无副作用）', async () => {
    mockToolApprovalGateway.requestBashApproval.mockResolvedValueOnce({
      approved: false,
    })

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
    const runCommandTool = options.customTools.find(
      (tool) => tool.name === 'run_command',
    )
    expect(runCommandTool).toBeDefined()

    const result = await runCommandTool!.execute('call-1', {
      command: 'rm -rf /',
    })

    expect(result.content[0]?.text).toContain('拒绝')
    // 确认 requestBashApproval 确实被调用了（审批流程走了）
    expect(mockToolApprovalGateway.requestBashApproval).toHaveBeenCalled()
  })

  it('write_file 工具路径校验拒绝时不创建文件（无副作用）', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'yuanxiao-test-'))
    const testFile = join(tmpDir, 'rejected.txt')

    mockToolApprovalGateway.validateFilePath.mockReturnValueOnce({
      allowed: false,
      reason: '测试拒绝原因',
    })

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
    const writeTool = options.customTools.find(
      (tool) => tool.name === 'write_file',
    )
    expect(writeTool).toBeDefined()

    const result = await writeTool!.execute('call-1', {
      path: testFile,
      content: 'should not be written',
    })

    expect(result.content[0]?.text).toBe('测试拒绝原因')

    // 确认文件确实没有被创建
    const { access } = await import('node:fs/promises')
    await expect(access(testFile)).rejects.toThrow()

    // 清理
    await import('node:fs/promises').then(({ rm }) =>
      rm(tmpDir, { recursive: true, force: true }),
    )
  })
})
