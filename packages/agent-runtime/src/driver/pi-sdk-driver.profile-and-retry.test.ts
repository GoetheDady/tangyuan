import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  type AgentEvent,
  type PiSdkPromptOptions,
  type PiSdkSessionHandle,
} from './index'
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
  // ===== profile 测试 =====

  it('reads soul content from the correct agent path', async () => {
    const { runtime, rootPath } = await createDriver()
    const { writeFile } = await import('node:fs/promises')

    // 先初始化 driver
    await runtime.getRuntimeSnapshot()
    // 写入一个已知的 soul.md
    const resolvedHomePath = join(rootPath, '.yuanxiao/agents/yuanxiao')
    await writeFile(
      join(resolvedHomePath, 'soul.md'),
      '# 元宵\n自定义 soul 内容。',
      'utf8',
    )

    const soul = await runtime.getSoul('yuanxiao')

    expect(soul.agentId).toBe('yuanxiao')
    expect(soul.content).toBe('# 元宵\n自定义 soul 内容。')
    expect(soul.updatedAt).toBeTruthy()
  })
  it('reads shared user profile from the shared profile path', async () => {
    const { runtime, rootPath } = await createDriver()
    const { mkdir } = await import('node:fs/promises')

    // 先初始化 driver
    await runtime.getRuntimeSnapshot()
    // 写入共享 user profile
    const profileDir = join(rootPath, '.yuanxiao/profile')
    await mkdir(profileDir, { recursive: true })
    await mkdir(join(profileDir, 'user.history'), { recursive: true })
    await writeFile(
      join(profileDir, 'user.md'),
      '# User\n共享用户偏好。',
      'utf8',
    )

    const userProfile = await runtime.getUserProfile()

    expect(userProfile.content).toBe('# User\n共享用户偏好。')
    expect(userProfile.updatedAt).toBeTruthy()
  })
  it('migrates legacy user.md from yuanxiao agent directory to shared profile path', async () => {
    const { runtime, rootPath } = await createDriver()
    const { writeFile, readFile } = await import('node:fs/promises')

    // 先初始化 driver 创建目录
    await runtime.getRuntimeSnapshot()

    // 模拟旧结构：在 yuanxiao agent 目录下写入 user.md
    const agentDir = join(rootPath, '.yuanxiao/agents/yuanxiao')
    await writeFile(
      join(agentDir, 'user.md'),
      '# Legacy User\n旧用户资料。',
      'utf8',
    )

    // 读取 user profile 应触发迁移
    const userProfile = await runtime.getUserProfile()

    expect(userProfile.content).toBe('# Legacy User\n旧用户资料。')

    // 验证文件已迁移到共享路径
    const sharedPath = join(rootPath, '.yuanxiao/profile/user.md')
    const migratedContent = await readFile(sharedPath, 'utf8')
    expect(migratedContent).toBe('# Legacy User\n旧用户资料。')
  })
  it('updates an agent soul and emits a profile-updated event', async () => {
    const { runtime, rootPath } = await createDriver()
    const { writeFile } = await import('node:fs/promises')

    await runtime.getRuntimeSnapshot()

    // 写入初始 soul
    const resolvedHomePath = join(rootPath, '.yuanxiao/agents/yuanxiao')
    await writeFile(
      join(resolvedHomePath, 'soul.md'),
      '# 元宵\n旧 soul。',
      'utf8',
    )

    // 监听事件
    const events: AgentEvent[] = []
    runtime.subscribe((event) => {
      events.push(event)
    })

    const current = await runtime.getSoul('yuanxiao')

    const result = await runtime.updateSoul(
      'yuanxiao',
      '# 元宵\n新 soul 内容。',
      current.version,
    )

    expect(result).toMatchObject({ target: 'soul', status: 'updated' })

    // 验证文件已更新
    const { readFile } = await import('node:fs/promises')
    const updatedContent = await readFile(
      join(resolvedHomePath, 'soul.md'),
      'utf8',
    )
    expect(updatedContent).toBe('# 元宵\n新 soul 内容。')

    // 验证事件已发出
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'profile-updated',
          agentId: 'yuanxiao',
          target: 'soul',
        }),
      ]),
    )
  })
  it('creates another agent soul without an empty backup', async () => {
    const { runtime, rootPath } = await createDriver()
    const { mkdir } = await import('node:fs/promises')

    await runtime.getRuntimeSnapshot()

    // 为 agent-b 创建目录结构
    const agentBPath = join(rootPath, '.yuanxiao/agents/agent-b')
    await mkdir(agentBPath, { recursive: true })
    await mkdir(join(agentBPath, 'soul.history'), { recursive: true })
    await mkdir(join(agentBPath, 'memory'), { recursive: true })
    await mkdir(join(agentBPath, 'skills'), { recursive: true })

    const current = await runtime.getSoul('agent-b')
    const result = await runtime.updateSoul(
      'agent-b',
      '# Agent B\n新创建 Agent 的初始 soul。',
      current.version,
    )

    expect(result.status).toBe('updated')

    // 验证文件已创建
    const { readFile } = await import('node:fs/promises')
    const content = await readFile(join(agentBPath, 'soul.md'), 'utf8')
    expect(content).toContain('新创建 Agent')
  })
  it('rejects sensitive content from soul updates', async () => {
    const gateway = createPiSdkGateway()
    const { runtime, rootPath } = await createDriver({ gateway })
    const { writeFile } = await import('node:fs/promises')

    await runtime.getRuntimeSnapshot()

    // 先保存一个 API Key 配置
    await runtime.saveRuntimeConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })

    // 重新获取 driver 状态
    const resolvedHomePath = join(rootPath, '.yuanxiao/agents/yuanxiao')
    await writeFile(
      join(resolvedHomePath, 'soul.md'),
      '# 元宵\n旧 soul。',
      'utf8',
    )

    const current = await runtime.getSoul('yuanxiao')
    const result = await runtime.updateSoul(
      'yuanxiao',
      '# 元宵\n我的 API Key 是 sk-test-secret-7890。',
      current.version,
    )

    expect(result).toMatchObject({
      status: 'rejected',
      reason: { code: 'sensitive-content' },
    })

    const { readFile } = await import('node:fs/promises')
    const content = await readFile(join(resolvedHomePath, 'soul.md'), 'utf8')
    expect(content).not.toContain('sk-test-secret-7890')
    expect(content).toBe('# 元宵\n旧 soul。')
  })
  it('automatically backs up the old soul before updating', async () => {
    const { runtime, rootPath } = await createDriver()
    const { writeFile } = await import('node:fs/promises')

    await runtime.getRuntimeSnapshot()

    // 写入初始 soul（不创建备份）
    const resolvedHomePath = join(rootPath, '.yuanxiao/agents/yuanxiao')
    await writeFile(
      join(resolvedHomePath, 'soul.md'),
      '# 元宵\n旧 soul。',
      'utf8',
    )

    const current = await runtime.getSoul('yuanxiao')
    const result = await runtime.updateSoul(
      'yuanxiao',
      '# 元宵\n新 soul。',
      current.version,
    )

    expect(result.status).toBe('updated')
    const historyFiles = await import('node:fs/promises').then(({ readdir }) =>
      readdir(join(resolvedHomePath, 'soul.history')),
    )
    expect(historyFiles).toHaveLength(1)
    await expect(
      readFile(
        join(resolvedHomePath, 'soul.history', historyFiles[0]!),
        'utf8',
      ),
    ).resolves.toBe('# 元宵\n旧 soul。')
  })
  it('binds update_soul to the current session Agent and reloads after generation', async () => {
    let reloadCount = 0
    let reloadCountDuringTool = -1
    const gateway = createPiSdkGateway({
      createSession: async (request) => {
        const handle: PiSdkSessionHandle = {
          ...createPromptingHandle(
            request.sessionId,
            undefined,
            request.sdkSessionFile,
          ),
          setSystemPromptContext: () => undefined,
          reload: async () => {
            reloadCount++
          },
          prompt: async () => {
            const result = await request.onUpdateSoul('# 元宵\n由工具更新。')
            expect(result.status).toBe('updated')
            reloadCountDuringTool = reloadCount
            return '灵魂已更新。'
          },
          abort: async () => undefined,
          dispose: () => undefined,
        }
        gateway.sessionRequests.push(request)
        return handle
      },
    })
    const { runtime } = await createDriver({ gateway })
    const events: AgentEvent[] = []
    runtime.subscribe((event) => events.push(event))

    await runtime.saveRuntimeConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    const agent = await runtime.createAgent('工具更新助手')
    const defaultSoulBefore = await runtime.getSoul('yuanxiao')
    const session = await runtime.createSession({
      agentId: agent.agentId,
      title: '工具更新',
    })
    expect(gateway.sessionRequests[0]?.onUpdateSoul).toBeTypeOf('function')

    await runtime.sendMessage({
      agentId: agent.agentId,
      sessionId: session.sessionId,
      content: '更新你的灵魂',
    })
    const transcript = await runtime.getTranscript({
      agentId: agent.agentId,
      sessionId: session.sessionId,
    })

    expect(reloadCountDuringTool).toBe(1)
    expect(reloadCount).toBe(2)
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'profile-updated',
          agentId: agent.agentId,
          target: 'soul',
        }),
      ]),
    )
    expect(transcript.entries).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'system-message' }),
      ]),
    )
    await expect(runtime.getSoul(agent.agentId)).resolves.toMatchObject({
      content: '# 元宵\n由工具更新。',
    })
    await expect(runtime.getSoul('yuanxiao')).resolves.toEqual(
      defaultSoulBefore,
    )
  })
  it('updates the default Agent during its normal turn without duplicate events or system messages', async () => {
    const prompts: string[] = []
    const gateway = createPiSdkGateway({
      createSession: async (request) => {
        const handle: PiSdkSessionHandle = {
          ...createPromptingHandle(
            request.sessionId,
            undefined,
            request.sdkSessionFile,
          ),
          setSystemPromptContext: () => undefined,
          reload: async () => undefined,
          prompt: async (prompt) => {
            prompts.push(prompt)
            await request.onUpdateSoul('# 元宵\n正常回合内更新。')
            return '已完成更新。'
          },
          abort: async () => undefined,
          dispose: () => undefined,
        }
        gateway.sessionRequests.push(request)
        return handle
      },
    })
    const { runtime, rootPath, homePath } = await createDriver({ gateway })
    const events: AgentEvent[] = []
    runtime.subscribe((event) => events.push(event))

    await writeInitializedProfile(join(rootPath, homePath.slice(2)), rootPath)
    await runtime.saveRuntimeConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    const session = await runtime.createSession({
      agentId: 'yuanxiao',
      title: '默认 Agent 工具更新',
    })
    await runtime.sendMessage({
      agentId: 'yuanxiao',
      sessionId: session.sessionId,
      content: '更新你的灵魂',
    })

    expect(prompts).toEqual(['更新你的灵魂'])
    expect(
      events.filter(
        (event) => event.type === 'profile-updated' && event.target === 'soul',
      ),
    ).toHaveLength(1)
    await expect(
      runtime.getTranscript({
        agentId: 'yuanxiao',
        sessionId: session.sessionId,
      }),
    ).resolves.toMatchObject({
      entries: expect.not.arrayContaining([
        expect.objectContaining({ kind: 'system-message' }),
      ]),
    })
  })
  it('updates the shared user profile during a normal turn without duplicate events or system messages', async () => {
    const gateway = createPiSdkGateway({
      createSession: async (request) => {
        const handle: PiSdkSessionHandle = {
          ...createPromptingHandle(
            request.sessionId,
            undefined,
            request.sdkSessionFile,
          ),
          setSystemPromptContext: () => undefined,
          reload: async () => undefined,
          prompt: async () => {
            await request.onUpdateUserProfile('# User\n正常回合内更新。')
            return '已完成更新。'
          },
          abort: async () => undefined,
          dispose: () => undefined,
        }
        gateway.sessionRequests.push(request)
        return handle
      },
    })
    const { runtime, rootPath, homePath } = await createDriver({ gateway })
    const events: AgentEvent[] = []
    runtime.subscribe((event) => events.push(event))

    await writeInitializedProfile(join(rootPath, homePath.slice(2)), rootPath)
    await runtime.saveRuntimeConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    const session = await runtime.createSession({
      agentId: 'yuanxiao',
      title: '共享画像工具更新',
    })
    await runtime.sendMessage({
      agentId: 'yuanxiao',
      sessionId: session.sessionId,
      content: '记住我的偏好',
    })

    expect(
      events.filter(
        (event) => event.type === 'profile-updated' && event.target === 'user',
      ),
    ).toHaveLength(1)
    await expect(
      runtime.getTranscript({
        agentId: 'yuanxiao',
        sessionId: session.sessionId,
      }),
    ).resolves.toMatchObject({
      entries: expect.not.arrayContaining([
        expect.objectContaining({ kind: 'system-message' }),
      ]),
    })
  })

  it('binds shared profile updates to the session-observed version and refreshes every active session', async () => {
    const gateway = createPiSdkGateway()
    const { runtime, rootPath, homePath } = await createDriver({ gateway })
    await writeInitializedProfile(join(rootPath, homePath.slice(2)), rootPath)
    await runtime.saveRuntimeConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })

    const first = await runtime.createSession({
      agentId: 'yuanxiao',
      title: '第一会话',
    })
    await runtime.createSession({ agentId: 'yuanxiao', title: '第二会话' })
    const firstRequest = gateway.sessionRequests.find(
      (request) => request.sessionId === first.sessionId,
    )
    expect(firstRequest).toBeDefined()

    const observed = await runtime.getUserProfile()
    await expect(
      firstRequest?.onUpdateUserProfile('# User\n共享新偏好。'),
    ).resolves.toMatchObject({ status: 'updated' })
    expect(
      gateway.sessionHandles[0]?.systemPromptContexts.length,
    ).toBeGreaterThan(1)
    expect(
      gateway.sessionHandles[1]?.systemPromptContexts.length,
    ).toBeGreaterThan(1)

    await expect(
      runtime.updateUserProfile('# User\n过期覆盖。', observed.version),
    ).resolves.toMatchObject({
      status: 'rejected',
      reason: { code: 'version-conflict' },
    })
  })

  it('keeps a successful tool update after cancellation and avoids duplicate backups on retry', async () => {
    const updateCompleted = createDeferred<void>()
    const releasePrompt = createDeferred<void>()
    let cancelled = false
    const gateway = createPiSdkGateway({
      createSession: async (request) => {
        const handle: PiSdkSessionHandle = {
          ...createPromptingHandle(
            request.sessionId,
            undefined,
            request.sdkSessionFile,
          ),
          setSystemPromptContext: () => undefined,
          reload: async () => undefined,
          prompt: async () => {
            await request.onUpdateSoul('# 元宵\n取消前已更新。')
            updateCompleted.resolve()
            await releasePrompt.promise
            if (cancelled) throw new DOMException('Aborted', 'AbortError')
            return '完成'
          },
          abort: async () => {
            cancelled = true
            releasePrompt.resolve()
          },
          dispose: () => undefined,
        }
        gateway.sessionRequests.push(request)
        return handle
      },
    })
    const { runtime, rootPath } = await createDriver({ gateway })

    await runtime.saveRuntimeConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    const initial = await runtime.getSoul('yuanxiao')
    await runtime.updateSoul('yuanxiao', '# 元宵\n更新前。', initial.version)
    const session = await runtime.createSession({
      agentId: 'yuanxiao',
      title: '取消后保留更新',
    })
    const sendPromise = runtime.sendMessage({
      agentId: 'yuanxiao',
      sessionId: session.sessionId,
      content: '更新后取消',
    })
    await updateCompleted.promise

    await runtime.cancelRun({
      agentId: 'yuanxiao',
      sessionId: session.sessionId,
    })
    await sendPromise

    await expect(runtime.getSoul('yuanxiao')).resolves.toMatchObject({
      content: '# 元宵\n取消前已更新。',
    })
    await expect(
      gateway.sessionRequests[0]?.onUpdateSoul('# 元宵\n取消前已更新。'),
    ).resolves.toMatchObject({ status: 'unchanged' })
    const historyFiles = await import('node:fs/promises').then(({ readdir }) =>
      readdir(join(rootPath, '.yuanxiao/agents/yuanxiao/soul.history')),
    )
    expect(historyFiles).toHaveLength(1)
  })
  it('creates a shared user profile on first update and does not duplicate unchanged writes', async () => {
    const { runtime, rootPath } = await createDriver()
    const events: AgentEvent[] = []
    runtime.subscribe((event) => events.push(event))
    await runtime.getRuntimeSnapshot()

    const initial = await runtime.getUserProfile()
    const firstResult = await runtime.updateUserProfile(
      '# User\n首次记录的偏好。',
      initial.version,
    )

    expect(firstResult).toMatchObject({ target: 'user', status: 'updated' })
    const profileDir = join(rootPath, '.yuanxiao/profile')
    await expect(readFile(join(profileDir, 'user.md'), 'utf8')).resolves.toBe(
      '# User\n首次记录的偏好。',
    )
    await expect(
      import('node:fs/promises').then(({ readdir }) =>
        readdir(join(profileDir, 'user.history')),
      ),
    ).resolves.toEqual([])

    const unchangedResult = await runtime.updateUserProfile(
      '# User\n首次记录的偏好。',
      firstResult.version,
    )
    expect(unchangedResult).toMatchObject({
      target: 'user',
      status: 'unchanged',
    })
    expect(
      events.filter(
        (event) => event.type === 'profile-updated' && event.target === 'user',
      ),
    ).toHaveLength(1)
  })

  it('keeps shared user profile unchanged when its backup fails', async () => {
    const { runtime, rootPath } = await createDriver()
    const { mkdir, rm, writeFile } = await import('node:fs/promises')
    await runtime.getRuntimeSnapshot()

    const profileDir = join(rootPath, '.yuanxiao/profile')
    await mkdir(profileDir, { recursive: true })
    await writeFile(join(profileDir, 'user.md'), '# User\n旧偏好。', 'utf8')
    const current = await runtime.getUserProfile()
    await rm(join(profileDir, 'user.history'), { recursive: true })
    await writeFile(join(profileDir, 'user.history'), '阻止创建目录', 'utf8')

    const result = await runtime.updateUserProfile(
      '# User\n新偏好。',
      current.version,
    )

    expect(result).toMatchObject({
      target: 'user',
      status: 'rejected',
      reason: { code: 'backup-failed' },
    })
    await expect(readFile(join(profileDir, 'user.md'), 'utf8')).resolves.toBe(
      '# User\n旧偏好。',
    )
  })

  it('updates shared user profile and emits a profile-updated event', async () => {
    const { runtime, rootPath } = await createDriver()
    const { mkdir, writeFile } = await import('node:fs/promises')

    await runtime.getRuntimeSnapshot()

    // 确保共享 profile 目录存在并写入初始 user.md
    const profileDir = join(rootPath, '.yuanxiao/profile')
    await mkdir(profileDir, { recursive: true })
    await mkdir(join(profileDir, 'user.history'), { recursive: true })
    await writeFile(join(profileDir, 'user.md'), '# User\n旧偏好。', 'utf8')

    // 监听事件
    const events: AgentEvent[] = []
    runtime.subscribe((event) => {
      events.push(event)
    })

    // 备份
    await writeFile(
      join(profileDir, 'user.history/backup.md'),
      '# User\n旧偏好。',
      'utf8',
    )

    const current = await runtime.getUserProfile()
    const result = await runtime.updateUserProfile(
      '# User\n新用户偏好。',
      current.version,
    )

    expect(result).toMatchObject({ target: 'user', status: 'updated' })

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
  it('rejects sensitive content from user profile updates', async () => {
    const gateway = createPiSdkGateway()
    const { runtime, rootPath } = await createDriver({ gateway })
    const { mkdir, writeFile } = await import('node:fs/promises')

    await runtime.getRuntimeSnapshot()

    // 先保存配置
    await runtime.saveRuntimeConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })

    // 确保共享 profile 目录存在
    const profileDir = join(rootPath, '.yuanxiao/profile')
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
    const current = await runtime.getUserProfile()
    const result = await runtime.updateUserProfile(
      '# User\npassword: my-secret-pwd',
      current.version,
    )

    expect(result).toMatchObject({
      status: 'rejected',
      reason: { code: 'sensitive-content' },
    })

    // 验证敏感内容已脱敏
    const { readFile } = await import('node:fs/promises')
    const content = await readFile(join(profileDir, 'user.md'), 'utf8')
    expect(content).not.toContain('my-secret-pwd')
    expect(content).toBe('# User\n旧偏好。')
  })
  it('retry：完成后持久化带 inReplyTo 的 completed attempt', async () => {
    const gateway = createPiSdkGateway()
    const { runtime } = await createDriver({ gateway })
    const events: AgentEvent[] = []
    runtime.subscribe((event) => events.push(event))

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
      content: '你好',
    })

    const userMessageId = `${session.sessionId}-message-1`
    await runtime.retryMessage({
      agentId: 'yuanxiao',
      sessionId: session.sessionId,
      userMessageId,
    })

    await expect(runtime.listSessions('yuanxiao')).resolves.toEqual([
      expect.objectContaining({
        sessionId: session.sessionId,
        state: 'completed',
      }),
    ])
    // retry 完成会 emit attempt-started 与带 inReplyTo 的 transcript-delta
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'attempt-started' }),
        expect.objectContaining({
          type: 'transcript-delta',
          delta: expect.objectContaining({
            type: 'entry-appended',
            entry: expect.objectContaining({
              kind: 'agent-reply',
              inReplyTo: userMessageId,
            }),
          }),
        }),
      ]),
    )
    // retry 用原始用户消息内容再次 prompt
    expect(gateway.sessionHandles[0]?.prompts).toEqual(['你好', '你好'])
  })
  it('retry：运行中取消保留部分内容并置为 cancelled', async () => {
    let promptCount = 0
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
            promptCount++
            if (promptCount === 1) {
              options?.onEvent?.({ type: 'text-delta', delta: '首条' })
              return '首条'
            }
            options?.onEvent?.({ type: 'text-delta', delta: '部分' })
            runStarted.resolve()
            await releasePrompt.promise
            return '部分'
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
    await runtime.sendMessage({
      agentId: 'yuanxiao',
      sessionId: session.sessionId,
      content: '你好',
    })

    const retryPromise = runtime.retryMessage({
      agentId: 'yuanxiao',
      sessionId: session.sessionId,
      userMessageId: `${session.sessionId}-message-1`,
    })
    await runStarted.promise
    await runtime.cancelRun({
      agentId: 'yuanxiao',
      sessionId: session.sessionId,
    })

    await expect(retryPromise).resolves.toMatchObject({
      sessionId: session.sessionId,
    })
    await expect(runtime.listSessions('yuanxiao')).resolves.toEqual([
      expect.objectContaining({
        sessionId: session.sessionId,
        state: 'cancelled',
      }),
    ])
  })
  it('retry：SDK 调用失败时置为 failed 并 reject', async () => {
    let promptCount = 0
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
            promptCount++
            if (promptCount === 1) {
              options?.onEvent?.({ type: 'text-delta', delta: '首条' })
              return '首条'
            }
            throw new Error('retry provider failed')
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
    await runtime.sendMessage({
      agentId: 'yuanxiao',
      sessionId: session.sessionId,
      content: '你好',
    })

    const userMessageId = `${session.sessionId}-message-1`
    const failEvents: AgentEvent[] = []
    runtime.subscribe((event) => failEvents.push(event))
    await expect(
      runtime.retryMessage({
        agentId: 'yuanxiao',
        sessionId: session.sessionId,
        userMessageId,
      }),
    ).rejects.toThrow('retry provider failed')

    await expect(runtime.listSessions('yuanxiao')).resolves.toEqual([
      expect.objectContaining({
        sessionId: session.sessionId,
        state: 'failed',
      }),
    ])
    expect(failEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'turn-failed' }),
        expect.objectContaining({ type: 'runtime-error' }),
      ]),
    )
  })
  it('retry：找不到原始用户消息时 reject', async () => {
    const gateway = createPiSdkGateway()
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
    await runtime.sendMessage({
      agentId: 'yuanxiao',
      sessionId: session.sessionId,
      content: '你好',
    })

    await expect(
      runtime.retryMessage({
        agentId: 'yuanxiao',
        sessionId: session.sessionId,
        userMessageId: 'does-not-exist',
      }),
    ).rejects.toThrow('找不到要重试的原始用户消息')
  })
  it('retry：会话正在运行时拒绝', async () => {
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
            options?.onEvent?.({ type: 'text-delta', delta: '部分' })
            runStarted.resolve()
            await releasePrompt.promise
            return '部分'
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
      content: '你好',
    })
    await runStarted.promise

    await expect(
      runtime.retryMessage({
        agentId: 'yuanxiao',
        sessionId: session.sessionId,
        userMessageId: `${session.sessionId}-message-1`,
      }),
    ).rejects.toThrow('当前会话正在运行')

    await runtime.cancelRun({
      agentId: 'yuanxiao',
      sessionId: session.sessionId,
    })
    await expect(sendPromise).resolves.toMatchObject({
      sessionId: session.sessionId,
    })
  })
})
