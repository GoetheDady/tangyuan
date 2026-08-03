import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { type AgentEvent } from './index'
import {
  cleanupTempDirs,
  createDriver,
  createDriverAtPath,
  createFakeEncryptionAdapter,
  createPiSdkGateway,
} from './pi-sdk-driver.test-helpers'

afterEach(cleanupTempDirs)

describe('PiSdkDriver', () => {
  it('preserves bootstrap state after simulating an app restart', async () => {
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
    const { runtime, rootPath, userDataPath, homePath } = await createDriver({
      gateway,
    })

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

    // 模拟重启：创建新 driver 指向同一持久化目录
    const restartedRuntime = createDriverAtPath({ rootPath, userDataPath })
    const snapshot = await restartedRuntime.getRuntimeSnapshot()

    expect(snapshot.activeAgent.profile).toMatchObject({
      initialized: false,
    })

    const resolvedHomePath = join(rootPath, homePath.slice(2))
    const sharedProfilePath = join(rootPath, '.yuanxiao/profile')
    await expect(
      readFile(join(resolvedHomePath, 'soul.md'), 'utf8'),
    ).resolves.toContain('# Soul')
    await expect(
      readFile(join(resolvedHomePath, 'bootstrap.md'), 'utf8'),
    ).resolves.toContain('# Bootstrap')
    await expect(
      readFile(join(resolvedHomePath, 'user.md'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(
      readFile(join(sharedProfilePath, 'user.md'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('enters normal conversation after bootstrap completes without a hidden maintenance turn', async () => {
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
              // Bootstrap 回合：使用受控工具完成初始化
              await request.onUpdateSoul('# Soul\n只说中文。')
              await request.onUpdateUserProfile('# User\n简洁回答。')
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
    const { runtime } = await createDriver({ gateway })

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

    // 第一回合：bootstrap
    await runtime.sendMessage({
      agentId: 'yuanxiao',
      sessionId: session.sessionId,
      content: '请开始初始化。',
    })

    // Bootstrap 回合：初始身份上下文（建会话时注入）包含 bootstrap 指令，
    // 消息只有用户原文。
    expect(gateway.sessionHandles[0]?.systemPromptContexts[0]).toContain(
      '# Bootstrap',
    )
    expect(gateway.sessionHandles[0]?.prompts[0]).toBe('请开始初始化。')
    await expect(runtime.getRuntimeSnapshot()).resolves.toMatchObject({
      activeAgent: {
        profile: { initialized: true, bootstrapRequired: false },
      },
    })

    // 第二回合：正常对话
    await runtime.sendMessage({
      agentId: 'yuanxiao',
      sessionId: session.sessionId,
      content: '记住我喜欢用 TypeScript。',
    })

    // bootstrap 完成后刷新出的身份上下文包含 profile 而非 bootstrap。
    const latestContext = gateway.sessionHandles[0]?.systemPromptContexts.at(-1)
    expect(latestContext).toContain('# Soul')
    expect(latestContext).toContain('# User')
    expect(latestContext).not.toContain('bootstrap.md')
    // 消息只有用户原文，不拼 profile。
    expect(gateway.sessionHandles[0]?.prompts[1]).toBe(
      '记住我喜欢用 TypeScript。',
    )
    // bootstrap 主回合与正常主回合各调用一次 prompt，不追加隐藏维护回合。
    expect(gateway.sessionHandles[0]?.prompts.length).toBe(2)
  })
  it('blocks real session creation when configuration is missing', async () => {
    const { runtime } = await createDriver()

    await expect(
      runtime.createSession({
        agentId: 'yuanxiao',
        title: '新会话',
      }),
    ).rejects.toMatchObject({
      code: 'configuration-missing',
      message: expect.stringContaining('请先配置 Provider'),
    })
  })
  it('rejects messages whose agentId does not own the session', async () => {
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

    await expect(
      runtime.sendMessage({
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
    const { runtime, userDataPath } = await createDriver({ gateway })
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
    await expect(runtime.getRuntimeSnapshot()).resolves.toMatchObject({
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
    const { runtime, userDataPath } = await createDriver({
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

    await expect(runtime.getRuntimeSnapshot()).resolves.toMatchObject({
      configRecovery: {
        state: 'migration-failed',
        hasBackup: false,
      },
    })
  })
  it('refuses to save configuration when the encryption adapter is unavailable', async () => {
    const gateway = createPiSdkGateway()
    const { runtime } = await createDriver({
      gateway,
      encryptionAdapter: null,
    })

    await expect(
      runtime.saveRuntimeConfiguration({
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
    const { runtime } = await createDriver({
      gateway,
      encryptionAdapter: {
        encrypt: async () => 'encrypted:test',
        decrypt: async () => 'test',
        isAvailable: () => false,
      },
    })

    await expect(
      runtime.saveRuntimeConfiguration({
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
    const { runtime, userDataPath } = await createDriver({ gateway })
    const configPath = join(userDataPath, 'config.json')

    await mkdir(userDataPath, { recursive: true })
    await writeFile(configPath, 'not valid json {{{', 'utf8')

    await expect(runtime.getRuntimeSnapshot()).resolves.toMatchObject({
      configRecovery: {
        state: 'corrupted',
        hasBackup: false,
      },
    })
  })
  it('reports corrupted recovery state when v2 config fails schema validation', async () => {
    const gateway = createPiSdkGateway()
    const { runtime, userDataPath } = await createDriver({ gateway })
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

    await expect(runtime.getRuntimeSnapshot()).resolves.toMatchObject({
      configRecovery: {
        state: 'corrupted',
        hasBackup: false,
      },
    })
  })
  it('creates a backup file before each write and reports hasBackup: true', async () => {
    const gateway = createPiSdkGateway()
    const { runtime, userDataPath } = await createDriver({ gateway })

    // 第一次保存不会创建备份（因为旧文件不存在）
    await runtime.saveRuntimeConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })

    // 第二次保存时旧文件存在，会先备份再写入
    await runtime.saveRuntimeConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-opus-4-8',
      apiKey: 'sk-test-secret-9999',
    })

    const backupPath = join(userDataPath, 'config.backup.json')
    await expect(readFile(backupPath, 'utf8')).resolves.toContain('encrypted:')

    // 快照应报告备份存在
    await expect(runtime.getRuntimeSnapshot()).resolves.toMatchObject({
      configRecovery: {
        hasBackup: true,
      },
    })
  })
  it('restores configuration from a valid backup file', async () => {
    const gateway = createPiSdkGateway()
    const { runtime, userDataPath } = await createDriver({ gateway })

    // 保存第一次
    await runtime.saveRuntimeConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    // 保存第二次（此时会创建备份）
    await runtime.saveRuntimeConfiguration({
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
    await expect(runtime.getRuntimeSnapshot()).resolves.toMatchObject({
      configRecovery: { state: 'corrupted', hasBackup: true },
    })

    // 从备份恢复
    await expect(runtime.restoreFromBackup()).resolves.toMatchObject({
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
    const { runtime } = await createDriver({ gateway })

    await expect(runtime.restoreFromBackup()).rejects.toMatchObject({
      code: 'configuration-missing',
      message: expect.stringContaining('没有可用的配置备份'),
    })
  })
  it('rejects restore when the backup file is corrupted', async () => {
    const gateway = createPiSdkGateway()
    const { runtime, userDataPath } = await createDriver({ gateway })

    // 保存一次以创建目录
    await runtime.saveRuntimeConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })

    // 写入损坏的备份
    const backupPath = join(userDataPath, 'config.backup.json')
    await writeFile(backupPath, 'not valid json', 'utf8')

    await expect(runtime.restoreFromBackup()).rejects.toMatchObject({
      code: 'configuration-missing',
      message: expect.stringContaining('备份文件已损坏'),
    })
  })
  it('rejects restore when backup has valid JSON but invalid schema', async () => {
    const gateway = createPiSdkGateway()
    const { runtime, userDataPath } = await createDriver({ gateway })

    await runtime.saveRuntimeConfiguration({
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

    await expect(runtime.restoreFromBackup()).rejects.toMatchObject({
      code: 'configuration-missing',
      message: expect.stringContaining('备份文件格式不兼容'),
    })
  })
  it('resets configuration by deleting config and backup files while preserving agent home', async () => {
    const gateway = createPiSdkGateway()
    const { runtime, userDataPath, rootPath, homePath } = await createDriver({
      gateway,
    })

    // 保存第一次
    await runtime.saveRuntimeConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    // 保存第二次（此时会创建备份）
    await runtime.saveRuntimeConfiguration({
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
    await runtime.resetConfiguration()

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
    await expect(runtime.getRuntimeSnapshot()).resolves.toMatchObject({
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
    const { runtime, userDataPath } = await createDriver({
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
          yuanxiao: {
            displayName: '元宵',
            defaultProviderId: 'anthropic',
            defaultModelId: 'claude-sonnet-4-5',
            status: 'active',
            archivedAt: null,
          },
        },
      }),
      'utf8',
    )

    await expect(runtime.getRuntimeSnapshot()).resolves.toMatchObject({
      configRecovery: {
        state: 'corrupted',
        hasBackup: false,
      },
    })
  })
  it('refuses to create a session when config is in corrupted state', async () => {
    const gateway = createPiSdkGateway()
    const { runtime, userDataPath } = await createDriver({ gateway })
    const configPath = join(userDataPath, 'config.json')

    await mkdir(userDataPath, { recursive: true })
    await writeFile(configPath, 'corrupted {{{', 'utf8')

    await expect(
      runtime.createSession({ agentId: 'yuanxiao', title: '新会话' }),
    ).rejects.toMatchObject({
      code: 'configuration-missing',
      message: expect.stringContaining('配置文件已损坏'),
    })
  })
  it('enforces sequential config writes use temp file + atomic rename', async () => {
    const gateway = createPiSdkGateway()
    const { runtime, userDataPath } = await createDriver({ gateway })

    await runtime.saveRuntimeConfiguration({
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
    const { runtime, rootPath } = await createDriver({ gateway })

    await runtime.saveRuntimeConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })

    const agent = await runtime.createAgent('代码助手')

    expect(agent.agentId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(agent.displayName).toBe('代码助手')
    expect(agent.status).toBe('active')
    expect(agent.defaultProviderId).toBe('anthropic')
    expect(agent.defaultModelId).toBe('claude-sonnet-4-5')

    const homePath = join(rootPath, '.yuanxiao/agents', agent.agentId)
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
    const { runtime } = await createDriver({ gateway })
    const events: AgentEvent[] = []
    runtime.subscribe((event) => {
      events.push(event)
    })

    await runtime.saveRuntimeConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    const agent = await runtime.createAgent('测试助手')

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
    const { runtime } = await createDriver({ gateway })

    await runtime.saveRuntimeConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })

    const agentOne = await runtime.createAgent('助手')
    const agentTwo = await runtime.createAgent('助手')

    expect(agentOne.agentId).not.toBe(agentTwo.agentId)
    expect(agentOne.displayName).toBe('助手')
    expect(agentTwo.displayName).toBe('助手')
  })
  it('persists agent config and restores after simulated restart', async () => {
    const gateway = createPiSdkGateway()
    const { runtime, rootPath, userDataPath } = await createDriver({ gateway })

    await runtime.saveRuntimeConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })

    const created = await runtime.createAgent('跨重启助手')

    // 模拟重启：用相同的 userDataPath 创建新 driver
    const restartedRuntime = createDriverAtPath({
      gateway,
      rootPath,
      userDataPath,
    })
    const agents = await restartedRuntime.listAgents()

    expect(agents).toHaveLength(2)
    expect(agents[0]).toMatchObject({ agentId: 'yuanxiao' })
    expect(agents[1]).toMatchObject({
      agentId: created.agentId,
      displayName: '跨重启助手',
      status: 'active',
    })
  })
})
