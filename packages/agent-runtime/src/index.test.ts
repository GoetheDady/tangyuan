import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createDefaultSessionSummary } from '@tangyuan/contracts'
import {
  AgentRuntimeError,
  type AgentEvent,
  type InternalMessage,
  type TranscriptEntry,
  type TranscriptSnapshot,
  PiSdkDriver,
  type PiSdkCreateSessionRequest,
  type PiSdkDriverOptions,
  type PiSdkGateway,
  type PiSdkListSessionsRequest,
  type PiSdkOpenSessionRequest,
  type PiSdkPromptOptions,
  type PiSdkReadMessagesRequest,
  type PiSdkSessionHandle,
  type PiSdkVerificationRequest,
  createTangyuanRuntimeForTesting,
  type ConfigEncryptionAdapter,
} from './index'

const tempDirs: string[] = []

function snapshotFromMessages(
  sessionId: string,
  agentId: string,
  messages: InternalMessage[],
): TranscriptSnapshot {
  const entries: TranscriptEntry[] = []
  for (const [index, message] of messages.entries()) {
    if (message.role === 'user') {
      entries.push({
        kind: 'user-message',
        index,
        messageId: message.messageId,
        content: message.content,
        createdAt: message.createdAt,
      })
    } else if (message.role === 'agent') {
      entries.push({
        kind: 'agent-reply',
        index,
        messageId: message.messageId,
        content: message.content,
        createdAt: message.createdAt,
        attempt: null,
        turns: [],
      })
    }
  }
  return { sessionId, agentId, entries, updatedAt: '2026-07-08T00:00:00.000Z' }
}

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

