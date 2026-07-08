import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AgentRuntimeError,
  type AgentEvent,
  PiSdkDriver,
  type PiSdkCreateSessionRequest,
  type PiSdkGateway,
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

    await expect(stat(join(rootPath, homePath.slice(2)))).resolves.toMatchObject({
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
      writeFile(join(resolvedHomePath, 'bootstrap.md'), 'custom bootstrap', 'utf8'),
    )

    await driver.refresh()

    await expect(readFile(join(resolvedHomePath, 'bootstrap.md'), 'utf8')).resolves.toBe(
      'custom bootstrap',
    )
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
    await expect(readFile(join(resolvedHomePath, 'bootstrap.md'), 'utf8')).resolves.toContain(
      '# Bootstrap',
    )
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
      readFile(join(rootPath, 'Library/Application Support/Tangyuan/config.json'), 'utf8'),
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
      readFile(join(rootPath, 'Library/Application Support/Tangyuan/config.json'), 'utf8'),
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
        cwd: join(rootPath, '.tangyuan/agents/tangyuan'),
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-5',
      }),
    ])
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

  it('injects existing soul.md and user.md into the Pi SDK prompt', async () => {
    const gateway = createPiSdkGateway()
    const { driver, rootPath, homePath } = await createDriver({ gateway })
    const resolvedHomePath = join(rootPath, homePath.slice(2))

    await driver.getSnapshot()
    await writeFile(join(resolvedHomePath, 'soul.md'), '# Soul\n只说中文。', 'utf8')
    await writeFile(join(resolvedHomePath, 'user.md'), '# User\n用户喜欢简洁回答。', 'utf8')
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
    expect(gateway.sessionHandles[0]?.prompts[0]).toContain('用户喜欢简洁回答。')
    expect(gateway.sessionHandles[0]?.prompts[0]).not.toContain('# Bootstrap')
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
  tempDirs.push(rootPath)

  return {
    driver: new PiSdkDriver({
      fsRoot: rootPath,
      userDataPath: join(rootPath, 'Library/Application Support/Tangyuan'),
      agentHomePath: '~/.tangyuan/agents/tangyuan',
      now: () => '2026-07-08T00:00:00.000Z',
      ...(options.gateway ? { gateway: options.gateway } : {}),
    }),
    rootPath,
    homePath: '~/.tangyuan/agents/tangyuan',
  }
}

/**
 * 创建 Pi SDK 网关测试替身，用于模拟真实 SDK 的配置验证。
 *
 * @param options - 可覆盖的验证行为。
 * @returns 记录调用参数的 PiSdkGateway。
 * @throws 此测试辅助方法不会主动抛出错误。
 */
function createPiSdkGateway(options: Partial<PiSdkGateway> = {}): PiSdkGateway & {
  requests: PiSdkVerificationRequest[]
  sessionRequests: PiSdkCreateSessionRequest[]
  sessionHandles: Array<PiSdkSessionHandle & { prompts: string[] }>
} {
  const requests: PiSdkVerificationRequest[] = []
  const sessionRequests: PiSdkCreateSessionRequest[] = []
  const sessionHandles: Array<PiSdkSessionHandle & { prompts: string[] }> = []

  return {
    requests,
    sessionRequests,
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
      const prompts: string[] = []
      const handle = {
        prompts,
        prompt: async (prompt: string) => {
          prompts.push(prompt)
          return `收到：${prompt.split('# 用户消息').at(-1)?.trim() ?? prompt}`
        },
        abort: async () => undefined,
        dispose: () => undefined,
      }
      sessionHandles.push(handle)

      return handle
    },
    ...options,
  }
}
