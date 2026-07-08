import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AgentRuntimeError,
  type AgentEvent,
  type AgentMessage,
  PiSdkDriver,
  type PiSdkCreateSessionRequest,
  type PiSdkGateway,
  type PiSdkListSessionsRequest,
  type PiSdkOpenSessionRequest,
  type PiSdkPromptOptions,
  type PiSdkReadMessagesRequest,
  type PiSdkSessionHandle,
  type PiSdkVerificationRequest,
  createDefaultSessionSummary,
} from './index'

const tempDirs: string[] = []

afterEach(async () => {
  for (const directory of tempDirs.splice(0)) {
    await import('node:fs/promises').then(({ rm }) =>
      rm(directory, { recursive: true, force: true }),
    )
  }
})

describe('createDefaultSessionSummary', () => {
  it('creates a tangyuan session summary in the initial idle state', () => {
    expect(
      createDefaultSessionSummary({
        sessionId: 'session-1',
        title: '新会话',
        updatedAt: '2026-07-08T00:00:00.000Z',
      }),
    ).toEqual({
      agentId: 'tangyuan',
      sessionId: 'session-1',
      title: '新会话',
      updatedAt: '2026-07-08T00:00:00.000Z',
      state: 'idle',
    })
  })
})

describe('AgentRuntimeError', () => {
  it('serializes a stable runtime error without leaking the original cause', () => {
    const error = new AgentRuntimeError({
      code: 'configuration-missing',
      message: 'Provider and model are required before starting a run.',
      recoverable: true,
      cause: new Error('secret API key sk-test-1234'),
    })

    expect(error.toJSON()).toEqual({
      code: 'configuration-missing',
      message: 'Provider and model are required before starting a run.',
      recoverable: true,
    })
  })
})