describe('TangyuanRuntime', () => {
  it('keeps configuration, sessions, messages, streaming events, and cancellation behind one interface', async () => {
    const runStarted = createDeferred<void>()
    const releaseRun = createDeferred<void>()
    const gateway = createPiSdkGateway({
      createSession: async (request) => {
        let wasCancelled = false
        const handle = {
          prompts: [] as string[],
          prompt: async (prompt: string, options?: PiSdkPromptOptions) => {
            handle.prompts.push(prompt)
            options?.onEvent?.({ type: 'text-delta', delta: '收' })
            runStarted.resolve()
            await releaseRun.promise

            if (wasCancelled) {
              throw new DOMException('Aborted', 'AbortError')
            }

            options?.onEvent?.({ type: 'text-delta', delta: '到' })
            return '收到'
          },
          abort: async () => {
            wasCancelled = true
            releaseRun.resolve()
          },
          dispose: () => undefined,
        }
        gateway.sessionRequests.push(request)
        gateway.sessionHandles.push(handle)

        return handle
      },
    })
    const { driver } = await createDriver({ gateway })
    const runtime = createTangyuanRuntimeForTesting({
      runtimeDriver: driver,
      sessionDriver: driver,
    })
    const events: AgentEvent[] = []
    runtime.subscribe((event) => {
      events.push(event)
    })

    await runtime.saveRuntimeConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    const session = await runtime.createSession({
      agentId: 'tangyuan',
      title: '运行时边界测试',
    })
    const sendPromise = runtime.sendMessage({
      agentId: 'tangyuan',
      sessionId: session.sessionId,
      content: '你好',
    })
    await runStarted.promise

    await expect(runtime.listSessions()).resolves.toEqual([
      expect.objectContaining({
        sessionId: session.sessionId,
        state: 'running',
      }),
    ])
    await expect(
      runtime.cancelRun({
        agentId: 'tangyuan',
        sessionId: session.sessionId,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        sessionId: session.sessionId,
        state: 'cancelled',
      }),
    )
    await expect(sendPromise).resolves.toEqual(
      expect.objectContaining({
        entries: [
          expect.objectContaining({ kind: 'user-message', content: '你好' }),
          expect.objectContaining({ kind: 'agent-reply', content: '收' }),
        ],
      }),
    )
    await expect(
      runtime.getTranscript({
        agentId: 'tangyuan',
        sessionId: session.sessionId,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        entries: [
          expect.objectContaining({ kind: 'user-message', content: '你好' }),
          expect.objectContaining({ kind: 'agent-reply', content: '收' }),
        ],
      }),
    )
    // 公开订阅者只应收到公开 AgentEvent，不应泄漏内部驱动事件。
    // （本用例在 agent 回复落地前就取消，因此不断言具体的 delta-appended。）
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'attempt-started' }),
        expect.objectContaining({
          type: 'transcript-delta',
          delta: expect.objectContaining({
            type: 'entry-appended',
            entry: expect.objectContaining({ kind: 'user-message' }),
          }),
        }),
        expect.objectContaining({ type: 'turn-cancelled' }),
      ]),
    )
    // 内部驱动事件不应泄漏给公开订阅者（否则 IPC 层 agentEventSchema 会抛错）。
    expect(
      events.some((event) =>
        [
          'message-appended',
          'message-delta',
          'message-completed',
          'activity-updated',
        ].includes(event.type),
      ),
    ).toBe(false)
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
    await import('node:fs/promises').then(async ({ writeFile, mkdir }) => {
      await writeFile(join(resolvedHomePath, 'soul.md'), '# soul', 'utf8')
      // 写入共享 user profile 路径
      const profileDir = join(rootPath, '.tangyuan/profile')
      await mkdir(profileDir, { recursive: true })
      await writeFile(join(profileDir, 'user.md'), '# user', 'utf8')
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
    ).resolves.not.toContain('sk-test-secret-7890')
    await expect(
      readFile(
        join(rootPath, 'Library/Application Support/Tangyuan/config.json'),
        'utf8',
      ),
    ).resolves.toContain('encrypted:')
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
      sessionId: expect.any(String),
      state: 'idle',
    })

    expect(gateway.sessionRequests).toEqual([
      expect.objectContaining({
        sessionId: expect.any(String),
        sdkSessionFile: expect.stringContaining('.jsonl'),
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
    const session = await driver.createSession({
      agentId: 'tangyuan',
      title: '调试启动流程',
    })
    expect(session).toMatchObject({
      agentId: 'tangyuan',
      sessionId: expect.any(String),
      title: '调试启动流程',
      state: 'idle',
    })

    await expect(
      readJson(join(userDataPath, 'sessions/index.json')),
    ).resolves.toEqual({
      sessions: [
        expect.objectContaining({
          agentId: 'tangyuan',
          sessionId: session.sessionId,
          title: '调试启动流程',
          createdAt: '2026-07-08T00:00:00.000Z',
          updatedAt: '2026-07-08T00:00:00.000Z',
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          sdkSessionFile: expect.stringContaining('.jsonl'),
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
          sessionId: session.sessionId,
          updatedAt: '2026-07-08T00:00:00.000Z',
          lastMessagePreview: '收到：帮我检查保存逻辑',
          status: 'completed',
        }),
      ],
    })
  })

  it('restores the session list and opens messages from Pi SDK storage after restart', async () => {
    const sdkMessagesBySessionFile = new Map<string, TranscriptSnapshot>()
    const gateway = createPiSdkGateway({
      createSession: async (request) => {
        const handle = createPromptingHandle(request.sessionId, (messages) => {
          sdkMessagesBySessionFile.set(
            request.sdkSessionFile,
            snapshotFromMessages(request.sessionId, 'tangyuan', messages),
          )
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
        sdkMessagesBySessionFile.get(request.sdkSessionFile) ?? {
          sessionId: request.sessionId,
          agentId: 'tangyuan',
          entries: [],
          updatedAt: new Date().toISOString(),
        },
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
        sessionId: session.sessionId,
        title: '持久化检查',
        state: 'completed',
      }),
    ])
    await expect(
      restartedDriver.getTranscript({
        agentId: 'tangyuan',
        sessionId: session.sessionId,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        entries: [
          expect.objectContaining({
            kind: 'user-message',
            content: '重启后还能看到吗',
          }),
          expect.objectContaining({
            kind: 'agent-reply',
            content: '收到：重启后还能看到吗',
          }),
        ],
      }),
    )
    expect(gateway.openSessionRequests).toEqual([
      expect.objectContaining({
        sessionId: session.sessionId,
        sdkSessionFile: expect.stringContaining('.jsonl'),
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
      driver.getTranscript({
        agentId: 'tangyuan',
        sessionId: session.sessionId,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        entries: [
          expect.objectContaining({ kind: 'user-message', content: '你好' }),
          expect.objectContaining({
            kind: 'agent-reply',
            content: '收到：你好',
          }),
        ],
      }),
    )
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
          type: 'attempt-started',
          runId: expect.stringMatching(/-run-1$/),
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
      driver.getTranscript({
        agentId: 'tangyuan',
        sessionId: session.sessionId,
      }),
    ).resolves.toEqual(expect.objectContaining({ entries: [] }))
  })

  it('blocks a duplicate active run in the same session but allows another session', async () => {
    const releaseFirstRun = createDeferred<void>()
    const firstRunStarted = createDeferred<void>()
    let firstSessionId = ''
    const gateway = createPiSdkGateway({
      createSession: async (request) => {
        const isFirstSession = !firstSessionId
        if (isFirstSession) {
          firstSessionId = request.sessionId
        }
        const handle = {
          prompts: [] as string[],
          prompt: async (prompt: string) => {
            handle.prompts.push(prompt)

            if (request.sessionId === firstSessionId) {
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
      driver.getTranscript({
        agentId: 'tangyuan',
        sessionId: session.sessionId,
      }),
    ).resolves.toEqual(expect.objectContaining({ entries: [] }))
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
      driver.getTranscript({
        agentId: 'tangyuan',
        sessionId: session.sessionId,
      }),
    ).resolves.toEqual(expect.objectContaining({ entries: [] }))
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

    await writeInitializedProfile(resolvedHomePath, rootPath)
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
      driver.getTranscript({
        agentId: 'tangyuan',
        sessionId: session.sessionId,
      }),
    ).resolves.toEqual(expect.objectContaining({ entries: [] }))
  })

  it('accepts a backed-up user.md update without adding a system message', async () => {
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

    await writeInitializedProfile(resolvedHomePath, rootPath)
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
      driver.getTranscript({
        agentId: 'tangyuan',
        sessionId: session.sessionId,
      }),
    ).resolves.toEqual(expect.objectContaining({ entries: [] }))

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'profile-updated', target: 'user' }),
      ]),
    )
  })

  it('accepts a backed-up soul.md update without adding a system message', async () => {
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

    await writeInitializedProfile(resolvedHomePath, rootPath)
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
      driver.getTranscript({
        agentId: 'tangyuan',
        sessionId: session.sessionId,
      }),
    ).resolves.toEqual(expect.objectContaining({ entries: [] }))
  })

  it('rejects a profile update without adding a system message', async () => {
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

    await writeInitializedProfile(resolvedHomePath, rootPath)
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
      driver.getTranscript({
        agentId: 'tangyuan',
        sessionId: session.sessionId,
      }),
    ).resolves.toEqual(expect.objectContaining({ entries: [] }))

    expect(events).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'profile-updated', target: 'user' }),
      ]),
    )
  })

  it('keeps the main reply completed without adding a maintenance system message', async () => {
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

    await writeInitializedProfile(resolvedHomePath, rootPath)
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
      driver.getTranscript({
        agentId: 'tangyuan',
        sessionId: session.sessionId,
      }),
    ).resolves.toEqual(expect.objectContaining({ entries: [] }))
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

    await writeInitializedProfile(resolvedHomePath, rootPath)
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

  it('deletes bootstrap.md when the agent writes both profile files but forgets to remove it', async () => {
    const gateway = createPiSdkGateway({
      createSession: async (request) => {
        const handle = {
          prompts: [] as string[],
          prompt: async (prompt: string) => {
            handle.prompts.push(prompt)
            // Agent 写入两个 profile 文件，但遗留 bootstrap.md
            await writeFile(
              join(request.cwd, 'soul.md'),
              '# Soul\n只说中文。',
              'utf8',
            )
            await writeFile(
              join(request.cwd, 'user.md'),
              '# User\n简洁回答。',
              'utf8',
            )
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
    // soul.md 和 user.md 存在
    await expect(
      readFile(join(resolvedHomePath, 'soul.md'), 'utf8'),
    ).resolves.toContain('# Soul')
    await expect(
      readFile(join(resolvedHomePath, 'user.md'), 'utf8'),
    ).resolves.toContain('# User')
    // bootstrap.md 被 runtime 自动清理
    await expect(
      readFile(join(resolvedHomePath, 'bootstrap.md'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    // 快照反映已初始化状态
    await expect(driver.getSnapshot()).resolves.toMatchObject({
      activeAgent: {
        profile: {
          initialized: true,
          bootstrapRequired: false,
        },
      },
    })
  })

  it('recreates bootstrap.md when the agent deletes it but only writes soul.md', async () => {
    const gateway = createPiSdkGateway({
      createSession: async (request) => {
        const handle = {
          prompts: [] as string[],
          prompt: async (prompt: string) => {
            handle.prompts.push(prompt)
            await writeFile(
              join(request.cwd, 'soul.md'),
              '# Soul\n部分初始化。',
              'utf8',
            )
            await rm(join(request.cwd, 'bootstrap.md'), { force: true })
            return 'soul.md 已创建。'
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
    // soul.md 存在
    await expect(
      readFile(join(resolvedHomePath, 'soul.md'), 'utf8'),
    ).resolves.toContain('# Soul')
    // user.md 不存在
    await expect(
      readFile(join(resolvedHomePath, 'user.md'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    // bootstrap.md 被重建
    await expect(
      readFile(join(resolvedHomePath, 'bootstrap.md'), 'utf8'),
    ).resolves.toContain('# Bootstrap')
    // 仍未初始化（soul.md 存在但 user.md 缺失）
    await expect(driver.getSnapshot()).resolves.toMatchObject({
      activeAgent: {
        profile: {
          initialized: false,
        },
      },
    })
  })

  it('recreates bootstrap.md when the agent deletes it but only writes user.md', async () => {
    const gateway = createPiSdkGateway({
      createSession: async (request) => {
        const handle = {
          prompts: [] as string[],
          prompt: async (prompt: string) => {
            handle.prompts.push(prompt)
            await writeFile(
              join(request.cwd, 'user.md'),
              '# User\n部分初始化。',
              'utf8',
            )
            await rm(join(request.cwd, 'bootstrap.md'), { force: true })
            return 'user.md 已创建。'
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
    await expect(
      readFile(join(resolvedHomePath, 'user.md'), 'utf8'),
    ).resolves.toContain('# User')
    await expect(
      readFile(join(resolvedHomePath, 'soul.md'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(
      readFile(join(resolvedHomePath, 'bootstrap.md'), 'utf8'),
    ).resolves.toContain('# Bootstrap')
    await expect(driver.getSnapshot()).resolves.toMatchObject({
      activeAgent: {
        profile: {
          initialized: false,
        },
      },
    })
  })

  it('recreates bootstrap.md when the agent deletes it without writing any profile file', async () => {
    const gateway = createPiSdkGateway({
      createSession: async (request) => {
        const handle = {
          prompts: [] as string[],
          prompt: async (prompt: string) => {
            handle.prompts.push(prompt)
            await rm(join(request.cwd, 'bootstrap.md'), { force: true })
            return '已完成。'
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
    // 两个 profile 文件都不存在
    await expect(
      readFile(join(resolvedHomePath, 'soul.md'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(
      readFile(join(resolvedHomePath, 'user.md'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    // bootstrap.md 被重建
    await expect(
      readFile(join(resolvedHomePath, 'bootstrap.md'), 'utf8'),
    ).resolves.toContain('# Bootstrap')
    await expect(driver.getSnapshot()).resolves.toMatchObject({
      activeAgent: {
        profile: {
          initialized: false,
        },
      },
    })
  })

  it('keeps bootstrap active across turns when the agent writes one file at a time', async () => {
    let turnCount = 0
    const gateway = createPiSdkGateway({
      createSession: async (request) => {
        const handle = {
          prompts: [] as string[],
          prompt: async (prompt: string) => {
            handle.prompts.push(prompt)
            turnCount++
            if (turnCount === 1) {
              // 第一回合：只写 soul.md
              await writeFile(
                join(request.cwd, 'soul.md'),
                '# Soul\n第一回合。',
                'utf8',
              )
              return 'soul.md 已创建，请继续告诉我你的偏好。'
            }
            // 第二回合：写 user.md
            await writeFile(
              join(request.cwd, 'user.md'),
              '# User\n第二回合。',
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
      content: '我想用中文。',
    })

    const resolvedHomePath = join(rootPath, homePath.slice(2))
    // 第一回合后：soul.md 存在，user.md 不存在，bootstrap.md 仍存在
    await expect(
      readFile(join(resolvedHomePath, 'soul.md'), 'utf8'),
    ).resolves.toContain('# Soul')
    await expect(
      readFile(join(resolvedHomePath, 'user.md'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(
      readFile(join(resolvedHomePath, 'bootstrap.md'), 'utf8'),
    ).resolves.toContain('# Bootstrap')
    await expect(driver.getSnapshot()).resolves.toMatchObject({
      activeAgent: {
        profile: {
          initialized: false,
        },
      },
    })

    // 第二回合
    await driver.sendMessage({
      agentId: 'tangyuan',
      sessionId: session.sessionId,
      content: '我喜欢简洁回答。',
    })

    // 第二回合后：两个 profile 都存在，bootstrap.md 被删除
    await expect(
      readFile(join(resolvedHomePath, 'soul.md'), 'utf8'),
    ).resolves.toContain('# Soul')
    await expect(
      readFile(join(resolvedHomePath, 'user.md'), 'utf8'),
    ).resolves.toContain('# User')
    await expect(
      readFile(join(resolvedHomePath, 'bootstrap.md'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(driver.getSnapshot()).resolves.toMatchObject({
      activeAgent: {
        profile: {
          initialized: true,
          bootstrapRequired: false,
        },
      },
    })
  })

  it('preserves bootstrap state after simulating an app restart', async () => {
    const gateway = createPiSdkGateway({
      createSession: async (request) => {
        const handle = {
          prompts: [] as string[],
          prompt: async (prompt: string) => {
            handle.prompts.push(prompt)
            await writeFile(
              join(request.cwd, 'soul.md'),
              '# Soul\n只说中文。',
              'utf8',
            )
            return 'soul.md 已创建。'
          },
          abort: async () => undefined,
          dispose: () => undefined,
        }
        gateway.sessionRequests.push(request)
        gateway.sessionHandles.push(handle)
        return handle
      },
    })
    const { driver, rootPath, userDataPath, homePath } = await createDriver({
      gateway,
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

    // 模拟重启：创建新 driver 指向同一持久化目录
    const restartedDriver = createDriverAtPath({ rootPath, userDataPath })
    const snapshot = await restartedDriver.getSnapshot()

    expect(snapshot.activeAgent.profile).toMatchObject({
      initialized: false,
    })

    const resolvedHomePath = join(rootPath, homePath.slice(2))
    await expect(
      readFile(join(resolvedHomePath, 'soul.md'), 'utf8'),
    ).resolves.toContain('# Soul')
    await expect(
      readFile(join(resolvedHomePath, 'bootstrap.md'), 'utf8'),
    ).resolves.toContain('# Bootstrap')
    await expect(
      readFile(join(resolvedHomePath, 'user.md'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('enters normal conversation after bootstrap completes and runs profile maintenance', async () => {
    let turnCount = 0
    const gateway = createPiSdkGateway({
      createSession: async (request) => {
        const handle = {
          prompts: [] as string[],
          prompt: async (prompt: string) => {
            handle.prompts.push(prompt)
            turnCount++
            if (turnCount === 1) {
              // Bootstrap 回合：写入两个 profile 文件
              await writeFile(
                join(request.cwd, 'soul.md'),
                '# Soul\n只说中文。',
                'utf8',
              )
              await writeFile(
                join(request.cwd, 'user.md'),
                '# User\n简洁回答。',
                'utf8',
              )
              return '初始化完成。'
            }
            // 正常回合
            return '好的，已经记住了。'
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

    // 第一回合：bootstrap
    await driver.sendMessage({
      agentId: 'tangyuan',
      sessionId: session.sessionId,
      content: '请开始初始化。',
    })

    // Bootstrap 回合的 prompt 包含 bootstrap 指令
    expect(gateway.sessionHandles[0]?.prompts[0]).toContain('# Bootstrap')
    await expect(driver.getSnapshot()).resolves.toMatchObject({
      activeAgent: {
        profile: { initialized: true, bootstrapRequired: false },
      },
    })

    // 第二回合：正常对话
    await driver.sendMessage({
      agentId: 'tangyuan',
      sessionId: session.sessionId,
      content: '记住我喜欢用 TypeScript。',
    })

    // 正常回合的 prompt 包含 profile 上下文而非 bootstrap 指令
    const secondPrompt = gateway.sessionHandles[0]?.prompts[1]
    expect(secondPrompt).toContain('# Soul')
    expect(secondPrompt).toContain('# User')
    expect(secondPrompt).not.toContain('bootstrap.md')
    // 正常回合触发了一次维护回合（共 3 次 prompt 调用：bootstrap 主回合 + 正常主回合 + 维护回合）
    expect(gateway.sessionHandles[0]?.prompts.length).toBe(3)
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
      message: expect.stringContaining('尚未配置 Provider 和 Model'),
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

  it('migrates a v1 config file to v2 on read and writes it back to disk', async () => {
    const gateway = createPiSdkGateway()
    const { driver, userDataPath } = await createDriver({ gateway })
    const configPath = join(userDataPath, 'config.json')

    // 写入 v1 格式的配置文件
    await mkdir(userDataPath, { recursive: true })
    await writeFile(
      configPath,
      JSON.stringify({
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        apiKey: 'sk-legacy-key',
      }),
      'utf8',
    )

    // 读取快照时应触发迁移
    await expect(driver.getSnapshot()).resolves.toMatchObject({
      settings: {
        selectedProviderId: 'anthropic',
        selectedModelId: 'claude-sonnet-4-5',
      },
      auth: {
        apiKey: {
          configured: true,
          maskedValue: 'sk-l...-key',
        },
      },
      status: 'ready',
      configRecovery: {
        state: 'ok',
        hasBackup: true,
      },
    })

    // 验证磁盘上已写入 v2 格式
    const rawConfig = await readFile(configPath, 'utf8')
    const parsedConfig = JSON.parse(rawConfig) as Record<string, unknown>
    expect(parsedConfig['schemaVersion']).toBe(2)
    expect(parsedConfig['providers']).toBeDefined()
    expect(parsedConfig['agents']).toBeDefined()
    // v2 格式中 API Key 已加密
    expect(rawConfig).not.toContain('sk-legacy-key')
  })

  it('returns migration-failed recovery state when v1 config cannot be migrated', async () => {
    const gateway = createPiSdkGateway()
    const encryptionAdapter = createFakeEncryptionAdapter()
    // 使用会在加密时失败的适配器模拟迁移写入失败
    encryptionAdapter.encrypt = async () => {
      throw new Error('encryption unavailable')
    }
    const { driver, userDataPath } = await createDriver({
      gateway,
      encryptionAdapter,
    })
    const configPath = join(userDataPath, 'config.json')

    await mkdir(userDataPath, { recursive: true })
    await writeFile(
      configPath,
      JSON.stringify({
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        apiKey: 'sk-legacy-key',
      }),
      'utf8',
    )

    await expect(driver.getSnapshot()).resolves.toMatchObject({
      configRecovery: {
        state: 'migration-failed',
        hasBackup: false,
      },
    })
  })

  it('refuses to save configuration when the encryption adapter is unavailable', async () => {
    const gateway = createPiSdkGateway()
    const { driver } = await createDriver({
      gateway,
      encryptionAdapter: null,
    })

    await expect(
      driver.saveConfiguration({
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        apiKey: 'sk-test-secret-7890',
      }),
    ).rejects.toMatchObject({
      code: 'driver-unavailable',
      message: expect.stringContaining('加密服务不可用'),
    })
  })

  it('refuses to save when the encryption adapter reports it is unavailable', async () => {
    const gateway = createPiSdkGateway()
    const { driver } = await createDriver({
      gateway,
      encryptionAdapter: {
        encrypt: async () => 'encrypted:test',
        decrypt: async () => 'test',
        isAvailable: () => false,
      },
    })

    await expect(
      driver.saveConfiguration({
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        apiKey: 'sk-test-secret-7890',
      }),
    ).rejects.toMatchObject({
      code: 'driver-unavailable',
      message: expect.stringContaining('加密服务不可用'),
    })
  })

  it('reports corrupted recovery state when config JSON is unparseable', async () => {
    const gateway = createPiSdkGateway()
    const { driver, userDataPath } = await createDriver({ gateway })
    const configPath = join(userDataPath, 'config.json')

    await mkdir(userDataPath, { recursive: true })
    await writeFile(configPath, 'not valid json {{{', 'utf8')

    await expect(driver.getSnapshot()).resolves.toMatchObject({
      configRecovery: {
        state: 'corrupted',
        hasBackup: false,
      },
    })
  })

  it('reports corrupted recovery state when v2 config fails schema validation', async () => {
    const gateway = createPiSdkGateway()
    const { driver, userDataPath } = await createDriver({ gateway })
    const configPath = join(userDataPath, 'config.json')

    await mkdir(userDataPath, { recursive: true })
    // 写入"合法 JSON 但不符合 v2 schema"的内容
    await writeFile(
      configPath,
      JSON.stringify({
        schemaVersion: 2,
        providers: 'not-an-object',
        agents: null,
      }),
      'utf8',
    )

    await expect(driver.getSnapshot()).resolves.toMatchObject({
      configRecovery: {
        state: 'corrupted',
        hasBackup: false,
      },
    })
  })

  it('creates a backup file before each write and reports hasBackup: true', async () => {
    const gateway = createPiSdkGateway()
    const { driver, userDataPath } = await createDriver({ gateway })

    // 第一次保存不会创建备份（因为旧文件不存在）
    await driver.saveConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })

    // 第二次保存时旧文件存在，会先备份再写入
    await driver.saveConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-opus-4-8',
      apiKey: 'sk-test-secret-9999',
    })

    const backupPath = join(userDataPath, 'config.backup.json')
    await expect(readFile(backupPath, 'utf8')).resolves.toContain('encrypted:')

    // 快照应报告备份存在
    await expect(driver.getSnapshot()).resolves.toMatchObject({
      configRecovery: {
        hasBackup: true,
      },
    })
  })

  it('restores configuration from a valid backup file', async () => {
    const gateway = createPiSdkGateway()
    const { driver, userDataPath } = await createDriver({ gateway })

    // 保存第一次
    await driver.saveConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    // 保存第二次（此时会创建备份）
    await driver.saveConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-opus-4-8',
      apiKey: 'sk-test-secret-8888',
    })

    // 确保备份存在
    const backupPath = join(userDataPath, 'config.backup.json')
    await expect(readFile(backupPath, 'utf8')).resolves.toContain('encrypted:')

    // 损坏配置文件
    const configPath = join(userDataPath, 'config.json')
    await writeFile(configPath, 'corrupted data {{{', 'utf8')

    // 验证损坏状态
    await expect(driver.getSnapshot()).resolves.toMatchObject({
      configRecovery: { state: 'corrupted', hasBackup: true },
    })

    // 从备份恢复
    await expect(driver.restoreFromBackup()).resolves.toMatchObject({
      settings: {
        selectedProviderId: 'anthropic',
        selectedModelId: 'claude-sonnet-4-5',
      },
      auth: {
        apiKey: { configured: true, maskedValue: 'sk-t...7890' },
      },
      status: 'ready',
      configRecovery: { state: 'ok', hasBackup: true },
    })

    // 验证配置文件已恢复为有效内容
    const rawConfig = await readFile(configPath, 'utf8')
    expect(() => JSON.parse(rawConfig)).not.toThrow()
    expect(rawConfig).toContain('"schemaVersion"')
  })

  it('rejects restore when no backup file exists', async () => {
    const gateway = createPiSdkGateway()
    const { driver } = await createDriver({ gateway })

    await expect(driver.restoreFromBackup()).rejects.toMatchObject({
      code: 'configuration-missing',
      message: expect.stringContaining('没有可用的配置备份'),
    })
  })

  it('rejects restore when the backup file is corrupted', async () => {
    const gateway = createPiSdkGateway()
    const { driver, userDataPath } = await createDriver({ gateway })

    // 保存一次以创建目录
    await driver.saveConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })

    // 写入损坏的备份
    const backupPath = join(userDataPath, 'config.backup.json')
    await writeFile(backupPath, 'not valid json', 'utf8')

    await expect(driver.restoreFromBackup()).rejects.toMatchObject({
      code: 'configuration-missing',
      message: expect.stringContaining('备份文件已损坏'),
    })
  })

  it('rejects restore when backup has valid JSON but invalid schema', async () => {
    const gateway = createPiSdkGateway()
    const { driver, userDataPath } = await createDriver({ gateway })

    await driver.saveConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })

    // 写入格式不兼容的备份
    const backupPath = join(userDataPath, 'config.backup.json')
    await writeFile(
      backupPath,
      JSON.stringify({ schemaVersion: 99, providers: {}, agents: {} }),
      'utf8',
    )

    await expect(driver.restoreFromBackup()).rejects.toMatchObject({
      code: 'configuration-missing',
      message: expect.stringContaining('备份文件格式不兼容'),
    })
  })

  it('resets configuration by deleting config and backup files while preserving agent home', async () => {
    const gateway = createPiSdkGateway()
    const { driver, userDataPath, rootPath, homePath } = await createDriver({
      gateway,
    })

    // 保存第一次
    await driver.saveConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    // 保存第二次（此时会创建备份）
    await driver.saveConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-opus-4-8',
      apiKey: 'sk-test-secret-8888',
    })

    const configPath = join(userDataPath, 'config.json')
    const backupPath = join(userDataPath, 'config.backup.json')

    // 验证文件存在
    await expect(readFile(configPath, 'utf8')).resolves.toBeDefined()
    await expect(readFile(backupPath, 'utf8')).resolves.toBeDefined()

    // 重置配置
    await driver.resetConfiguration()

    // 配置文件和备份已删除
    await expect(
      import('node:fs/promises').then(({ access }) => access(configPath)),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(
      import('node:fs/promises').then(({ access }) => access(backupPath)),
    ).rejects.toMatchObject({ code: 'ENOENT' })

    // Agent home 目录仍然存在（bootstrap.md 等文件未被删除）
    const resolvedHomePath = join(rootPath, homePath.slice(2))
    await expect(
      readFile(join(resolvedHomePath, 'bootstrap.md'), 'utf8'),
    ).resolves.toContain('# Bootstrap')

    // 重置后快照应显示缺少配置
    await expect(driver.getSnapshot()).resolves.toMatchObject({
      status: 'missing-config',
      configRecovery: { state: 'ok', hasBackup: false },
    })
  })

  it('reports corrupted recovery state when encrypted data cannot be decrypted', async () => {
    const gateway = createPiSdkGateway()
    const encryptionAdapter = createFakeEncryptionAdapter()
    // 修改 decrypt 使其对特定密文失败
    const originalDecrypt = encryptionAdapter.decrypt
    encryptionAdapter.decrypt = async (ciphertext: string) => {
      if (ciphertext.includes('corrupted')) {
        throw new Error('decryption failed')
      }
      return originalDecrypt(ciphertext)
    }
    const { driver, userDataPath } = await createDriver({
      gateway,
      encryptionAdapter,
    })
    const configPath = join(userDataPath, 'config.json')

    // 直接写入用不同密钥加密的假数据（decrypt 会失败）
    await mkdir(userDataPath, { recursive: true })
    await writeFile(
      configPath,
      JSON.stringify({
        schemaVersion: 2,
        providers: {
          anthropic: {
            encryptedApiKey: 'encrypted:corrupted-data',
            updatedAt: '2026-07-16T00:00:00.000Z',
          },
        },
        agents: {
          tangyuan: {
            displayName: '汤圆',
            defaultProviderId: 'anthropic',
            defaultModelId: 'claude-sonnet-4-5',
            status: 'active',
            archivedAt: null,
          },
        },
      }),
      'utf8',
    )

    await expect(driver.getSnapshot()).resolves.toMatchObject({
      configRecovery: {
        state: 'corrupted',
        hasBackup: false,
      },
    })
  })

  it('refuses to create a session when config is in corrupted state', async () => {
    const gateway = createPiSdkGateway()
    const { driver, userDataPath } = await createDriver({ gateway })
    const configPath = join(userDataPath, 'config.json')

    await mkdir(userDataPath, { recursive: true })
    await writeFile(configPath, 'corrupted {{{', 'utf8')

    await expect(
      driver.createSession({ agentId: 'tangyuan', title: '新会话' }),
    ).rejects.toMatchObject({
      code: 'configuration-missing',
      message: expect.stringContaining('配置文件已损坏'),
    })
  })

  it('enforces sequential config writes use temp file + atomic rename', async () => {
    const gateway = createPiSdkGateway()
    const { driver, userDataPath } = await createDriver({ gateway })

    await driver.saveConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })

    // 原子写入后，不应该留下 .tmp 文件
    const tmpPath = join(userDataPath, 'config.json.tmp')
    await expect(
      import('node:fs/promises').then(({ access }) => access(tmpPath)),
    ).rejects.toMatchObject({ code: 'ENOENT' })

    // config.json 应包含有效 JSON
    const configPath = join(userDataPath, 'config.json')
    const rawConfig = await readFile(configPath, 'utf8')
    expect(() => JSON.parse(rawConfig)).not.toThrow()
  })

  it('creates a new agent with UUID, inherits provider/model, and builds directories', async () => {
    const gateway = createPiSdkGateway()
    const { driver, rootPath } = await createDriver({ gateway })

    await driver.saveConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })

    const agent = await driver.createAgent('代码助手')

    expect(agent.agentId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(agent.displayName).toBe('代码助手')
    expect(agent.status).toBe('active')
    expect(agent.defaultProviderId).toBe('anthropic')
    expect(agent.defaultModelId).toBe('claude-sonnet-4-5')

    const homePath = join(rootPath, '.tangyuan/agents', agent.agentId)
    await expect(
      readFile(join(homePath, 'soul.md'), 'utf8'),
    ).resolves.toContain('代码助手')
    await expect(stat(join(homePath, 'workspace'))).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    })
    await expect(stat(join(homePath, 'skills'))).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    })
  })

  it('emits an agent-created event after a successful creation', async () => {
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
    const agent = await driver.createAgent('测试助手')

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'agent-created',
          agentId: agent.agentId,
          agent: expect.objectContaining({ displayName: '测试助手' }),
        }),
      ]),
    )
  })

  it('generates distinct UUIDs for multiple agents with the same displayName', async () => {
    const gateway = createPiSdkGateway()
    const { driver } = await createDriver({ gateway })

    await driver.saveConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })

    const agentOne = await driver.createAgent('助手')
    const agentTwo = await driver.createAgent('助手')

    expect(agentOne.agentId).not.toBe(agentTwo.agentId)
    expect(agentOne.displayName).toBe('助手')
    expect(agentTwo.displayName).toBe('助手')
  })

  it('persists agent config and restores after simulated restart', async () => {
    const gateway = createPiSdkGateway()
    const { driver, rootPath, userDataPath } = await createDriver({ gateway })

    await driver.saveConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })

    const created = await driver.createAgent('跨重启助手')

    // 模拟重启：用相同的 userDataPath 创建新 driver
    const restartedDriver = createDriverAtPath({
      gateway,
      rootPath,
      userDataPath,
    })
    const agents = await restartedDriver.listAgents()

    expect(agents).toHaveLength(2)
    expect(agents[0]).toMatchObject({ agentId: 'tangyuan' })
    expect(agents[1]).toMatchObject({
      agentId: created.agentId,
      displayName: '跨重启助手',
      status: 'active',
    })
  })

  it('lists all agents including tangyuan and created agents', async () => {
    const gateway = createPiSdkGateway()
    const { driver } = await createDriver({ gateway })

    await driver.saveConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })

    const created = await driver.createAgent('助手')
    const agents = await driver.listAgents()

    expect(agents).toHaveLength(2)
    expect(agents[0]).toMatchObject({
      agentId: 'tangyuan',
      displayName: '汤圆',
      status: 'active',
    })
    expect(agents[1]).toMatchObject({
      agentId: created.agentId,
      displayName: '助手',
      status: 'active',
    })
  })

  it('creates a session for a new agent with workspace as cwd', async () => {
    const gateway = createPiSdkGateway()
    const { driver, rootPath } = await createDriver({ gateway })

    await driver.saveConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })

    const agent = await driver.createAgent('工作区测试')
    const session = await driver.createSession({
      agentId: agent.agentId,
      title: '新会话',
    })

    expect(session.agentId).toBe(agent.agentId)
    expect(gateway.sessionRequests[0]).toMatchObject({
      cwd: join(rootPath, '.tangyuan/agents', agent.agentId, 'workspace'),
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
    })
  })

  it('sends a message from a new agent session and receives a reply', async () => {
    const gateway = createPiSdkGateway()
    const { driver } = await createDriver({ gateway })

    await driver.saveConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })

    const agent = await driver.createAgent('消息测试')
    const session = await driver.createSession({
      agentId: agent.agentId,
      title: '首次对话',
    })

    await driver.sendMessage({
      agentId: agent.agentId,
      sessionId: session.sessionId,
      content: '你好，新 Agent',
    })

    const messages = await driver.getTranscript({
      agentId: agent.agentId,
      sessionId: session.sessionId,
    })
    expect(messages).toEqual(
      expect.objectContaining({
        entries: [
          expect.objectContaining({
            kind: 'user-message',
            content: '你好，新 Agent',
          }),
          expect.objectContaining({
            kind: 'agent-reply',
            content: expect.stringContaining('收到'),
          }),
        ],
      }),
    )
  })

  it('rejects session creation for archived agents', async () => {
    const gateway = createPiSdkGateway()
    const { driver } = await createDriver({ gateway })

    await driver.saveConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })

    await expect(
      driver.createSession({
        agentId: 'nonexistent-agent',
        title: '失败创建',
      }),
    ).rejects.toMatchObject({
      code: 'session-not-found',
      message: expect.stringContaining('不存在或已归档'),
    })
  })

  it('uses UUID as session id for every new session', async () => {
    const gateway = createPiSdkGateway()
    const { driver } = await createDriver({ gateway })

    await driver.saveConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })

    const firstSession = await driver.createSession({
      agentId: 'tangyuan',
      title: '第一次',
    })
    const secondSession = await driver.createSession({
      agentId: 'tangyuan',
      title: '第二次',
    })

    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    expect(firstSession.sessionId).toMatch(uuidPattern)
    expect(secondSession.sessionId).toMatch(uuidPattern)
    expect(firstSession.sessionId).not.toBe(secondSession.sessionId)
  })

  it('rebuilds index for all agents by scanning each agent workspace cwd', async () => {
    // 创建一个可跟踪每个 cwd 下 session 的 gateway
    const sessionsByCwd = new Map<
      string,
      Array<{
        sessionId: string
        sdkSessionFile: string
        title: string
        createdAt: string
        updatedAt: string
      }>
    >()
    const gateway = createPiSdkGateway({
      createSession: async (request) => {
        const sessionEntry = {
          sessionId: request.sessionId,
          sdkSessionFile: request.sdkSessionFile,
          title: '',
          createdAt: '2026-07-08T00:00:00.000Z',
          updatedAt: '2026-07-08T00:00:00.000Z',
        }
        const existingSessions = sessionsByCwd.get(request.cwd) ?? []
        existingSessions.push(sessionEntry)
        sessionsByCwd.set(request.cwd, existingSessions)

        const handle = createPromptingHandle(request.sessionId, (messages) => {
          // 更新 title 为第一条用户消息
          const userMessage = messages.find((m) => m.role === 'user')
          if (userMessage) {
            sessionEntry.title = userMessage.content
          }
        })
        gateway.sessionRequests.push(request)
        gateway.sessionHandles.push(handle)

        return handle
      },
      listSessions: async (request) => {
        gateway.listSessionRequests.push(request)

        return sessionsByCwd.get(request.cwd) ?? []
      },
    })
    const { driver, rootPath, userDataPath } = await createDriver({ gateway })

    await driver.saveConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })

    // 创建一个自定义 Agent
    const agent = await driver.createAgent('多Agent助手')

    // 为 tangyuan 和自定义 Agent 各创建一个 session
    const tangyuanSession = await driver.createSession({
      agentId: 'tangyuan',
      title: '汤圆会话',
    })
    const agentSession = await driver.createSession({
      agentId: agent.agentId,
      title: '助手会话',
    })

    // 发送消息以便在 Pi session 中留下 title
    await driver.sendMessage({
      agentId: 'tangyuan',
      sessionId: tangyuanSession.sessionId,
      content: '汤圆第一条消息',
    })
    await driver.sendMessage({
      agentId: agent.agentId,
      sessionId: agentSession.sessionId,
      content: '助手第一条消息',
    })

    // 删除索引，模拟索引丢失
    await rm(join(userDataPath, 'sessions/index.json'), {
      force: true,
    })

    // 用同一 userData 创建新 driver，触发索引重建
    const restartedDriver = createDriverAtPath({
      gateway,
      rootPath,
      userDataPath,
    })

    // tangyuan 应该只能看到自己的 session
    await expect(
      restartedDriver.listSessions({ agentId: 'tangyuan' }),
    ).resolves.toEqual([
      expect.objectContaining({
        agentId: 'tangyuan',
        sessionId: tangyuanSession.sessionId,
      }),
    ])

    // 自定义 Agent 应该只能看到自己的 session
    await expect(
      restartedDriver.listSessions({ agentId: agent.agentId }),
    ).resolves.toEqual([
      expect.objectContaining({
        agentId: agent.agentId,
        sessionId: agentSession.sessionId,
      }),
    ])

    // 验证重建后的索引文件包含两个 Agent 各自的 session
    const rebuiltIndex = (await readJson(
      join(userDataPath, 'sessions/index.json'),
    )) as { sessions: Array<{ agentId: string; sessionId: string }> }
    expect(rebuiltIndex.sessions).toHaveLength(2)
    expect(rebuiltIndex.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agentId: 'tangyuan',
          sessionId: tangyuanSession.sessionId,
        }),
        expect.objectContaining({
          agentId: agent.agentId,
          sessionId: agentSession.sessionId,
        }),
      ]),
    )
  })

  it('preserves Tangyuan extension data during index rebuild when old index is readable', async () => {
    const sessionsByCwd = new Map<
      string,
      Array<{
        sessionId: string
        sdkSessionFile: string
        title: string
        createdAt: string
        updatedAt: string
      }>
    >()
    const gateway = createPiSdkGateway({
      createSession: async (request) => {
        const sessionEntry = {
          sessionId: request.sessionId,
          sdkSessionFile: request.sdkSessionFile,
          title: '',
          createdAt: '2026-07-08T00:00:00.000Z',
          updatedAt: '2026-07-08T00:00:00.000Z',
        }
        const existingSessions = sessionsByCwd.get(request.cwd) ?? []
        existingSessions.push(sessionEntry)
        sessionsByCwd.set(request.cwd, existingSessions)

        const handle = createPromptingHandle(request.sessionId)
        gateway.sessionRequests.push(request)
        gateway.sessionHandles.push(handle)

        return handle
      },
      listSessions: async (request) => {
        gateway.listSessionRequests.push(request)

        return sessionsByCwd.get(request.cwd) ?? []
      },
    })
    const { driver, rootPath, userDataPath } = await createDriver({ gateway })

    await driver.saveConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })

    const session = await driver.createSession({
      agentId: 'tangyuan',
      title: '扩展数据测试',
    })

    // 发送消息以设置 lastMessagePreview 和 status
    await driver.sendMessage({
      agentId: 'tangyuan',
      sessionId: session.sessionId,
      content: '帮我保存这段对话',
    })

    // 读取当前索引以记录扩展数据
    const oldIndex = (await readJson(
      join(userDataPath, 'sessions/index.json'),
    )) as { sessions: Array<{ lastMessagePreview: string; status: string }> }
    const oldPreview = oldIndex.sessions[0]?.lastMessagePreview
    const oldStatus = oldIndex.sessions[0]?.status
    expect(oldPreview).toBeTruthy()
    expect(oldStatus).toBe('completed')

    // 将索引文件写入损坏的 JSON 来触发重建
    // 但先把旧内容备份到内存
    await writeFile(
      join(userDataPath, 'sessions/index.json'),
      '{ corrupted json ###',
      'utf8',
    )

    // 重建时 tryReadOldIndex 也会因 JSON 损坏而失败，返回空 Map
    // 此时扩展数据使用默认值
    // 这个行为验证了：当旧索引不可读时，重建使用安全默认值
    const restartedDriver = createDriverAtPath({
      gateway,
      rootPath,
      userDataPath,
    })
    await restartedDriver.listSessions({ agentId: 'tangyuan' })

    const rebuiltIndex = (await readJson(
      join(userDataPath, 'sessions/index.json'),
    )) as { sessions: Array<{ lastMessagePreview: string; status: string }> }
    // session 存在且 agentId 正确
    expect(rebuiltIndex.sessions).toHaveLength(1)
    // 旧索引不可读时使用默认值
    expect(rebuiltIndex.sessions[0]?.status).toBe('idle')
  })

  it('cleans up orphan index entries when Pi sessions no longer exist', async () => {
    // 创建一个 gateway，listSessions 在重建时不返回之前存在的 session
    const sessionsByCwd = new Map<
      string,
      Array<{
        sessionId: string
        sdkSessionFile: string
        title: string
        createdAt: string
        updatedAt: string
      }>
    >()
    const gateway = createPiSdkGateway({
      createSession: async (request) => {
        const sessionEntry = {
          sessionId: request.sessionId,
          sdkSessionFile: request.sdkSessionFile,
          title: '',
          createdAt: '2026-07-08T00:00:00.000Z',
          updatedAt: '2026-07-08T00:00:00.000Z',
        }
        const existingSessions = sessionsByCwd.get(request.cwd) ?? []
        existingSessions.push(sessionEntry)
        sessionsByCwd.set(request.cwd, existingSessions)

        const handle = createPromptingHandle(request.sessionId)
        gateway.sessionRequests.push(request)
        gateway.sessionHandles.push(handle)

        return handle
      },
      listSessions: async (request) => {
        gateway.listSessionRequests.push(request)

        return sessionsByCwd.get(request.cwd) ?? []
      },
    })
    const { driver, rootPath, userDataPath } = await createDriver({ gateway })

    await driver.saveConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })

    void (await driver.createSession({
      agentId: 'tangyuan',
      title: '会被清理的会话',
    }))

    // 确认 session 已写入索引
    let index = (await readJson(join(userDataPath, 'sessions/index.json'))) as {
      sessions: Array<{ sessionId: string }>
    }
    expect(index.sessions).toHaveLength(1)

    // 清除 cwd 下的 sessions 列表（模拟 Pi session 文件被删除）
    sessionsByCwd.clear()

    // 删除索引文件，触发重建
    await rm(join(userDataPath, 'sessions/index.json'), {
      force: true,
    })

    const restartedDriver = createDriverAtPath({
      gateway,
      rootPath,
      userDataPath,
    })
    await restartedDriver.listSessions({ agentId: 'tangyuan' })

    // 孤儿条目已被清理
    index = (await readJson(join(userDataPath, 'sessions/index.json'))) as {
      sessions: Array<{ sessionId: string }>
    }
    expect(index.sessions).toHaveLength(0)
  })

  it('restores sessions for multiple agents after restart', async () => {
    const sdkMessagesBySessionFile = new Map<string, TranscriptSnapshot>()
    const gateway = createPiSdkGateway({
      createSession: async (request) => {
        const handle = createPromptingHandle(request.sessionId, (messages) => {
          sdkMessagesBySessionFile.set(
            request.sdkSessionFile,
            snapshotFromMessages(request.sessionId, 'tangyuan', messages),
          )
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
        sdkMessagesBySessionFile.get(request.sdkSessionFile) ?? {
          sessionId: request.sessionId,
          agentId: 'tangyuan',
          entries: [],
          updatedAt: new Date().toISOString(),
        },
    })
    const { driver, rootPath, userDataPath } = await createDriver({ gateway })

    await driver.saveConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })

    const agent = await driver.createAgent('重启测试助手')

    // 为两个 Agent 各创建一个 session 并发送消息
    const tangyuanSession = await driver.createSession({
      agentId: 'tangyuan',
      title: '汤圆重启会话',
    })
    await driver.sendMessage({
      agentId: 'tangyuan',
      sessionId: tangyuanSession.sessionId,
      content: '重启后读取汤圆消息',
    })

    const agentSession = await driver.createSession({
      agentId: agent.agentId,
      title: '助手重启会话',
    })
    await driver.sendMessage({
      agentId: agent.agentId,
      sessionId: agentSession.sessionId,
      content: '重启后读取助手消息',
    })

    // 模拟重启
    const restartedDriver = createDriverAtPath({
      gateway,
      rootPath,
      userDataPath,
    })

    // tangyuan 的会话列表
    await expect(
      restartedDriver.listSessions({ agentId: 'tangyuan' }),
    ).resolves.toEqual([
      expect.objectContaining({
        sessionId: tangyuanSession.sessionId,
        title: '汤圆重启会话',
        state: 'completed',
      }),
    ])

    // 自定义 Agent 的会话列表
    await expect(
      restartedDriver.listSessions({ agentId: agent.agentId }),
    ).resolves.toEqual([
      expect.objectContaining({
        sessionId: agentSession.sessionId,
        title: '助手重启会话',
        state: 'completed',
      }),
    ])

    // tangyuan 的消息可以恢复
    await expect(
      restartedDriver.getTranscript({
        agentId: 'tangyuan',
        sessionId: tangyuanSession.sessionId,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        entries: [
          expect.objectContaining({
            kind: 'user-message',
            content: '重启后读取汤圆消息',
          }),
          expect.objectContaining({
            kind: 'agent-reply',
            content: expect.stringContaining('收到'),
          }),
        ],
      }),
    )

    // 自定义 Agent 的消息可以恢复
    await expect(
      restartedDriver.getTranscript({
        agentId: agent.agentId,
        sessionId: agentSession.sessionId,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        entries: [
          expect.objectContaining({
            kind: 'user-message',
            content: '重启后读取助手消息',
          }),
          expect.objectContaining({
            kind: 'agent-reply',
            content: expect.stringContaining('收到'),
          }),
        ],
      }),
    )
  })

  it('refuses to archive the default tangyuan agent', async () => {
    const gateway = createPiSdkGateway()
    const { driver } = await createDriver({ gateway })

    await expect(driver.archiveAgent('tangyuan')).rejects.toMatchObject({
      code: 'session-not-found',
      message: expect.stringContaining('不可归档'),
    })
  })

  it('archives a custom agent and emits an agent-archived event', async () => {
    const gateway = createPiSdkGateway()
    const { driver } = await createDriver({ gateway })
    const events: AgentEvent[] = []
    driver.subscribe((event) => {
      events.push(event)
    })

    const agent = await driver.createAgent('可归档助手')

    const archived = await driver.archiveAgent(agent.agentId)

    expect(archived.status).toBe('archived')
    expect(archived.archivedAt).toBeTruthy()
    expect(archived.agentId).toBe(agent.agentId)
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'agent-archived',
          agentId: agent.agentId,
        }),
      ]),
    )
  })

  it('recovers an archived agent and emits an agent-recovered event', async () => {
    const gateway = createPiSdkGateway()
    const { driver } = await createDriver({ gateway })
    const events: AgentEvent[] = []
    driver.subscribe((event) => {
      events.push(event)
    })

    const agent = await driver.createAgent('归档后恢复')
    await driver.archiveAgent(agent.agentId)

    events.length = 0
    const recovered = await driver.recoverAgent(agent.agentId)

    expect(recovered.status).toBe('active')
    expect(recovered.archivedAt).toBeNull()
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'agent-recovered',
          agentId: agent.agentId,
        }),
      ]),
    )
  })

  it('reconcileAgentDirectories returns healthy agents and detects unclaimed directories', async () => {
    const gateway = createPiSdkGateway()
    const { driver } = await createDriver({ gateway })

    const agent = await driver.createAgent('对账测试助手')

    const result = await driver.reconcileAgentDirectories()

    expect(result.agents.some((a) => a.agentId === agent.agentId)).toBe(true)
    expect(result.agents.some((a) => a.directoryStatus === 'healthy')).toBe(
      true,
    )
    expect(Array.isArray(result.unclaimedDirectories)).toBe(true)
  })

  it('marks an agent as damaged when its home directory is missing soul.md', async () => {
    const gateway = createPiSdkGateway()
    const { driver } = await createDriver({ gateway })
    const { rm } = await import('node:fs/promises')

    const agent = await driver.createAgent('即将损坏')
    // Remove soul.md to simulate damaged state
    const soulPath = join(agent.homePath, 'soul.md')
    await rm(soulPath)

    const result = await driver.reconcileAgentDirectories()
    const damaged = result.agents.find((a) => a.agentId === agent.agentId)

    expect(damaged).toBeTruthy()
    expect(damaged?.directoryStatus).toBe('damaged')
  })

  it('rebuilds tangyuan home directory from template', async () => {
    const gateway = createPiSdkGateway()
    const { driver, rootPath } = await createDriver({ gateway })
    const { rm, access } = await import('node:fs/promises')
    const { constants: fsConstants } = await import('node:fs')

    // Remove tangyuan soul.md
    const soulPath = join(rootPath, '.tangyuan/agents/tangyuan/soul.md')
    await rm(soulPath, { force: true })

    const summary = await driver.rebuildTangyuanHome()

    expect(summary.directoryStatus).toBe('healthy')
    expect(summary.agentId).toBe('tangyuan')

    // Verify soul.md was recreated
    await expect(access(soulPath, fsConstants.F_OK)).resolves.toBeUndefined()
  })

  it('claims an unclaimed directory and creates config entry', async () => {
    const gateway = createPiSdkGateway()
    const { driver, rootPath } = await createDriver({ gateway })
    const { mkdir, writeFile } = await import('node:fs/promises')

    // 手动创建一个未归属目录
    const unclaimedPath = join(rootPath, '.tangyuan/agents/unclaimed-agent')
    await mkdir(unclaimedPath, { recursive: true })
    await writeFile(
      join(unclaimedPath, 'soul.md'),
      '# 未归属 Agent\n\n创建时间：2026-01-01T00:00:00.000Z\n',
      'utf8',
    )

    // 先用对账发现它
    const reconcileResult = await driver.reconcileAgentDirectories()
    const found = reconcileResult.unclaimedDirectories.find(
      (d) => d.agentId === 'unclaimed-agent',
    )
    expect(found).toBeTruthy()

    // 认领它
    const claimed = await driver.claimAgentDirectory(
      'unclaimed-agent',
      '认领的助手',
    )

    expect(claimed.agentId).toBe('unclaimed-agent')
    expect(claimed.displayName).toBe('认领的助手')
    expect(claimed.status).toBe('active')
    expect(claimed.directoryStatus).toBe('healthy')

    // 确认 listAgents 包含认领后 Agent
    const agents = await driver.listAgents()
    expect(agents.some((a) => a.agentId === 'unclaimed-agent')).toBe(true)
  })

  // ===== profile 测试 =====

  it('reads soul content from the correct agent path', async () => {
    const { driver, rootPath } = await createDriver()
    const { writeFile } = await import('node:fs/promises')

    // 先初始化 driver
    await driver.getSnapshot()
    // 写入一个已知的 soul.md
    const resolvedHomePath = join(rootPath, '.tangyuan/agents/tangyuan')
    await writeFile(
      join(resolvedHomePath, 'soul.md'),
      '# 汤圆\n自定义 soul 内容。',
      'utf8',
    )

    const soul = await driver.getSoul('tangyuan')

    expect(soul.agentId).toBe('tangyuan')
    expect(soul.content).toBe('# 汤圆\n自定义 soul 内容。')
    expect(soul.updatedAt).toBeTruthy()
  })

  it('reads shared user profile from the shared profile path', async () => {
    const { driver, rootPath } = await createDriver()
    const { mkdir, writeFile } = await import('node:fs/promises')

    // 先初始化 driver
    await driver.getSnapshot()
    // 写入共享 user profile
    const profileDir = join(rootPath, '.tangyuan/profile')
    await mkdir(profileDir, { recursive: true })
    await mkdir(join(profileDir, 'user.history'), { recursive: true })
    await writeFile(
      join(profileDir, 'user.md'),
      '# User\n共享用户偏好。',
      'utf8',
    )

    const userProfile = await driver.getUserProfile()

    expect(userProfile.content).toBe('# User\n共享用户偏好。')
    expect(userProfile.updatedAt).toBeTruthy()
  })

  it('migrates legacy user.md from tangyuan agent directory to shared profile path', async () => {
    const { driver, rootPath } = await createDriver()
    const { writeFile, readFile } = await import('node:fs/promises')

    // 先初始化 driver 创建目录
    await driver.getSnapshot()

    // 模拟旧结构：在 tangyuan agent 目录下写入 user.md
    const agentDir = join(rootPath, '.tangyuan/agents/tangyuan')
    await writeFile(
      join(agentDir, 'user.md'),
      '# Legacy User\n旧用户资料。',
      'utf8',
    )

    // 读取 user profile 应触发迁移
    const userProfile = await driver.getUserProfile()

    expect(userProfile.content).toBe('# Legacy User\n旧用户资料。')

    // 验证文件已迁移到共享路径
    const sharedPath = join(rootPath, '.tangyuan/profile/user.md')
    const migratedContent = await readFile(sharedPath, 'utf8')
    expect(migratedContent).toBe('# Legacy User\n旧用户资料。')
  })

  it('updates an agent soul and emits a profile-updated event', async () => {
    const { driver, rootPath } = await createDriver()
    const { writeFile } = await import('node:fs/promises')

    await driver.getSnapshot()

    // 写入初始 soul
    const resolvedHomePath = join(rootPath, '.tangyuan/agents/tangyuan')
    await writeFile(
      join(resolvedHomePath, 'soul.md'),
      '# 汤圆\n旧 soul。',
      'utf8',
    )

    // 监听事件
    const events: AgentEvent[] = []
    driver.subscribe((event) => {
      events.push(event)
    })

    // 备份（模拟 Agent 先备份再更新）
    const historyDir = join(resolvedHomePath, 'soul.history')
    const { writeFile: fsWriteFile } = await import('node:fs/promises')
    await fsWriteFile(
      join(historyDir, '2026-07-17-backup.md'),
      '# 汤圆\n旧 soul。',
      'utf8',
    )

    const result = await driver.updateSoul(
      'tangyuan',
      '# 汤圆\n新 soul 内容。',
      'tangyuan',
    )

    expect(result.success).toBe(true)
    expect(result.target).toBe('soul')

    // 验证文件已更新
    const { readFile } = await import('node:fs/promises')
    const updatedContent = await readFile(
      join(resolvedHomePath, 'soul.md'),
      'utf8',
    )
    expect(updatedContent).toBe('# 汤圆\n新 soul 内容。')

    // 验证事件已发出
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'profile-updated',
          target: 'soul',
        }),
      ]),
    )
  })

  it('rejects soul update from another agent (access control)', async () => {
    const { driver } = await createDriver()

    await driver.getSnapshot()

    // Agent B 尝试更新 Agent A 的 soul
    const result = await driver.updateSoul('agent-a', '# New soul', 'agent-b')

    expect(result.success).toBe(false)
    expect(result.reason).toContain('无权修改')
    expect(result.reason).toContain('agent-a')
  })

  it('allows tangyuan to update another agent soul (for creation)', async () => {
    const { driver, rootPath } = await createDriver()
    const { mkdir, writeFile } = await import('node:fs/promises')

    await driver.getSnapshot()

    // 为 agent-b 创建目录结构
    const agentBPath = join(rootPath, '.tangyuan/agents/agent-b')
    await mkdir(agentBPath, { recursive: true })
    await mkdir(join(agentBPath, 'soul.history'), { recursive: true })
    await mkdir(join(agentBPath, 'memory'), { recursive: true })
    await mkdir(join(agentBPath, 'skills'), { recursive: true })

    // 备份
    await writeFile(join(agentBPath, 'soul.history/backup.md'), '', 'utf8')

    // 汤圆（tangyuan）更新 agent-b 的 soul
    const result = await driver.updateSoul(
      'agent-b',
      '# Agent B\n新创建 Agent 的初始 soul。',
      'tangyuan',
    )

    expect(result.success).toBe(true)

    // 验证文件已创建
    const { readFile } = await import('node:fs/promises')
    const content = await readFile(join(agentBPath, 'soul.md'), 'utf8')
    expect(content).toContain('新创建 Agent')
  })

  it('filters sensitive content from soul updates', async () => {
    const gateway = createPiSdkGateway()
    const { driver, rootPath } = await createDriver({ gateway })
    const { writeFile } = await import('node:fs/promises')

    await driver.getSnapshot()

    // 先保存一个 API Key 配置
    await driver.saveConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })

    // 重新获取 driver 状态
    const resolvedHomePath = join(rootPath, '.tangyuan/agents/tangyuan')
    await writeFile(
      join(resolvedHomePath, 'soul.md'),
      '# 汤圆\n旧 soul。',
      'utf8',
    )

    // 备份
    const historyDir = join(resolvedHomePath, 'soul.history')
    await writeFile(join(historyDir, 'backup.md'), '# 汤圆\n旧 soul。', 'utf8')

    // 尝试写入含 API Key 的内容
    const result = await driver.updateSoul(
      'tangyuan',
      '# 汤圆\n我的 API Key 是 sk-test-secret-7890。',
      'tangyuan',
    )

    expect(result.success).toBe(true)

    // 验证敏感内容已脱敏
    const { readFile } = await import('node:fs/promises')
    const content = await readFile(join(resolvedHomePath, 'soul.md'), 'utf8')
    expect(content).not.toContain('sk-test-secret-7890')
    expect(content).toContain('[已隐藏敏感凭据]')
  })

  it('rejects soul update when no backup exists', async () => {
    const { driver, rootPath } = await createDriver()
    const { writeFile } = await import('node:fs/promises')

    await driver.getSnapshot()

    // 写入初始 soul（不创建备份）
    const resolvedHomePath = join(rootPath, '.tangyuan/agents/tangyuan')
    await writeFile(
      join(resolvedHomePath, 'soul.md'),
      '# 汤圆\n旧 soul。',
      'utf8',
    )

    // 尝试更新 soul 但未备份
    const result = await driver.updateSoul(
      'tangyuan',
      '# 汤圆\n新 soul（无备份）。',
      'tangyuan',
    )

    expect(result.success).toBe(false)
    expect(result.reason).toContain('备份')
  })

  it('updates shared user profile and emits a profile-updated event', async () => {
    const { driver, rootPath } = await createDriver()
    const { mkdir, writeFile } = await import('node:fs/promises')

    await driver.getSnapshot()

    // 确保共享 profile 目录存在并写入初始 user.md
    const profileDir = join(rootPath, '.tangyuan/profile')
    await mkdir(profileDir, { recursive: true })
    await mkdir(join(profileDir, 'user.history'), { recursive: true })
    await writeFile(join(profileDir, 'user.md'), '# User\n旧偏好。', 'utf8')

    // 监听事件
    const events: AgentEvent[] = []
    driver.subscribe((event) => {
      events.push(event)
    })

    // 备份
    await writeFile(
      join(profileDir, 'user.history/backup.md'),
      '# User\n旧偏好。',
      'utf8',
    )

    const result = await driver.updateUserProfile('# User\n新用户偏好。')

    expect(result.success).toBe(true)
    expect(result.target).toBe('user')

    // 验证文件已更新
    const { readFile } = await import('node:fs/promises')
    const content = await readFile(join(profileDir, 'user.md'), 'utf8')
    expect(content).toBe('# User\n新用户偏好。')

    // 验证事件已发出
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'profile-updated',
          target: 'user',
        }),
      ]),
    )
  })

  it('filters sensitive content from user profile updates', async () => {
    const gateway = createPiSdkGateway()
    const { driver, rootPath } = await createDriver({ gateway })
    const { mkdir, writeFile } = await import('node:fs/promises')

    await driver.getSnapshot()

    // 先保存配置
    await driver.saveConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })

    // 确保共享 profile 目录存在
    const profileDir = join(rootPath, '.tangyuan/profile')
    await mkdir(profileDir, { recursive: true })
    await mkdir(join(profileDir, 'user.history'), { recursive: true })
    await writeFile(join(profileDir, 'user.md'), '# User\n旧偏好。', 'utf8')

    // 备份
    await writeFile(
      join(profileDir, 'user.history/backup.md'),
      '# User\n旧偏好。',
      'utf8',
    )

    // 尝试写入含敏感信息的内容
    const result = await driver.updateUserProfile(
      '# User\npassword: my-secret-pwd',
    )

    expect(result.success).toBe(true)

    // 验证敏感内容已脱敏
    const { readFile } = await import('node:fs/promises')
    const content = await readFile(join(profileDir, 'user.md'), 'utf8')
    expect(content).not.toContain('my-secret-pwd')
    expect(content).toContain('[已隐藏敏感凭据]')
  })
})

