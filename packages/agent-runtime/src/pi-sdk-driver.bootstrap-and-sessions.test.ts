import { readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  type AgentEvent,
  type InternalMessage,
  type TranscriptSnapshot,
  PiSdkDriver,
  type PiSdkPromptOptions,
} from './index'
import {
  cleanupTempDirs,
  createDeferred,
  createDriver,
  createDriverAtPath,
  createPiSdkGateway,
  createPromptingHandle,
  readJson,
  snapshotFromMessages,
} from './pi-sdk-driver.test-helpers'

afterEach(cleanupTempDirs)

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
  it('rejects opening an archived session until the session is recovered', async () => {
    const gateway = createPiSdkGateway()
    const { driver } = await createDriver({ gateway })

    await driver.saveConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    const session = await driver.createSession({
      agentId: 'tangyuan',
      title: '可恢复会话',
    })

    await driver.setSessionsArchived(
      [session.sessionId],
      '2026-07-08T01:00:00.000Z',
    )
    await expect(
      driver.getTranscript({
        agentId: 'tangyuan',
        sessionId: session.sessionId,
      }),
    ).rejects.toMatchObject({ code: 'session-not-found' })

    await driver.setSessionsArchived([session.sessionId], null)
    await expect(
      driver.getTranscript({
        agentId: 'tangyuan',
        sessionId: session.sessionId,
      }),
    ).resolves.toMatchObject({ sessionId: session.sessionId })
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
        onUpdateSoul: expect.any(Function),
      }),
    ])
  })
  it('rebuilds a basic local index from Pi SDK sessions when the index is missing', async () => {
    // 重建按 session header 的工作目录归属 Agent，cwd 在拿到 rootPath 后才能确定。
    let tangyuanCwd = ''
    const gateway = createPiSdkGateway({
      listSessions: async () => [
        {
          sessionId: 'session-from-sdk',
          sdkSessionFile: '/tmp/pi-sessions/session-from-sdk.json',
          title: 'SDK 恢复会话',
          cwd: tangyuanCwd,
          createdAt: '2026-07-07T00:00:00.000Z',
          updatedAt: '2026-07-07T00:01:00.000Z',
        },
      ],
    })
    const { driver, rootPath, userDataPath } = await createDriver({ gateway })
    tangyuanCwd = join(rootPath, '.tangyuan/agents/tangyuan')

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
    expect(gateway.sessionHandles[0]?.systemPromptContexts[0]).toContain(
      '# Bootstrap',
    )
    expect(gateway.sessionHandles[0]?.prompts[0]).toBe('你好')
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
          systemPromptContexts: [] as string[],
          setSystemPromptContext(context: string) {
            this.systemPromptContexts.push(context)
          },
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
          systemPromptContexts: [] as string[],
          setSystemPromptContext(context: string) {
            this.systemPromptContexts.push(context)
          },
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
  it('creates an independent Pi session containing history before the forked user message', async () => {
    const gateway = createPiSdkGateway()
    const createBranchedSession = async (request: {
      sdkSessionFile: string
      entryId: string
    }) => {
      expect(request.entryId).toBe('source-user')
      return {
        sessionId: 'child-session-id',
        sdkSessionFile: '/tmp/child-session.jsonl',
        providerId: 'anthropic',
        modelId: 'claude-opus-4-6',
      }
    }
    ;(
      gateway as unknown as {
        createBranchedSession: typeof createBranchedSession
      }
    ).createBranchedSession = createBranchedSession

    const readMessages = gateway.readMessages.bind(gateway)
    let childMessages: InternalMessage[] = []
    const childHandle = createPromptingHandle(
      'child-session-id',
      (messages) => {
        childMessages = messages
      },
    )
    gateway.openSession = async (request) => {
      gateway.openSessionRequests.push(request)
      gateway.sessionHandles.push(childHandle)
      return childHandle
    }
    gateway.readMessages = async (request) => {
      if (request.sessionId === 'child-session-id') {
        return snapshotFromMessages('child-session-id', 'tangyuan', [
          {
            messageId: 'before-user',
            agentId: 'tangyuan',
            sessionId: 'child-session-id',
            role: 'user',
            content: '之前的问题',
            createdAt: '2026-07-08T00:00:00.000Z',
          },
          {
            messageId: 'before-agent',
            agentId: 'tangyuan',
            sessionId: 'child-session-id',
            role: 'agent',
            content: '之前的回答',
            createdAt: '2026-07-08T00:00:00.000Z',
          },
          ...childMessages,
        ])
      }

      return readMessages(request)
    }

    const { driver, userDataPath } = await createDriver({ gateway })
    await driver.saveConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    const parent = await driver.createSession({
      agentId: 'tangyuan',
      title: '父会话',
    })
    const parentHandle = gateway.sessionHandles[0]!
    parentHandle.setModel = async () => undefined
    parentHandle.getModelInfo = async () => ({
      providerId: 'anthropic',
      modelId: 'claude-opus-4-6',
      displayName: 'Claude Opus 4.6',
      thinkingLevel: null,
      supportedThinkingLevels: [],
      supportsThinking: false,
    })
    await driver.setSessionModel({
      agentId: 'tangyuan',
      sessionId: parent.sessionId,
      providerId: 'anthropic',
      modelId: 'claude-opus-4-6',
    })
    expect(await readJson(join(userDataPath, 'sessions/index.json'))).toEqual(
      expect.objectContaining({
        sessions: expect.arrayContaining([
          expect.objectContaining({
            sessionId: parent.sessionId,
            model: 'claude-opus-4-6',
          }),
        ]),
      }),
    )

    const child = await driver.forkSession({
      agentId: 'tangyuan',
      sessionId: parent.sessionId,
      entryId: 'source-user',
    })

    expect(child).toMatchObject({
      sessionId: 'child-session-id',
      title: '父会话（分叉）',
      state: 'idle',
      forkedFrom: {
        sessionId: parent.sessionId,
        entryId: 'source-user',
      },
    })
    expect(gateway.openSessionRequests).toEqual([
      expect.objectContaining({
        sessionId: 'child-session-id',
        sdkSessionFile: '/tmp/child-session.jsonl',
        providerId: 'anthropic',
        modelId: 'claude-opus-4-6',
      }),
    ])
    await expect(
      driver.getTranscript({
        agentId: 'tangyuan',
        sessionId: 'child-session-id',
      }),
    ).resolves.toMatchObject({
      entries: [
        expect.objectContaining({ content: '之前的问题' }),
        expect.objectContaining({ content: '之前的回答' }),
      ],
    })
    await driver.sendMessage({
      agentId: 'tangyuan',
      sessionId: parent.sessionId,
      content: '父会话继续',
    })
    await driver.sendMessage({
      agentId: 'tangyuan',
      sessionId: child.sessionId,
      content: '子会话继续',
    })
    expect(gateway.sessionHandles[0]?.prompts).toEqual(['父会话继续'])
    expect(childHandle.prompts).toEqual(['子会话继续'])
    await expect(
      driver.getTranscript({
        agentId: 'tangyuan',
        sessionId: parent.sessionId,
      }),
    ).resolves.toMatchObject({
      entries: expect.arrayContaining([
        expect.objectContaining({ content: '父会话继续' }),
      ]),
    })
    await expect(
      driver.getTranscript({
        agentId: 'tangyuan',
        sessionId: child.sessionId,
      }),
    ).resolves.toMatchObject({
      entries: expect.arrayContaining([
        expect.objectContaining({ content: '之前的问题' }),
        expect.objectContaining({ content: '子会话继续' }),
      ]),
    })

    await expect(
      readJson(join(userDataPath, 'sessions/index.json')),
    ).resolves.toEqual({
      sessions: expect.arrayContaining([
        expect.objectContaining({
          sessionId: 'child-session-id',
          sdkSessionFile: '/tmp/child-session.jsonl',
          forkedFrom: {
            sessionId: parent.sessionId,
            entryId: 'source-user',
          },
        }),
      ]),
    })
  })
})
