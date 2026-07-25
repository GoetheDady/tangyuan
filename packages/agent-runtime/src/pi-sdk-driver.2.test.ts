import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { type PiSdkPromptOptions } from './index'
import {
  cleanupTempDirs,
  createDeferred,
  createDriver,
  createPiSdkGateway,
  writeInitializedProfile,
} from './pi-sdk-driver.test-helpers'

afterEach(cleanupTempDirs)

describe('PiSdkDriver', () => {
  it('cancels an active run and preserves generated partial content', async () => {
    const runStarted = createDeferred<void>()
    const releasePrompt = createDeferred<void>()
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
          systemPromptContexts: [] as string[],
          setSystemPromptContext(context: string) {
            this.systemPromptContexts.push(context)
          },
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

    // 身份上下文走系统提示词，不再拼进消息；消息只有用户原文。
    const context = gateway.sessionHandles[0]?.systemPromptContexts.at(-1)
    expect(context).toContain('只说中文。')
    expect(context).toContain('用户喜欢简洁回答。')
    expect(context).not.toContain('# Bootstrap')
    expect(gateway.sessionHandles[0]?.prompts[0]).toBe('开始')
  })
  it('does not run a hidden profile maintenance turn after the main reply', async () => {
    const gateway = createPiSdkGateway({
      createSession: async (request) => {
        const handle = {
          prompts: [] as string[],
          systemPromptContexts: [] as string[],
          setSystemPromptContext(context: string) {
            this.systemPromptContexts.push(context)
          },
          prompt: async (prompt: string) => {
            handle.prompts.push(prompt)

            return '主回复完成。'
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

    expect(gateway.sessionHandles[0]?.prompts).toEqual(['记住我偏好短回答'])
    await expect(
      driver.getTranscript({
        agentId: 'tangyuan',
        sessionId: session.sessionId,
      }),
    ).resolves.toEqual(expect.objectContaining({ entries: [] }))
  })
  it('lets the bootstrap turn create profile files, remove bootstrap.md, and enter history', async () => {
    const gateway = createPiSdkGateway({
      createSession: async (request) => {
        const handle = {
          prompts: [] as string[],
          systemPromptContexts: [] as string[],
          setSystemPromptContext(context: string) {
            this.systemPromptContexts.push(context)
          },
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
    // bootstrap 回合的身份上下文（建会话时注入）包含 bootstrap 指令。
    const bootstrapContext = gateway.sessionHandles[0]?.systemPromptContexts[0]
    expect(bootstrapContext).toContain('# Bootstrap')
    expect(bootstrapContext).toContain(
      'soul.md 至少必须覆盖：身份、用户偏好、工作范围、沟通方式、权限边界、敏感信息规则、记忆与技能原则、不确定时的处理方式。',
    )
    expect(bootstrapContext).toContain('完成后删除 bootstrap.md。')
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
  })
  it('deletes bootstrap.md when the agent writes both profile files but forgets to remove it', async () => {
    const gateway = createPiSdkGateway({
      createSession: async (request) => {
        const handle = {
          prompts: [] as string[],
          systemPromptContexts: [] as string[],
          setSystemPromptContext(context: string) {
            this.systemPromptContexts.push(context)
          },
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
          systemPromptContexts: [] as string[],
          setSystemPromptContext(context: string) {
            this.systemPromptContexts.push(context)
          },
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
          systemPromptContexts: [] as string[],
          setSystemPromptContext(context: string) {
            this.systemPromptContexts.push(context)
          },
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
          systemPromptContexts: [] as string[],
          setSystemPromptContext(context: string) {
            this.systemPromptContexts.push(context)
          },
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
          systemPromptContexts: [] as string[],
          setSystemPromptContext(context: string) {
            this.systemPromptContexts.push(context)
          },
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
})