describe('PiSdkDriver', () => {
  it('creates the default Agent Home and bootstrap template on first read', async () => {
    const { driver, homePath, rootPath } = await createDriver()

    await expect(driver.getSnapshot()).resolves.toMatchObject({
      activeAgent: {
        agentId: 'tangyuan',
        profile: {
          initialized: false,
          bootstrapRequired: true,
        },
      },
      status: 'missing-config',
    })

    await expect(
      stat(join(rootPath, homePath.slice(2))),
    ).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    })
    await expect(
      readFile(join(rootPath, homePath.slice(2), 'bootstrap.md'), 'utf8'),
    ).resolves.toContain('1. 用户希望汤圆怎么称呼自己。')
    await expect(
      stat(join(rootPath, homePath.slice(2), 'memory')),
    ).resolves.toBeDefined()
    await expect(
      stat(join(rootPath, homePath.slice(2), 'skills')),
    ).resolves.toBeDefined()
    await expect(
      stat(join(rootPath, homePath.slice(2), 'soul.history')),
    ).resolves.toBeDefined()
    await expect(
      stat(join(rootPath, homePath.slice(2), 'user.history')),
    ).resolves.toBeDefined()
  })

  it('does not overwrite an existing bootstrap template on repeated reads', async () => {
    const { driver, rootPath, homePath } = await createDriver()
    const resolvedHomePath = join(rootPath, homePath.slice(2))

    await driver.getSnapshot()
    await import('node:fs/promises').then(({ writeFile }) =>
      writeFile(
        join(resolvedHomePath, 'bootstrap.md'),
        'custom bootstrap',
        'utf8',
      ),
    )

    await driver.refresh()

    await expect(
      readFile(join(resolvedHomePath, 'bootstrap.md'), 'utf8'),
    ).resolves.toBe('custom bootstrap')
  })

  it('recreates bootstrap.md when it and the profile files are missing', async () => {
    const { driver, rootPath, homePath } = await createDriver()
    const resolvedHomePath = join(rootPath, homePath.slice(2))

    await driver.getSnapshot()
    await import('node:fs/promises').then(({ rm }) =>
      rm(join(resolvedHomePath, 'bootstrap.md'), { force: true }),
    )

    await expect(driver.refresh()).resolves.toMatchObject({
      activeAgent: {
        profile: {
          bootstrapRequired: true,
        },
      },
    })
    await expect(
      readFile(join(resolvedHomePath, 'bootstrap.md'), 'utf8'),
    ).resolves.toContain('# Bootstrap')
  })

  it('marks the profile as initialized only when soul.md and user.md both exist', async () => {
    const { driver, rootPath, homePath } = await createDriver()
    const resolvedHomePath = join(rootPath, homePath.slice(2))

    await driver.getSnapshot()
    await import('node:fs/promises').then(async ({ writeFile }) => {
      await writeFile(join(resolvedHomePath, 'soul.md'), '# soul', 'utf8')
      await writeFile(join(resolvedHomePath, 'user.md'), '# user', 'utf8')
    })

    await expect(driver.refresh()).resolves.toMatchObject({
      activeAgent: {
        profile: {
          initialized: true,
          bootstrapRequired: false,
        },
      },
    })
  })

  it('verifies configuration before saving config JSON with a masked API key snapshot', async () => {
    const gateway = createPiSdkGateway()
    const { driver, rootPath } = await createDriver({ gateway })

    await expect(
      driver.saveConfiguration({
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        apiKey: 'sk-test-secret-7890',
      }),
    ).resolves.toMatchObject({
      settings: {
        selectedProviderId: 'anthropic',
        selectedModelId: 'claude-sonnet-4-5',
      },
      auth: {
        apiKey: {
          configured: true,
          maskedValue: 'sk-t...7890',
        },
      },
      status: 'ready',
    })

    await expect(
      readFile(
        join(rootPath, 'Library/Application Support/Tangyuan/config.json'),
        'utf8',
      ),
    ).resolves.toContain('sk-test-secret-7890')
    expect(gateway.requests).toEqual([
      expect.objectContaining({
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        prompt: 'Reply with OK.',
      }),
    ])
  })

  it('does not save the API key when configuration verification fails', async () => {
    const gateway = createPiSdkGateway({
      verifyConfiguration: async () => {
        throw new Error('provider rejected sk-test-secret-7890')
      },
    })
    const { driver, rootPath } = await createDriver({ gateway })

    await expect(
      driver.saveConfiguration({
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        apiKey: 'sk-test-secret-7890',
      }),
    ).rejects.toMatchObject({
      code: 'provider-verification-failed',
      message: expect.not.stringContaining('sk-test-secret-7890'),
    })
    await expect(
      readFile(
        join(rootPath, 'Library/Application Support/Tangyuan/config.json'),
        'utf8',
      ),
    ).rejects.toThrow()
  })

  it('cancels an in-flight configuration verification', async () => {
    const gateway = createPiSdkGateway({
      verifyConfiguration: async ({ signal }) => {
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'))
          })
        })
      },
    })
    const { driver } = await createDriver({ gateway })
    const savePromise = driver.saveConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    const handledSavePromise = savePromise.then(
      () => ({ status: 'resolved' as const }),
      (error: unknown) => ({ status: 'rejected' as const, error }),
    )

    await expect(
      driver.cancelConfigurationVerification({ verificationId: 'current' }),
    ).resolves.toMatchObject({
      status: 'missing-config',
    })
    await expect(handledSavePromise).resolves.toMatchObject({
      status: 'rejected',
      error: {
        code: 'run-cancelled',
        message: expect.not.stringContaining('sk-test-secret-7890'),
      },
    })
  })

  it('masks short and long API keys without exposing the complete secret', () => {
    expect(PiSdkDriver.maskApiKey('sk-test-secret-7890')).toBe('sk-t...7890')
    expect(PiSdkDriver.maskApiKey('short')).toBe('•••••')
  })

  it('creates a real Pi SDK session with the default Agent Home cwd after configuration is saved', async () => {
    const gateway = createPiSdkGateway()
    const { driver, rootPath } = await createDriver({ gateway })

    await driver.saveConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    await expect(
      driver.createSession({
        agentId: 'tangyuan',
        title: '新会话',
      }),
    ).resolves.toMatchObject({
      agentId: 'tangyuan',
      sessionId: 'session-1',
      state: 'idle',
    })

    expect(gateway.sessionRequests).toEqual([
      expect.objectContaining({
        sessionId: 'session-1',
        sdkSessionFile: expect.stringContaining('session-1.jsonl'),
        cwd: join(rootPath, '.tangyuan/agents/tangyuan'),
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-5',
      }),
    ])
  })

  it('persists a local session index when creating a Pi SDK session', async () => {
    const gateway = createPiSdkGateway()
    const { driver, userDataPath } = await createDriver({ gateway })

    await driver.saveConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    await expect(
      driver.createSession({
        agentId: 'tangyuan',
        title: '调试启动流程',
      }),
    ).resolves.toMatchObject({
      agentId: 'tangyuan',
      sessionId: 'session-1',
      title: '调试启动流程',
      state: 'idle',
    })

    await expect(
      readJson(join(userDataPath, 'sessions/index.json')),
    ).resolves.toEqual({
      sessions: [
        expect.objectContaining({
          agentId: 'tangyuan',
          sessionId: 'session-1',
          title: '调试启动流程',
          createdAt: '2026-07-08T00:00:00.000Z',
          updatedAt: '2026-07-08T00:00:00.000Z',
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          sdkSessionFile: expect.stringContaining('session-1.jsonl'),
          lastMessagePreview: '',
          status: 'idle',
        }),
      ],
    })
    await expect(
      stat(join(userDataPath, 'sessions/index.json.tmp')),
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('updates the session index summary after a completed reply', async () => {
    const gateway = createPiSdkGateway()
    const { driver, userDataPath } = await createDriver({ gateway })

    await driver.saveConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    const session = await driver.createSession({
      agentId: 'tangyuan',
      title: '新会话',
    })
    await driver.sendMessage({
      agentId: 'tangyuan',
      sessionId: session.sessionId,
      content: '帮我检查保存逻辑',
    })

    await expect(
      readJson(join(userDataPath, 'sessions/index.json')),
    ).resolves.toEqual({
      sessions: [
        expect.objectContaining({
          sessionId: 'session-1',
          updatedAt: '2026-07-08T00:00:00.000Z',
          lastMessagePreview: '收到：帮我检查保存逻辑',
          status: 'completed',
        }),
      ],
    })
  })

  it('restores the session list and opens messages from Pi SDK storage after restart', async () => {
    const sdkMessagesBySessionFile = new Map<string, AgentMessage[]>()
    const gateway = createPiSdkGateway({
      createSession: async (request) => {
        const handle = createPromptingHandle(request.sessionId, (messages) => {
          sdkMessagesBySessionFile.set(request.sdkSessionFile, messages)
        })
        gateway.sessionRequests.push(request)
        gateway.sessionHandles.push(handle)

        return handle
      },
      openSession: async (request) => {
        const handle = createPromptingHandle(request.sessionId)
        gateway.openSessionRequests.push(request)
        gateway.sessionHandles.push(handle)

        return handle
      },
      readMessages: async (request) =>
        sdkMessagesBySessionFile.get(request.sdkSessionFile) ?? [],
    })
    const { driver, rootPath, userDataPath } = await createDriver({ gateway })

    await driver.saveConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    const session = await driver.createSession({
      agentId: 'tangyuan',
      title: '持久化检查',
    })
    await driver.sendMessage({
      agentId: 'tangyuan',
      sessionId: session.sessionId,
      content: '重启后还能看到吗',
    })

    const restartedDriver = createDriverAtPath({
      gateway,
      rootPath,
      userDataPath,
    })
    await expect(
      restartedDriver.listSessions({ agentId: 'tangyuan' }),
    ).resolves.toEqual([
      expect.objectContaining({
        sessionId: 'session-1',
        title: '持久化检查',
        state: 'completed',
      }),
    ])
    await expect(
      restartedDriver.getMessages({
        agentId: 'tangyuan',
        sessionId: 'session-1',
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        role: 'user',
        content: '重启后还能看到吗',
      }),
      expect.objectContaining({
        role: 'agent',
        content: '收到：重启后还能看到吗',
      }),
    ])
    expect(gateway.openSessionRequests).toEqual([
      expect.objectContaining({
        sessionId: 'session-1',
        sdkSessionFile: expect.stringContaining('session-1.jsonl'),
      }),
    ])
  })

  it('rebuilds a basic local index from Pi SDK sessions when the index is missing', async () => {
    const gateway = createPiSdkGateway({
      listSessions: async () => [
        {
          sessionId: 'session-from-sdk',
          sdkSessionFile: '/tmp/pi-sessions/session-from-sdk.json',
          title: 'SDK 恢复会话',
          createdAt: '2026-07-07T00:00:00.000Z',
          updatedAt: '2026-07-07T00:01:00.000Z',
        },
      ],
    })
    const { driver, userDataPath } = await createDriver({ gateway })

    await driver.saveConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    await rm(join(userDataPath, 'sessions/index.json'), {
      force: true,
    })

    await expect(driver.listSessions({ agentId: 'tangyuan' })).resolves.toEqual(
      [
        expect.objectContaining({
          agentId: 'tangyuan',
          sessionId: 'session-from-sdk',
          title: 'SDK 恢复会话',
          state: 'idle',
        }),
      ],
    )
    await expect(
      readJson(join(userDataPath, 'sessions/index.json')),
    ).resolves.toEqual({
      sessions: [
        expect.objectContaining({
          sessionId: 'session-from-sdk',
          sdkSessionFile: '/tmp/pi-sessions/session-from-sdk.json',
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
        }),
      ],
    })
  })

  it('appends the user message immediately and stores the agent reply after sending', async () => {
    const gateway = createPiSdkGateway()
    const { driver } = await createDriver({ gateway })
    const events: AgentEvent[] = []
    driver.subscribe((event) => {
      events.push(event)
    })

    await driver.saveConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    const session = await driver.createSession({
      agentId: 'tangyuan',
      title: '新会话',
    })
    await driver.sendMessage({
      agentId: 'tangyuan',
      sessionId: session.sessionId,
      content: '你好',
    })

    await expect(
      driver.getMessages({
        agentId: 'tangyuan',
        sessionId: session.sessionId,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        role: 'user',
        content: '你好',
      }),
      expect.objectContaining({
        role: 'agent',
        content: '收到：你好',
      }),
    ])
    expect(gateway.sessionHandles[0]?.prompts[0]).toContain('# Bootstrap')
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'message-appended',
          message: expect.objectContaining({ role: 'user', content: '你好' }),
        }),
        expect.objectContaining({
          type: 'run-state-changed',
          state: 'completed',
        }),
      ]),
    )
  })

  it('maps Pi SDK streaming events to normalized turn and delta events', async () => {
    const gateway = createPiSdkGateway({
      createSession: async (request) => {
        const handle = {
          prompts: [] as string[],
          prompt: async (prompt: string, options?: PiSdkPromptOptions) => {
            handle.prompts.push(prompt)
            options?.onEvent?.({ type: 'thinking-started' })
            options?.onEvent?.({ type: 'tool-started', toolName: 'read' })
            options?.onEvent?.({ type: 'text-delta', delta: '你' })
            options?.onEvent?.({ type: 'text-delta', delta: '好' })
            options?.onEvent?.({ type: 'tool-completed', toolName: 'read' })
            return '你好'
          },
          abort: async () => undefined,
          dispose: () => undefined,
        }
        gateway.sessionRequests.push(request)
        gateway.sessionHandles.push(handle)

        return handle
      },
    })
    const { driver } = await createDriver({ gateway })
    const events: AgentEvent[] = []
    driver.subscribe((event) => {
      events.push(event)
    })

    await driver.saveConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    const session = await driver.createSession({
      agentId: 'tangyuan',
      title: '新会话',
    })
    await driver.sendMessage({
      agentId: 'tangyuan',
      sessionId: session.sessionId,
      content: '你好',
    })

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'turn-started',
          runId: 'session-1-run-1',
        }),
        expect.objectContaining({
          type: 'activity-updated',
          activity: expect.objectContaining({
            kind: 'thinking',
            label: '思考中',
          }),
        }),
        expect.objectContaining({
          type: 'activity-updated',
          activity: expect.objectContaining({
            kind: 'tool',
            label: '正在读取文件',
          }),
        }),
        expect.objectContaining({ type: 'message-delta', delta: '你' }),
        expect.objectContaining({ type: 'message-delta', delta: '好' }),
        expect.objectContaining({
          type: 'message-completed',
          message: expect.objectContaining({ role: 'agent', content: '你好' }),
        }),
      ]),
    )
    await expect(
      driver.getMessages({ agentId: 'tangyuan', sessionId: session.sessionId }),
    ).resolves.toEqual([
      expect.objectContaining({ role: 'user', content: '你好' }),
      expect.objectContaining({ role: 'agent', content: '你好' }),
    ])
  })

  it('blocks a duplicate active run in the same session but allows another session', async () => {
    const releaseFirstRun = createDeferred<void>()
    const firstRunStarted = createDeferred<void>()
    const gateway = createPiSdkGateway({
      createSession: async (request) => {
        const handle = {
          prompts: [] as string[],
          prompt: async (prompt: string) => {
            handle.prompts.push(prompt)

            if (request.sessionId === 'session-1') {
              firstRunStarted.resolve()
              await releaseFirstRun.promise
            }

            return `完成 ${request.sessionId}`
          },
          abort: async () => undefined,
          dispose: () => undefined,
        }
        gateway.sessionRequests.push(request)
        gateway.sessionHandles.push(handle)

        return handle
      },
    })
    const { driver, userDataPath } = await createDriver({ gateway })

    await driver.saveConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    const sessionOne = await driver.createSession({
      agentId: 'tangyuan',
      title: '会话一',
    })
    const sessionTwo = await driver.createSession({
      agentId: 'tangyuan',
      title: '会话二',
    })
    const firstRun = driver.sendMessage({
      agentId: 'tangyuan',
      sessionId: sessionOne.sessionId,
      content: '第一条',
    })
    await firstRunStarted.promise
    await expect(
      readJson(join(userDataPath, 'sessions/index.json')),
    ).resolves.toEqual({
      sessions: expect.arrayContaining([
        expect.objectContaining({
          sessionId: sessionOne.sessionId,
          status: 'running',
          lastMessagePreview: '第一条',
        }),
      ]),
    })

    await expect(
      driver.sendMessage({
        agentId: 'tangyuan',
        sessionId: sessionOne.sessionId,
        content: '重复',
      }),
    ).rejects.toMatchObject({ code: 'run-already-active' })
    await expect(
      driver.sendMessage({
        agentId: 'tangyuan',
        sessionId: sessionTwo.sessionId,
        content: '并发',
      }),
    ).resolves.toBeUndefined()

    releaseFirstRun.resolve()
    await expect(firstRun).resolves.toBeUndefined()
  })

  it('cancels an active run and preserves generated partial content', async () => {
    const runStarted = createDeferred<void>()
    const releasePrompt = createDeferred<void>()
    const gateway = createPiSdkGateway({
      createSession: async (request) => {
        const handle = {
          prompts: [] as string[],
          prompt: async (prompt: string, options?: PiSdkPromptOptions) => {
            handle.prompts.push(prompt)
            options?.onEvent?.({ type: 'text-delta', delta: '部分内容' })
            runStarted.resolve()
            await releasePrompt.promise
            return '部分内容'
          },
          abort: async () => {
            releasePrompt.resolve()
          },
          dispose: () => undefined,
        }
        gateway.sessionRequests.push(request)
        gateway.sessionHandles.push(handle)

        return handle
      },
    })
    const { driver } = await createDriver({ gateway })

    await driver.saveConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    const session = await driver.createSession({
      agentId: 'tangyuan',
      title: '新会话',
    })
    const sendPromise = driver.sendMessage({
      agentId: 'tangyuan',
      sessionId: session.sessionId,
      content: '开始',
    })
    await runStarted.promise
    await driver.cancelRun({
      agentId: 'tangyuan',
      sessionId: session.sessionId,
    })

    await expect(sendPromise).resolves.toBeUndefined()
    await expect(driver.listSessions({ agentId: 'tangyuan' })).resolves.toEqual(
      [
        expect.objectContaining({
          sessionId: session.sessionId,
          state: 'cancelled',
        }),
      ],
    )
    await expect(
      driver.getMessages({ agentId: 'tangyuan', sessionId: session.sessionId }),
    ).resolves.toEqual([
      expect.objectContaining({ role: 'user', content: '开始' }),
      expect.objectContaining({ role: 'agent', content: '部分内容' }),
    ])
  })

  it('does not keep an empty agent message when a run fails before deltas arrive', async () => {
    const gateway = createPiSdkGateway({
      createSession: async (request) => {
        const handle = {
          prompts: [] as string[],
          prompt: async (prompt: string) => {
            handle.prompts.push(prompt)
            throw new Error('provider failed')
          },
          abort: async () => undefined,
          dispose: () => undefined,
        }
        gateway.sessionRequests.push(request)
        gateway.sessionHandles.push(handle)

        return handle
      },
    })
    const { driver } = await createDriver({ gateway })

    await driver.saveConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    const session = await driver.createSession({
      agentId: 'tangyuan',
      title: '新会话',
    })

    await expect(
      driver.sendMessage({
        agentId: 'tangyuan',
        sessionId: session.sessionId,
        content: '开始',
      }),
    ).rejects.toThrow('provider failed')
    await expect(
      driver.getMessages({ agentId: 'tangyuan', sessionId: session.sessionId }),
    ).resolves.toEqual([
      expect.objectContaining({ role: 'user', content: '开始' }),
    ])
  })

  it('injects existing soul.md and user.md into the Pi SDK prompt', async () => {
    const gateway = createPiSdkGateway()
    const { driver, rootPath, homePath } = await createDriver({ gateway })
    const resolvedHomePath = join(rootPath, homePath.slice(2))

    await driver.getSnapshot()
    await writeFile(
      join(resolvedHomePath, 'soul.md'),
      '# Soul\n只说中文。',
      'utf8',
    )
    await writeFile(
      join(resolvedHomePath, 'user.md'),
      '# User\n用户喜欢简洁回答。',
      'utf8',
    )
    await driver.saveConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    const session = await driver.createSession({
      agentId: 'tangyuan',
      title: '新会话',
    })

    await driver.sendMessage({
      agentId: 'tangyuan',
      sessionId: session.sessionId,
      content: '开始',
    })

    expect(gateway.sessionHandles[0]?.prompts[0]).toContain('只说中文。')
    expect(gateway.sessionHandles[0]?.prompts[0]).toContain(
      '用户喜欢简洁回答。',
    )
    expect(gateway.sessionHandles[0]?.prompts[0]).not.toContain('# Bootstrap')
  })

  it('runs one hidden profile maintenance turn after the main reply when no update is needed', async () => {
    const gateway = createPiSdkGateway({
      createSession: async (request) => {
        const handle = {
          prompts: [] as string[],
          prompt: async (prompt: string) => {
            handle.prompts.push(prompt)

            return handle.prompts.length === 1
              ? '主回复完成。'
              : '维护回合输出不应进入 transcript。'
          },
          abort: async () => undefined,
          dispose: () => undefined,
        }
        gateway.sessionRequests.push(request)
        gateway.sessionHandles.push(handle)

        return handle
      },
    })
    const { driver, rootPath, homePath } = await createDriver({ gateway })
    const resolvedHomePath = join(rootPath, homePath.slice(2))

    await writeInitializedProfile(resolvedHomePath)
    await driver.saveConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    const session = await driver.createSession({
      agentId: 'tangyuan',
      title: '新会话',
    })
    await driver.sendMessage({
      agentId: 'tangyuan',
      sessionId: session.sessionId,
      content: '记住我偏好短回答',
    })

    expect(gateway.sessionHandles[0]?.prompts).toHaveLength(2)
    expect(gateway.sessionHandles[0]?.prompts[1]).toContain(
      '后台 profile 维护回合',
    )
    expect(gateway.sessionHandles[0]?.prompts[1]).toContain('不要回复用户')
    expect(gateway.sessionHandles[0]?.prompts[1]).toContain(
      '使用 read 读取旧文件',
    )
    expect(gateway.sessionHandles[0]?.prompts[1]).toContain('soul.history')
    await expect(
      driver.getMessages({ agentId: 'tangyuan', sessionId: session.sessionId }),
    ).resolves.toEqual([
      expect.objectContaining({ role: 'user', content: '记住我偏好短回答' }),
      expect.objectContaining({ role: 'agent', content: '主回复完成。' }),
    ])
  })

  it('accepts a backed-up user.md update and appends a system message', async () => {
    const gateway = createPiSdkGateway({
      createSession: async (request) => {
        const handle = {
          prompts: [] as string[],
          prompt: async (prompt: string) => {
            handle.prompts.push(prompt)

            if (handle.prompts.length === 2) {
              const previousUser = await readFile(
                join(request.cwd, 'user.md'),
                'utf8',
              )
              await writeFile(
                join(request.cwd, 'user.history', 'user-20260708.md'),
                previousUser,
                'utf8',
              )
              await writeFile(
                join(request.cwd, 'user.md'),
                '# User\n语言与语气偏好：中文，短回答。',
                'utf8',
              )
            }

            return handle.prompts.length === 1 ? '好的。' : null
          },
          abort: async () => undefined,
          dispose: () => undefined,
        }
        gateway.sessionRequests.push(request)
        gateway.sessionHandles.push(handle)

        return handle
      },
    })
    const { driver, rootPath, homePath } = await createDriver({ gateway })
    const resolvedHomePath = join(rootPath, homePath.slice(2))
    const events: AgentEvent[] = []
    driver.subscribe((event) => {
      events.push(event)
    })

    await writeInitializedProfile(resolvedHomePath)
    await driver.saveConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    const session = await driver.createSession({
      agentId: 'tangyuan',
      title: '新会话',
    })
    await driver.sendMessage({
      agentId: 'tangyuan',
      sessionId: session.sessionId,
      content: '以后请短回答',
    })

    await expect(
      readFile(join(resolvedHomePath, 'user.md'), 'utf8'),
    ).resolves.toContain('短回答')
    await expect(
      readFile(
        join(resolvedHomePath, 'user.history', 'user-20260708.md'),
        'utf8',
      ),
    ).resolves.toContain('用户喜欢简洁回答。')
    await expect(
      driver.getMessages({ agentId: 'tangyuan', sessionId: session.sessionId }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'system',
          content: '已更新用户画像',
        }),
      ]),
    )
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'profile-updated', target: 'user' }),
      ]),
    )
  })

  it('accepts a backed-up soul.md update and appends a system message', async () => {
    const gateway = createPiSdkGateway({
      createSession: async (request) => {
        const handle = {
          prompts: [] as string[],
          prompt: async (prompt: string) => {
            handle.prompts.push(prompt)

            if (handle.prompts.length === 2) {
              const previousSoul = await readFile(
                join(request.cwd, 'soul.md'),
                'utf8',
              )
              await writeFile(
                join(request.cwd, 'soul.history', 'soul-20260708.md'),
                previousSoul,
                'utf8',
              )
              await writeFile(
                join(request.cwd, 'soul.md'),
                '# Soul\n权限边界：修改 Git 历史前必须确认。',
                'utf8',
              )
            }

            return handle.prompts.length === 1 ? '明白。' : null
          },
          abort: async () => undefined,
          dispose: () => undefined,
        }
        gateway.sessionRequests.push(request)
        gateway.sessionHandles.push(handle)

        return handle
      },
    })
    const { driver, rootPath, homePath } = await createDriver({ gateway })
    const resolvedHomePath = join(rootPath, homePath.slice(2))

    await writeInitializedProfile(resolvedHomePath)
    await driver.saveConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    const session = await driver.createSession({
      agentId: 'tangyuan',
      title: '新会话',
    })
    await driver.sendMessage({
      agentId: 'tangyuan',
      sessionId: session.sessionId,
      content: '改 Git 历史前先问我',
    })

    await expect(
      readFile(join(resolvedHomePath, 'soul.md'), 'utf8'),
    ).resolves.toContain('修改 Git 历史前必须确认')
    await expect(
      driver.getMessages({ agentId: 'tangyuan', sessionId: session.sessionId }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'system',
          content: '已更新 Agent 规则',
        }),
      ]),
    )
  })

  it('rejects a profile update that changed a file without a history backup', async () => {
    const gateway = createPiSdkGateway({
      createSession: async (request) => {
        const handle = {
          prompts: [] as string[],
          prompt: async (prompt: string) => {
            handle.prompts.push(prompt)

            if (handle.prompts.length === 2) {
              await writeFile(
                join(request.cwd, 'user.md'),
                '# User\n语言与语气偏好：英文。',
                'utf8',
              )
            }

            return handle.prompts.length === 1 ? '收到。' : null
          },
          abort: async () => undefined,
          dispose: () => undefined,
        }
        gateway.sessionRequests.push(request)
        gateway.sessionHandles.push(handle)

        return handle
      },
    })
    const { driver, rootPath, homePath } = await createDriver({ gateway })
    const resolvedHomePath = join(rootPath, homePath.slice(2))
    const events: AgentEvent[] = []
    driver.subscribe((event) => {
      events.push(event)
    })

    await writeInitializedProfile(resolvedHomePath)
    await driver.saveConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    const session = await driver.createSession({
      agentId: 'tangyuan',
      title: '新会话',
    })
    await driver.sendMessage({
      agentId: 'tangyuan',
      sessionId: session.sessionId,
      content: '切换成英文',
    })

    await expect(
      readFile(join(resolvedHomePath, 'user.md'), 'utf8'),
    ).resolves.toContain('用户喜欢简洁回答。')
    await expect(
      driver.getMessages({ agentId: 'tangyuan', sessionId: session.sessionId }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'system',
          content: '更新用户画像失败：缺少更新前备份，已保留旧版本。',
        }),
      ]),
    )
    expect(events).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'profile-updated', target: 'user' }),
      ]),
    )
  })

  it('keeps the main reply completed when the hidden maintenance turn fails', async () => {
    const gateway = createPiSdkGateway({
      createSession: async (request) => {
        const handle = {
          prompts: [] as string[],
          prompt: async (prompt: string) => {
            handle.prompts.push(prompt)

            if (handle.prompts.length === 2) {
              throw new Error('maintenance failed')
            }

            return '主回复已经完成。'
          },
          abort: async () => undefined,
          dispose: () => undefined,
        }
        gateway.sessionRequests.push(request)
        gateway.sessionHandles.push(handle)

        return handle
      },
    })
    const { driver, rootPath, homePath } = await createDriver({ gateway })
    const resolvedHomePath = join(rootPath, homePath.slice(2))

    await writeInitializedProfile(resolvedHomePath)
    await driver.saveConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    const session = await driver.createSession({
      agentId: 'tangyuan',
      title: '新会话',
    })

    await expect(
      driver.sendMessage({
        agentId: 'tangyuan',
        sessionId: session.sessionId,
        content: '照常回复',
      }),
    ).resolves.toBeUndefined()
    await expect(driver.listSessions({ agentId: 'tangyuan' })).resolves.toEqual(
      [
        expect.objectContaining({
          sessionId: session.sessionId,
          state: 'completed',
        }),
      ],
    )
    await expect(
      driver.getMessages({ agentId: 'tangyuan', sessionId: session.sessionId }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'agent', content: '主回复已经完成。' }),
        expect.objectContaining({
          role: 'system',
          content: 'Profile 维护失败：maintenance failed',
        }),
      ]),
    )
  })

  it('redacts API keys from a backed-up profile update before keeping it', async () => {
    const gateway = createPiSdkGateway({
      createSession: async (request) => {
        const handle = {
          prompts: [] as string[],
          prompt: async (prompt: string) => {
            handle.prompts.push(prompt)

            if (handle.prompts.length === 2) {
              const previousUser = await readFile(
                join(request.cwd, 'user.md'),
                'utf8',
              )
              await writeFile(
                join(request.cwd, 'user.history', 'user-20260708.md'),
                previousUser,
                'utf8',
              )
              await writeFile(
                join(request.cwd, 'user.md'),
                '# User\n用户 API Key 是 sk-test-secret-7890，偏好中文。',
                'utf8',
              )
            }

            return handle.prompts.length === 1 ? '收到。' : null
          },
          abort: async () => undefined,
          dispose: () => undefined,
        }
        gateway.sessionRequests.push(request)
        gateway.sessionHandles.push(handle)

        return handle
      },
    })
    const { driver, rootPath, homePath } = await createDriver({ gateway })
    const resolvedHomePath = join(rootPath, homePath.slice(2))

    await writeInitializedProfile(resolvedHomePath)
    await driver.saveConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    const session = await driver.createSession({
      agentId: 'tangyuan',
      title: '新会话',
    })
    await driver.sendMessage({
      agentId: 'tangyuan',
      sessionId: session.sessionId,
      content: '我偏好中文',
    })

    const nextUserProfile = await readFile(
      join(resolvedHomePath, 'user.md'),
      'utf8',
    )
    expect(nextUserProfile).not.toContain('sk-test-secret-7890')
    expect(nextUserProfile).toContain('[已隐藏敏感凭据]')
  })

  it('lets the bootstrap turn create profile files, remove bootstrap.md, and enter history', async () => {
    const gateway = createPiSdkGateway({
      createSession: async (request) => {
        const handle = {
          prompts: [] as string[],
          prompt: async (prompt: string) => {
            handle.prompts.push(prompt)
            await writeFile(
              join(request.cwd, 'soul.md'),
              [
                '# Soul',
                '身份：汤圆是桌面端 Agent。',
                '用户偏好：优先中文。',
                '工作范围：协助工程任务。',
                '沟通方式：解释专业术语。',
                '权限边界：危险操作先确认。',
                '敏感信息规则：不记录密钥。',
                '记忆与技能原则：只记录长期偏好。',
                '不确定时的处理方式：先说明假设。',
              ].join('\n'),
              'utf8',
            )
            await writeFile(
              join(request.cwd, 'user.md'),
              [
                '# User',
                '称呼：用户。',
                '语言与语气偏好：中文，简洁。',
                '常见工作类型：代码实现。',
                '决策偏好：保守改动。',
                '需要先确认的事项：破坏性操作。',
                '禁止触碰的信息和边界：API Key。',
                '长期偏好：完整方法注释。',
              ].join('\n'),
              'utf8',
            )
            await rm(join(request.cwd, 'bootstrap.md'), { force: true })

            return '初始化完成。'
          },
          abort: async () => undefined,
          dispose: () => undefined,
        }
        gateway.sessionRequests.push(request)
        gateway.sessionHandles.push(handle)

        return handle
      },
    })
    const { driver, rootPath, homePath } = await createDriver({ gateway })
    const events: AgentEvent[] = []
    driver.subscribe((event) => {
      events.push(event)
    })

    await driver.getSnapshot()
    await driver.saveConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    const session = await driver.createSession({
      agentId: 'tangyuan',
      title: 'Bootstrap 初始化',
    })
    await driver.sendMessage({
      agentId: 'tangyuan',
      sessionId: session.sessionId,
      content: '请开始初始化。',
    })

    const resolvedHomePath = join(rootPath, homePath.slice(2))
    expect(gateway.sessionHandles[0]?.prompts[0]).toContain('# Bootstrap')
    expect(gateway.sessionHandles[0]?.prompts[0]).toContain(
      'soul.md 至少必须覆盖：身份、用户偏好、工作范围、沟通方式、权限边界、敏感信息规则、记忆与技能原则、不确定时的处理方式。',
    )
    expect(gateway.sessionHandles[0]?.prompts[0]).toContain(
      '完成后删除 bootstrap.md。',
    )
    await expect(
      readFile(join(resolvedHomePath, 'soul.md'), 'utf8'),
    ).resolves.toContain('身份：汤圆是桌面端 Agent。')
    await expect(
      readFile(join(resolvedHomePath, 'user.md'), 'utf8'),
    ).resolves.toContain('称呼：用户。')
    await expect(
      readFile(join(resolvedHomePath, 'bootstrap.md'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(driver.getSnapshot()).resolves.toMatchObject({
      activeAgent: {
        profile: {
          initialized: true,
          bootstrapRequired: false,
          soulUpdatedAt: expect.any(String),
          userUpdatedAt: expect.any(String),
        },
      },
    })
    await expect(driver.listSessions({ agentId: 'tangyuan' })).resolves.toEqual(
      [
        expect.objectContaining({
          sessionId: session.sessionId,
          title: 'Bootstrap 初始化',
          state: 'completed',
        }),
      ],
    )
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'profile-updated', target: 'soul' }),
        expect.objectContaining({ type: 'profile-updated', target: 'user' }),
      ]),
    )
  })

  it('blocks real session creation when configuration is missing', async () => {
    const { driver } = await createDriver()

    await expect(
      driver.createSession({
        agentId: 'tangyuan',
        title: '新会话',
      }),
    ).rejects.toMatchObject({
      code: 'configuration-missing',
      message: expect.stringContaining('创建会话前'),
    })
  })

  it('rejects messages whose agentId does not own the session', async () => {
    const gateway = createPiSdkGateway()
    const { driver } = await createDriver({ gateway })

    await driver.saveConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    const session = await driver.createSession({
      agentId: 'tangyuan',
      title: '新会话',
    })

    await expect(
      driver.sendMessage({
        agentId: 'other-agent',
        sessionId: session.sessionId,
        content: '你好',
      }),
    ).rejects.toMatchObject({
      code: 'session-not-found',
      message: expect.stringContaining('不属于 Agent other-agent'),
    })
  })
})

