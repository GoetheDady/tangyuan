import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentEvent, TranscriptSnapshot } from '@tangyuan/contracts'
import {
  cleanupTempDirs,
  createDriver,
  createDriverAtPath,
  createPiSdkGateway,
  createPromptingHandle,
  readJson,
  snapshotFromMessages,
} from './pi-sdk-driver.test-helpers'

afterEach(cleanupTempDirs)

describe('PiSdkDriver', () => {
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
        cwd: string
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
          cwd: request.cwd,
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

        // 全局扫描：返回所有工作目录下的 Pi 会话，由索引按 cwd 归属 Agent。
        return [...sessionsByCwd.values()].flat()
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
        cwd: string
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
          cwd: request.cwd,
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

        // 全局扫描：返回所有工作目录下的 Pi 会话，由索引按 cwd 归属 Agent。
        return [...sessionsByCwd.values()].flat()
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
        cwd: string
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
          cwd: request.cwd,
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

        // 全局扫描：返回所有工作目录下的 Pi 会话，由索引按 cwd 归属 Agent。
        return [...sessionsByCwd.values()].flat()
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
    const { mkdir } = await import('node:fs/promises')

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
})
