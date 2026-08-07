import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { type PiSdkPromptOptions } from './index'
import {
  cleanupTempDirs,
  createDeferred,
  createDriver,
  createPiSdkGateway,
  createPromptingHandle,
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
          ...createPromptingHandle(
            request.sessionId,
            undefined,
            request.sdkSessionFile,
          ),
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
    const { runtime } = await createDriver({ gateway })

    await runtime.saveRuntimeConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    const session = await runtime.createSession({
      agentId: 'yuanxiao',
      title: '新会话',
    })
    const sendPromise = runtime.sendMessage({
      agentId: 'yuanxiao',
      sessionId: session.sessionId,
      content: '开始',
    })
    await runStarted.promise
    await runtime.cancelRun({
      agentId: 'yuanxiao',
      sessionId: session.sessionId,
    })

    await expect(sendPromise).resolves.toMatchObject({
      sessionId: session.sessionId,
    })
    await expect(runtime.listSessions('yuanxiao')).resolves.toEqual([
      expect.objectContaining({
        sessionId: session.sessionId,
        state: 'cancelled',
      }),
    ])
    await expect(
      runtime.getTranscript({
        agentId: 'yuanxiao',
        sessionId: session.sessionId,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        entries: [
          expect.objectContaining({ kind: 'user-message', content: '开始' }),
          expect.objectContaining({
            kind: 'agent-reply',
            content: '部分内容',
          }),
        ],
      }),
    )
  })
  it('does not keep an empty agent message when a run fails before deltas arrive', async () => {
    const gateway = createPiSdkGateway({
      createSession: async (request) => {
        const handle = {
          ...createPromptingHandle(
            request.sessionId,
            undefined,
            request.sdkSessionFile,
          ),
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
    const { runtime } = await createDriver({ gateway })

    await runtime.saveRuntimeConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    const session = await runtime.createSession({
      agentId: 'yuanxiao',
      title: '新会话',
    })

    await expect(
      runtime.sendMessage({
        agentId: 'yuanxiao',
        sessionId: session.sessionId,
        content: '开始',
      }),
    ).rejects.toThrow('provider failed')
    await expect(
      runtime.getTranscript({
        agentId: 'yuanxiao',
        sessionId: session.sessionId,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        entries: [
          expect.objectContaining({ kind: 'user-message', content: '开始' }),
        ],
      }),
    )
  })
  it('injects existing soul.md and user.md into the Pi SDK prompt', async () => {
    const gateway = createPiSdkGateway()
    const { runtime, rootPath, homePath } = await createDriver({ gateway })
    const resolvedHomePath = join(rootPath, homePath.slice(2))

    await runtime.getRuntimeSnapshot()
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
    await runtime.saveRuntimeConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    const session = await runtime.createSession({
      agentId: 'yuanxiao',
      title: '新会话',
    })

    await runtime.sendMessage({
      agentId: 'yuanxiao',
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
          ...createPromptingHandle(
            request.sessionId,
            undefined,
            request.sdkSessionFile,
          ),
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
    const { runtime, rootPath, homePath } = await createDriver({ gateway })
    const resolvedHomePath = join(rootPath, homePath.slice(2))

    await writeInitializedProfile(resolvedHomePath, rootPath)
    await runtime.saveRuntimeConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    const session = await runtime.createSession({
      agentId: 'yuanxiao',
      title: '新会话',
    })
    await runtime.sendMessage({
      agentId: 'yuanxiao',
      sessionId: session.sessionId,
      content: '记住我偏好短回答',
    })

    expect(gateway.sessionHandles[0]?.prompts).toEqual(['记住我偏好短回答'])
    await expect(
      runtime.getTranscript({
        agentId: 'yuanxiao',
        sessionId: session.sessionId,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        entries: [
          expect.objectContaining({
            kind: 'user-message',
            content: '记住我偏好短回答',
          }),
          expect.objectContaining({
            kind: 'agent-reply',
            content: '主回复完成。',
          }),
        ],
      }),
    )
  })
  it('lets the bootstrap turn create profile files and enter history using controlled tools', async () => {
    const gateway = createPiSdkGateway({
      createSession: async (request) => {
        const handle = {
          ...createPromptingHandle(
            request.sessionId,
            undefined,
            request.sdkSessionFile,
          ),
          prompts: [] as string[],
          systemPromptContexts: [] as string[],
          setSystemPromptContext(context: string) {
            this.systemPromptContexts.push(context)
          },
          prompt: async (prompt: string) => {
            handle.prompts.push(prompt)
            // Agent 使用受控工具完成初始化
            await request.onUpdateSoul(
              [
                '# Soul',
                '身份：元宵是桌面端 Agent。',
                '用户偏好：优先中文。',
                '工作范围：协助工程任务。',
                '沟通方式：解释专业术语。',
                '权限边界：危险操作先确认。',
                '敏感信息规则：不记录密钥。',
                '记忆与技能原则：只记录长期偏好。',
                '不确定时的处理方式：先说明假设。',
              ].join('\n'),
            )
            await request.onUpdateUserProfile(
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
    const { runtime, rootPath, homePath } = await createDriver({ gateway })

    await runtime.getRuntimeSnapshot()
    await runtime.saveRuntimeConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    const session = await runtime.createSession({
      agentId: 'yuanxiao',
      title: 'Bootstrap 初始化',
    })
    await runtime.sendMessage({
      agentId: 'yuanxiao',
      sessionId: session.sessionId,
      content: '请开始初始化。',
    })

    const resolvedHomePath = join(rootPath, homePath.slice(2))
    const sharedProfilePath = join(rootPath, '.yuanxiao/profile')
    // bootstrap 回合的身份上下文（建会话时注入）包含 bootstrap 指令。
    const bootstrapContext = gateway.sessionHandles[0]?.systemPromptContexts[0]
    expect(bootstrapContext).toContain('# Bootstrap')
    expect(bootstrapContext).toContain(
      'Agent 灵魂至少必须覆盖：身份、用户偏好、工作范围、沟通方式、权限边界、敏感信息规则、记忆与技能原则、不确定时的处理方式。',
    )
    expect(bootstrapContext).toContain('update_soul')
    await expect(
      readFile(join(resolvedHomePath, 'soul.md'), 'utf8'),
    ).resolves.toContain('身份：元宵是桌面端 Agent。')
    await expect(
      readFile(join(sharedProfilePath, 'user.md'), 'utf8'),
    ).resolves.toContain('称呼：用户。')
    // bootstrap.md 由 Runtime 自动清理
    await expect(
      readFile(join(resolvedHomePath, 'bootstrap.md'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(runtime.getRuntimeSnapshot()).resolves.toMatchObject({
      activeAgent: {
        profile: {
          initialized: true,
          bootstrapRequired: false,
          soulUpdatedAt: expect.any(String),
          userUpdatedAt: expect.any(String),
        },
      },
    })
    await expect(runtime.listSessions('yuanxiao')).resolves.toEqual([
      expect.objectContaining({
        sessionId: session.sessionId,
        title: 'Bootstrap 初始化',
        state: 'completed',
      }),
    ])
  })
  it('auto-deletes bootstrap.md when both controlled tools succeed', async () => {
    const gateway = createPiSdkGateway({
      createSession: async (request) => {
        const handle = {
          ...createPromptingHandle(
            request.sessionId,
            undefined,
            request.sdkSessionFile,
          ),
          prompts: [] as string[],
          systemPromptContexts: [] as string[],
          setSystemPromptContext(context: string) {
            this.systemPromptContexts.push(context)
          },
          prompt: async (prompt: string) => {
            handle.prompts.push(prompt)
            // Agent 调用两个受控工具完成初始化
            await request.onUpdateSoul('# Soul\n只说中文。')
            await request.onUpdateUserProfile('# User\n简洁回答。')
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
    const { runtime, rootPath, homePath } = await createDriver({ gateway })

    await runtime.getRuntimeSnapshot()
    await runtime.saveRuntimeConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    const session = await runtime.createSession({
      agentId: 'yuanxiao',
      title: 'Bootstrap 初始化',
    })
    await runtime.sendMessage({
      agentId: 'yuanxiao',
      sessionId: session.sessionId,
      content: '请开始初始化。',
    })

    const resolvedHomePath = join(rootPath, homePath.slice(2))
    const sharedProfilePath = join(rootPath, '.yuanxiao/profile')
    // soul.md 和 user.md 存在
    await expect(
      readFile(join(resolvedHomePath, 'soul.md'), 'utf8'),
    ).resolves.toContain('# Soul')
    await expect(
      readFile(join(sharedProfilePath, 'user.md'), 'utf8'),
    ).resolves.toContain('# User')
    // bootstrap.md 被 runtime 自动清理
    await expect(
      readFile(join(resolvedHomePath, 'bootstrap.md'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    // 快照反映已初始化状态
    await expect(runtime.getRuntimeSnapshot()).resolves.toMatchObject({
      activeAgent: {
        profile: {
          initialized: true,
          bootstrapRequired: false,
        },
      },
    })
  })
  it('keeps bootstrap.md when only update_soul succeeds', async () => {
    const gateway = createPiSdkGateway({
      createSession: async (request) => {
        const handle = {
          ...createPromptingHandle(
            request.sessionId,
            undefined,
            request.sdkSessionFile,
          ),
          prompts: [] as string[],
          systemPromptContexts: [] as string[],
          setSystemPromptContext(context: string) {
            this.systemPromptContexts.push(context)
          },
          prompt: async (prompt: string) => {
            handle.prompts.push(prompt)
            // 只调用 update_soul，不调用 update_user_profile
            await request.onUpdateSoul('# Soul\n部分初始化。')
            return 'Agent 灵魂已保存，请继续告诉我你的偏好。'
          },
          abort: async () => undefined,
          dispose: () => undefined,
        }
        gateway.sessionRequests.push(request)
        gateway.sessionHandles.push(handle)
        return handle
      },
    })
    const { runtime, rootPath, homePath } = await createDriver({ gateway })

    await runtime.getRuntimeSnapshot()
    await runtime.saveRuntimeConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    const session = await runtime.createSession({
      agentId: 'yuanxiao',
      title: 'Bootstrap 初始化',
    })
    await runtime.sendMessage({
      agentId: 'yuanxiao',
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
      readFile(join(rootPath, '.yuanxiao/profile/user.md'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    // bootstrap.md 仍存在（初始化阻断保留）
    await expect(
      readFile(join(resolvedHomePath, 'bootstrap.md'), 'utf8'),
    ).resolves.toContain('# Bootstrap')
    // 仍未初始化（soul.md 存在但 user.md 缺失）
    await expect(runtime.getRuntimeSnapshot()).resolves.toMatchObject({
      activeAgent: {
        profile: {
          initialized: false,
        },
      },
    })
  })
  it('keeps bootstrap.md when only update_user_profile succeeds', async () => {
    const gateway = createPiSdkGateway({
      createSession: async (request) => {
        const handle = {
          ...createPromptingHandle(
            request.sessionId,
            undefined,
            request.sdkSessionFile,
          ),
          prompts: [] as string[],
          systemPromptContexts: [] as string[],
          setSystemPromptContext(context: string) {
            this.systemPromptContexts.push(context)
          },
          prompt: async (prompt: string) => {
            handle.prompts.push(prompt)
            // 只调用 update_user_profile，不调用 update_soul
            await request.onUpdateUserProfile('# User\n部分初始化。')
            return '用户画像已保存。'
          },
          abort: async () => undefined,
          dispose: () => undefined,
        }
        gateway.sessionRequests.push(request)
        gateway.sessionHandles.push(handle)
        return handle
      },
    })
    const { runtime, rootPath, homePath } = await createDriver({ gateway })

    await runtime.getRuntimeSnapshot()
    await runtime.saveRuntimeConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    const session = await runtime.createSession({
      agentId: 'yuanxiao',
      title: 'Bootstrap 初始化',
    })
    await runtime.sendMessage({
      agentId: 'yuanxiao',
      sessionId: session.sessionId,
      content: '请开始初始化。',
    })

    const resolvedHomePath = join(rootPath, homePath.slice(2))
    // user.md 存在于共享路径
    await expect(
      readFile(join(rootPath, '.yuanxiao/profile/user.md'), 'utf8'),
    ).resolves.toContain('# User')
    // soul.md 不存在
    await expect(
      readFile(join(resolvedHomePath, 'soul.md'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    // bootstrap.md 仍存在（初始化阻断保留）
    await expect(
      readFile(join(resolvedHomePath, 'bootstrap.md'), 'utf8'),
    ).resolves.toContain('# Bootstrap')
    await expect(runtime.getRuntimeSnapshot()).resolves.toMatchObject({
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
          ...createPromptingHandle(
            request.sessionId,
            undefined,
            request.sdkSessionFile,
          ),
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
    const { runtime, rootPath, homePath } = await createDriver({ gateway })

    await runtime.getRuntimeSnapshot()
    await runtime.saveRuntimeConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    const session = await runtime.createSession({
      agentId: 'yuanxiao',
      title: 'Bootstrap 初始化',
    })
    await runtime.sendMessage({
      agentId: 'yuanxiao',
      sessionId: session.sessionId,
      content: '请开始初始化。',
    })

    const resolvedHomePath = join(rootPath, homePath.slice(2))
    const sharedProfilePath = join(rootPath, '.yuanxiao/profile')
    // 两个 profile 文件都不存在（Agent Home 和共享路径均无）
    await expect(
      readFile(join(resolvedHomePath, 'soul.md'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(
      readFile(join(resolvedHomePath, 'user.md'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(
      readFile(join(sharedProfilePath, 'user.md'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    // bootstrap.md 被重建
    await expect(
      readFile(join(resolvedHomePath, 'bootstrap.md'), 'utf8'),
    ).resolves.toContain('# Bootstrap')
    await expect(runtime.getRuntimeSnapshot()).resolves.toMatchObject({
      activeAgent: {
        profile: {
          initialized: false,
        },
      },
    })
  })
  it('keeps bootstrap active across turns when the agent calls one tool at a time', async () => {
    let turnCount = 0
    const gateway = createPiSdkGateway({
      createSession: async (request) => {
        const handle = {
          ...createPromptingHandle(
            request.sessionId,
            undefined,
            request.sdkSessionFile,
          ),
          prompts: [] as string[],
          systemPromptContexts: [] as string[],
          setSystemPromptContext(context: string) {
            this.systemPromptContexts.push(context)
          },
          prompt: async (prompt: string) => {
            handle.prompts.push(prompt)
            turnCount++
            if (turnCount === 1) {
              // 第一回合：只调用 update_soul
              await request.onUpdateSoul('# Soul\n第一回合。')
              return 'Agent 灵魂已保存，请继续告诉我你的偏好。'
            }
            // 第二回合：调用 update_user_profile
            await request.onUpdateUserProfile('# User\n第二回合。')
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
    const { runtime, rootPath, homePath } = await createDriver({ gateway })

    await runtime.getRuntimeSnapshot()
    await runtime.saveRuntimeConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    const session = await runtime.createSession({
      agentId: 'yuanxiao',
      title: 'Bootstrap 初始化',
    })
    await runtime.sendMessage({
      agentId: 'yuanxiao',
      sessionId: session.sessionId,
      content: '我想用中文。',
    })

    const resolvedHomePath = join(rootPath, homePath.slice(2))
    const sharedProfilePath = join(rootPath, '.yuanxiao/profile')
    // 第一回合后：soul.md 存在，user.md 不存在，bootstrap.md 仍存在
    await expect(
      readFile(join(resolvedHomePath, 'soul.md'), 'utf8'),
    ).resolves.toContain('# Soul')
    await expect(
      readFile(join(sharedProfilePath, 'user.md'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(
      readFile(join(resolvedHomePath, 'bootstrap.md'), 'utf8'),
    ).resolves.toContain('# Bootstrap')
    await expect(runtime.getRuntimeSnapshot()).resolves.toMatchObject({
      activeAgent: {
        profile: {
          initialized: false,
        },
      },
    })

    // 第二回合
    await runtime.sendMessage({
      agentId: 'yuanxiao',
      sessionId: session.sessionId,
      content: '我喜欢简洁回答。',
    })

    // 第二回合后：两个 profile 都存在，bootstrap.md 被 Runtime 删除
    await expect(
      readFile(join(resolvedHomePath, 'soul.md'), 'utf8'),
    ).resolves.toContain('# Soul')
    await expect(
      readFile(join(sharedProfilePath, 'user.md'), 'utf8'),
    ).resolves.toContain('# User')
    await expect(
      readFile(join(resolvedHomePath, 'bootstrap.md'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(runtime.getRuntimeSnapshot()).resolves.toMatchObject({
      activeAgent: {
        profile: {
          initialized: true,
          bootstrapRequired: false,
        },
      },
    })
  })
})