async function createDriver(options: { gateway?: PiSdkGateway } = {}) {
  const rootPath = await mkdtemp(join(tmpdir(), 'tangyuan-agent-runtime-'))
  const userDataPath = join(rootPath, 'Library/Application Support/Tangyuan')
  tempDirs.push(rootPath)

  return {
    driver: createDriverAtPath({
      rootPath,
      userDataPath,
      ...(options.gateway ? { gateway: options.gateway } : {}),
    }),
    rootPath,
    userDataPath,
    homePath: '~/.tangyuan/agents/tangyuan',
  }
}

/**
 * 写入已初始化的默认 profile 文件和历史目录，用于测试常规维护回合。
 *
 * @param resolvedHomePath - 已解析到临时文件系统里的 Agent Home 绝对路径。
 * @returns 无返回值。
 * @throws 当目录创建或文件写入失败时，Promise 会 reject。
 */
async function writeInitializedProfile(
  resolvedHomePath: string,
): Promise<void> {
  await import('node:fs/promises').then(async ({ mkdir }) => {
    await mkdir(join(resolvedHomePath, 'soul.history'), { recursive: true })
    await mkdir(join(resolvedHomePath, 'user.history'), { recursive: true })
  })
  await writeFile(
    join(resolvedHomePath, 'soul.md'),
    '# Soul\n只说中文。',
    'utf8',
  )
  await writeFile(
    join(resolvedHomePath, 'user.md'),
    '# User\n用户喜欢简洁回答。',
    'utf8',
  )
}