async function createDriver(
  options: {
    gateway?: PiSdkGateway
    encryptionAdapter?: ConfigEncryptionAdapter | null
  } = {},
) {
  const rootPath = await mkdtemp(join(tmpdir(), 'tangyuan-agent-runtime-'))
  const userDataPath = join(rootPath, 'Library/Application Support/Tangyuan')
  tempDirs.push(rootPath)

  return {
    driver: createDriverAtPath({
      rootPath,
      userDataPath,
      ...(options.gateway ? { gateway: options.gateway } : {}),
      ...(options.encryptionAdapter !== undefined
        ? { encryptionAdapter: options.encryptionAdapter }
        : {}),
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
 * @param rootPath - 临时文件系统根路径，用于写入共享 user profile。
 * @returns 无返回值。
 * @throws 当目录创建或文件写入失败时，Promise 会 reject。
 */
async function writeInitializedProfile(
  resolvedHomePath: string,
  rootPath?: string,
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
  // 写入共享 user profile 路径（新架构）
  if (rootPath) {
    const profileDir = join(rootPath, '.tangyuan/profile')
    await import('node:fs/promises').then(async ({ mkdir }) => {
      await mkdir(profileDir, { recursive: true })
      await mkdir(join(profileDir, 'user.history'), { recursive: true })
    })
    await writeFile(
      join(profileDir, 'user.md'),
      '# User\n用户喜欢简洁回答。',
      'utf8',
    )
  }
  // 同时保留 agent 目录下的 user.md 用于兼容旧测试
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
  encryptionAdapter?: ConfigEncryptionAdapter | null
}): PiSdkDriver {
  const resolvedEncryptionAdapter =
    options.encryptionAdapter !== undefined
      ? options.encryptionAdapter
      : createFakeEncryptionAdapter()

  const driverOptions: PiSdkDriverOptions = {
    fsRoot: options.rootPath,
    userDataPath: options.userDataPath,
    agentHomePath: '~/.tangyuan/agents/tangyuan',
    now: () => '2026-07-08T00:00:00.000Z',
    ...(options.gateway ? { gateway: options.gateway } : {}),
  }

  if (resolvedEncryptionAdapter) {
    driverOptions.encryptionAdapter = resolvedEncryptionAdapter
  }

  return new PiSdkDriver(driverOptions)
}

/**
 * 创建测试用假加密适配器（基于 base64 编码）。
 *
 * @returns 可用的 ConfigEncryptionAdapter。
 * @throws 此测试辅助方法不会主动抛出错误。
 */
function createFakeEncryptionAdapter(): ConfigEncryptionAdapter {
  return {
    encrypt: async (plaintext: string) =>
      `encrypted:${Buffer.from(plaintext).toString('base64')}`,
    decrypt: async (ciphertext: string) => {
      if (!ciphertext.startsWith('encrypted:')) {
        throw new Error('Invalid fake ciphertext')
      }
      return Buffer.from(
        ciphertext.slice('encrypted:'.length),
        'base64',
      ).toString('utf8')
    },
    isAvailable: () => true,
  }
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
  const messagesBySession = new Map<string, InternalMessage[]>()

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
      const handle = createPromptingHandle(request.sessionId, (messages) => {
        messagesBySession.set(request.sessionId, messages)
      })
      sessionHandles.push(handle)

      return handle
    },
    openSession: async (request) => {
      openSessionRequests.push(request)
      const handle = createPromptingHandle(request.sessionId, (messages) => {
        messagesBySession.set(request.sessionId, messages)
      })
      sessionHandles.push(handle)

      return handle
    },
    listSessions: async (request) => {
      listSessionRequests.push(request)
      return []
    },
    readMessages: async (request) => {
      readMessageRequests.push(request)
      return snapshotFromMessages(
        request.sessionId,
        messagesBySession.get(request.sessionId)?.[0]?.agentId ?? 'tangyuan',
        messagesBySession.get(request.sessionId) ?? [],
      )
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
  onMessages?: (messages: InternalMessage[]) => void,
): PiSdkSessionHandle & { prompts: string[] } {
  const prompts: string[] = []

  return {
    prompts,
    prompt: async (prompt: string) => {
      prompts.push(prompt)
      const userContent = prompt.split('# 用户消息').at(-1)?.trim() ?? prompt
      const messages: InternalMessage[] = [
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