/**
 * 在指定目录创建 Driver，用于模拟应用重启后复用同一个 userData。
 *
 * @param options - Driver 需要复用的根目录、userData 路径和可选 SDK 网关。
 * @returns 指向同一持久化目录的新 PiSdkDriver。
 * @throws 此测试辅助方法不会主动抛出错误。
 */
function createDriverAtPath(options: {
  rootPath: string
  userDataPath: string
  gateway?: PiSdkGateway
}): PiSdkDriver {
  return new PiSdkDriver({
    fsRoot: options.rootPath,
    userDataPath: options.userDataPath,
    agentHomePath: '~/.tangyuan/agents/tangyuan',
    now: () => '2026-07-08T00:00:00.000Z',
    ...(options.gateway ? { gateway: options.gateway } : {}),
  })
}

/**
 * 创建 Pi SDK 网关测试替身，用于模拟真实 SDK 的配置验证。
 *
 * @param options - 可覆盖的验证行为。
 * @returns 记录调用参数的 PiSdkGateway。
 * @throws 此测试辅助方法不会主动抛出错误。
 */
function createPiSdkGateway(
  options: Partial<PiSdkGateway> = {},
): PiSdkGateway & {
  requests: PiSdkVerificationRequest[]
  sessionRequests: PiSdkCreateSessionRequest[]
  openSessionRequests: PiSdkOpenSessionRequest[]
  listSessionRequests: PiSdkListSessionsRequest[]
  readMessageRequests: PiSdkReadMessagesRequest[]
  sessionHandles: Array<PiSdkSessionHandle & { prompts: string[] }>
} {
  const requests: PiSdkVerificationRequest[] = []
  const sessionRequests: PiSdkCreateSessionRequest[] = []
  const openSessionRequests: PiSdkOpenSessionRequest[] = []
  const listSessionRequests: PiSdkListSessionsRequest[] = []
  const readMessageRequests: PiSdkReadMessagesRequest[] = []
  const sessionHandles: Array<PiSdkSessionHandle & { prompts: string[] }> = []

  return {
    requests,
    sessionRequests,
    openSessionRequests,
    listSessionRequests,
    readMessageRequests,
    sessionHandles,
    listProvidersAndModels: async () => ({
      providers: [{ providerId: 'anthropic', displayName: 'Anthropic' }],
      models: [
        {
          providerId: 'anthropic',
          modelId: 'claude-sonnet-4-5',
          displayName: 'Claude Sonnet 4.5',
        },
      ],
    }),
    verifyConfiguration: async (request) => {
      requests.push(request)
      await (options.verifyConfiguration?.(request) ?? Promise.resolve())
    },
    createSession: async (request) => {
      sessionRequests.push(request)
      const handle = createPromptingHandle(request.sessionId)
      sessionHandles.push(handle)

      return handle
    },
    openSession: async (request) => {
      openSessionRequests.push(request)
      const handle = createPromptingHandle(request.sessionId)
      sessionHandles.push(handle)

      return handle
    },
    listSessions: async (request) => {
      listSessionRequests.push(request)
      return []
    },
    readMessages: async (request) => {
      readMessageRequests.push(request)
      return []
    },
    ...options,
  }
}

/**
 * 创建能记录 prompt 并生成固定回复的 Pi SDK session handle。
 *
 * @param sessionId - 生成消息时使用的会话标识。
 * @param onMessages - 可选回调，用于模拟 SDK 自己持久化后的消息读取。
 * @returns 可发送 prompt 的测试 session handle。
 * @throws 此测试辅助方法不会主动抛出错误。
 */
function createPromptingHandle(
  sessionId: string,
  onMessages?: (messages: AgentMessage[]) => void,
): PiSdkSessionHandle & { prompts: string[] } {
  const prompts: string[] = []

  return {
    prompts,
    prompt: async (prompt: string) => {
      prompts.push(prompt)
      const userContent = prompt.split('# 用户消息').at(-1)?.trim() ?? prompt
      const messages: AgentMessage[] = [
        {
          messageId: `${sessionId}-sdk-user-1`,
          agentId: 'tangyuan',
          sessionId,
          role: 'user',
          content: userContent,
          createdAt: '2026-07-08T00:00:00.000Z',
        },
        {
          messageId: `${sessionId}-sdk-agent-1`,
          agentId: 'tangyuan',
          sessionId,
          role: 'agent',
          content: `收到：${userContent}`,
          createdAt: '2026-07-08T00:00:00.000Z',
        },
      ]
      onMessages?.(messages)

      return `收到：${userContent}`
    },
    abort: async () => undefined,
    dispose: () => undefined,
  }
}

/**
 * 读取测试 JSON 文件并解析为未知对象。
 *
 * @param path - 需要读取的 JSON 文件路径。
 * @returns 解析后的 JSON 数据。
 * @throws 当文件不存在或 JSON 无法解析时，Promise 会 reject。
 */
async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown
}

/**
 * 创建可手动 resolve 的 Promise，用于控制 Driver 并发测试。
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
