import { rm, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it } from 'vitest'
import { RealPiSdkGateway } from '../runtime/gateway'
import type {
  PiSdkGateway,
  PiSdkSessionHandle,
} from './pi-sdk-driver-contracts'
import {
  cleanupTempDirs,
  createDriver,
  createDriverAtPath,
  readJson,
} from './pi-sdk-driver.test-helpers'

afterEach(cleanupTempDirs)

/**
 * 创建以真实 Pi JSONL 为唯一真相的网关：分叉、扫描和读消息都走真实 SDK，
 * 只把「调用模型」替换成向真实 session 文件追加一问一答。
 *
 * @returns 可交给 PiSdkDriver 的网关。
 */
function createRealFileGateway(): PiSdkGateway {
  const realGateway = new RealPiSdkGateway()
  let timestamp = 0

  const createHandle = (
    sessionManager: SessionManager,
    sdkSessionFile: string,
    initialProviderId: string,
    initialModelId: string,
  ): PiSdkSessionHandle => {
    // 会话运行配置的真相写回真实 Pi JSONL，重建时才能从中恢复。
    let providerId = initialProviderId
    let modelId = initialModelId
    let thinkingLevel = 'off'

    return {
      sdkSessionFile,
      prompt: async (prompt: string) => {
        sessionManager.appendMessage({
          role: 'user',
          content: prompt,
          timestamp: ++timestamp,
        })
        sessionManager.appendMessage({
          role: 'assistant',
          content: [{ type: 'text', text: `收到：${prompt}` }],
          api: 'anthropic-messages',
          provider: 'anthropic',
          model: 'test',
          usage: {
            input: 1,
            output: 1,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 2,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
            },
          },
          stopReason: 'stop',
          timestamp: ++timestamp,
        })

        return `收到：${prompt}`
      },
      abort: async () => undefined,
      dispose: () => undefined,
      setModel: async (nextProviderId: string, nextModelId: string) => {
        providerId = nextProviderId
        modelId = nextModelId
        sessionManager.appendModelChange(nextProviderId, nextModelId)
      },
      setThinkingLevel: async (level: string) => {
        thinkingLevel = level
        sessionManager.appendThinkingLevelChange(level)
      },
      getModelInfo: async () => ({
        providerId,
        modelId,
        displayName: modelId,
        thinkingLevel,
        supportedThinkingLevels: ['off', 'low', 'medium', 'high'],
        supportsThinking: true,
      }),
    }
  }

  return {
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
    verifyConfiguration: async () => undefined,
    createSession: async (request) => {
      const sessionManager = SessionManager.create(
        request.cwd,
        dirname(request.sdkSessionFile),
        { id: request.sessionId },
      )

      return createHandle(
        sessionManager,
        sessionManager.getSessionFile() ?? request.sdkSessionFile,
        request.providerId,
        request.modelId,
      )
    },
    openSession: async (request) => {
      const sessionManager = SessionManager.open(
        request.sdkSessionFile,
        dirname(request.sdkSessionFile),
        request.cwd,
      )

      return createHandle(
        sessionManager,
        request.sdkSessionFile,
        request.providerId,
        request.modelId,
      )
    },
    listSessions: async (request) => realGateway.listSessions(request),
    readMessages: async (request) => realGateway.readMessages(request),
    createBranchedSession: async (request) =>
      realGateway.createBranchedSession(request),
  }
}

/**
 * 从会话 transcript 中读取用户消息标识。
 *
 * @param driver - 当前 Driver。
 * @param sessionId - 会话标识。
 * @param content - 目标用户消息文本。
 * @returns 对应的用户消息标识。
 */
async function findUserMessageId(
  driver: Awaited<ReturnType<typeof createDriver>>['driver'],
  sessionId: string,
  content: string,
): Promise<string> {
  const transcript = await driver.getTranscript({
    agentId: 'yuanxiao',
    sessionId,
  })
  const entry = transcript.entries.find(
    (candidate) =>
      candidate.kind === 'user-message' && candidate.content === content,
  )

  if (!entry || entry.kind !== 'user-message') {
    throw new Error(`会话 ${sessionId} 中找不到用户消息「${content}」。`)
  }

  return entry.messageId
}

describe('PiSdkDriver 分叉来源与递归会话谱系', () => {
  it('以真实 Pi JSONL 支持首条消息分叉、同源多分叉与递归分叉', async () => {
    const gateway = createRealFileGateway()
    const { driver, rootPath, userDataPath } = await createDriver({ gateway })
    await driver.saveConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    const parent = await driver.createSession({
      agentId: 'yuanxiao',
      title: '父会话',
    })
    await driver.sendMessage({
      agentId: 'yuanxiao',
      sessionId: parent.sessionId,
      content: '第一个问题',
    })
    await driver.sendMessage({
      agentId: 'yuanxiao',
      sessionId: parent.sessionId,
      content: '第二个问题',
    })
    const firstUserMessageId = await findUserMessageId(
      driver,
      parent.sessionId,
      '第一个问题',
    )
    const secondUserMessageId = await findUserMessageId(
      driver,
      parent.sessionId,
      '第二个问题',
    )

    // 首条用户消息分叉：新会话历史为空，来源仍指向该消息。
    const firstMessageFork = await driver.forkSession({
      agentId: 'yuanxiao',
      sessionId: parent.sessionId,
      entryId: firstUserMessageId,
    })
    expect(firstMessageFork.forkedFrom).toEqual({
      sessionId: parent.sessionId,
      entryId: firstUserMessageId,
    })
    await expect(
      driver.getTranscript({
        agentId: 'yuanxiao',
        sessionId: firstMessageFork.sessionId,
      }),
    ).resolves.toMatchObject({ entries: [] })

    // 同一条消息的两个分叉：各自独立，互不覆盖。
    const siblingOne = await driver.forkSession({
      agentId: 'yuanxiao',
      sessionId: parent.sessionId,
      entryId: secondUserMessageId,
    })
    const siblingTwo = await driver.forkSession({
      agentId: 'yuanxiao',
      sessionId: parent.sessionId,
      entryId: secondUserMessageId,
    })
    expect(siblingTwo.sessionId).not.toBe(siblingOne.sessionId)

    await driver.sendMessage({
      agentId: 'yuanxiao',
      sessionId: siblingOne.sessionId,
      content: '第一个方案',
    })
    await driver.sendMessage({
      agentId: 'yuanxiao',
      sessionId: siblingTwo.sessionId,
      content: '第二个方案',
    })
    await expect(
      driver.getTranscript({
        agentId: 'yuanxiao',
        sessionId: siblingOne.sessionId,
      }),
    ).resolves.toMatchObject({
      entries: [
        expect.objectContaining({ content: '第一个问题' }),
        expect.objectContaining({ content: '收到：第一个问题' }),
        expect.objectContaining({ content: '第一个方案' }),
        expect.objectContaining({ content: '收到：第一个方案' }),
      ],
    })
    await expect(
      driver.getTranscript({
        agentId: 'yuanxiao',
        sessionId: siblingTwo.sessionId,
      }),
    ).resolves.toMatchObject({
      entries: [
        expect.objectContaining({ content: '第一个问题' }),
        expect.objectContaining({ content: '收到：第一个问题' }),
        expect.objectContaining({ content: '第二个方案' }),
        expect.objectContaining({ content: '收到：第二个方案' }),
      ],
    })

    // 从分叉会话继续分叉，形成第三层谱系。
    const grandchildSourceId = await findUserMessageId(
      driver,
      siblingOne.sessionId,
      '第一个方案',
    )
    const grandchild = await driver.forkSession({
      agentId: 'yuanxiao',
      sessionId: siblingOne.sessionId,
      entryId: grandchildSourceId,
    })
    expect(grandchild.forkedFrom).toEqual({
      sessionId: siblingOne.sessionId,
      entryId: grandchildSourceId,
    })

    // 重启：会话谱系从本地索引恢复。
    const restartedDriver = createDriverAtPath({
      gateway,
      rootPath,
      userDataPath,
    })
    await expect(
      restartedDriver.listSessions({ agentId: 'yuanxiao' }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sessionId: parent.sessionId,
        }),
        expect.objectContaining({
          sessionId: firstMessageFork.sessionId,
          forkedFrom: {
            sessionId: parent.sessionId,
            entryId: firstUserMessageId,
          },
        }),
        expect.objectContaining({
          sessionId: siblingOne.sessionId,
          forkedFrom: {
            sessionId: parent.sessionId,
            entryId: secondUserMessageId,
          },
        }),
        expect.objectContaining({
          sessionId: siblingTwo.sessionId,
          forkedFrom: {
            sessionId: parent.sessionId,
            entryId: secondUserMessageId,
          },
        }),
        expect.objectContaining({
          sessionId: grandchild.sessionId,
          forkedFrom: {
            sessionId: siblingOne.sessionId,
            entryId: grandchildSourceId,
          },
        }),
      ]),
    )

    // 索引丢失：从全局 Pi session 扫描重建谱系与精确来源。
    await unlink(join(userDataPath, 'sessions/index.json'))
    const rebuiltDriver = createDriverAtPath({
      gateway,
      rootPath,
      userDataPath,
    })
    const rebuiltSessions = await rebuiltDriver.listSessions({
      agentId: 'yuanxiao',
    })

    expect(
      rebuiltSessions.find((session) => session.sessionId === parent.sessionId)
        ?.forkedFrom,
    ).toBeUndefined()
    expect(
      rebuiltSessions.map((session) => ({
        sessionId: session.sessionId,
        forkedFrom: session.forkedFrom,
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          sessionId: firstMessageFork.sessionId,
          forkedFrom: {
            sessionId: parent.sessionId,
            entryId: firstUserMessageId,
          },
        },
        {
          sessionId: siblingOne.sessionId,
          forkedFrom: {
            sessionId: parent.sessionId,
            entryId: secondUserMessageId,
          },
        },
        {
          sessionId: siblingTwo.sessionId,
          forkedFrom: {
            sessionId: parent.sessionId,
            entryId: secondUserMessageId,
          },
        },
        {
          sessionId: grandchild.sessionId,
          forkedFrom: {
            sessionId: siblingOne.sessionId,
            entryId: grandchildSourceId,
          },
        },
      ]),
    )
  })

  it('来源会话文件缺失时报告会话不可用，不产生半个分叉', async () => {
    const gateway = createRealFileGateway()
    const { driver, userDataPath } = await createDriver({ gateway })
    await driver.saveConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    const parent = await driver.createSession({
      agentId: 'yuanxiao',
      title: '父会话',
    })
    await driver.sendMessage({
      agentId: 'yuanxiao',
      sessionId: parent.sessionId,
      content: '会被删掉的会话',
    })
    const sourceId = await findUserMessageId(
      driver,
      parent.sessionId,
      '会被删掉的会话',
    )
    const before = (await driver.listSessions({ agentId: 'yuanxiao' })).length
    const index = (await readJson(
      join(userDataPath, 'sessions/index.json'),
    )) as {
      sessions: Array<{ sessionId: string; sdkSessionFile: string }>
    }
    const parentSessionFile = index.sessions.find(
      (entry) => entry.sessionId === parent.sessionId,
    )!.sdkSessionFile

    await rm(parentSessionFile)

    await expect(
      driver.forkSession({
        agentId: 'yuanxiao',
        sessionId: parent.sessionId,
        entryId: sourceId,
      }),
    ).rejects.toThrow()
    await expect(
      driver.listSessions({ agentId: 'yuanxiao' }),
    ).resolves.toHaveLength(before)
  })
})

describe('PiSdkDriver 会话运行配置', () => {
  it('分叉继承父会话有效配置，之后两边各自独立', async () => {
    const gateway = createRealFileGateway()
    const { driver } = await createDriver({ gateway })
    await driver.saveConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    const parent = await driver.createSession({
      agentId: 'yuanxiao',
      title: '父会话',
    })
    await driver.sendMessage({
      agentId: 'yuanxiao',
      sessionId: parent.sessionId,
      content: '第一个问题',
    })

    // 父会话先换模型和 Thinking Level，分叉应继承这些「有效」取值而非创建时值。
    await driver.setSessionModel({
      agentId: 'yuanxiao',
      sessionId: parent.sessionId,
      providerId: 'anthropic',
      modelId: 'claude-opus-4-6',
    })
    await driver.setSessionThinkingLevel({
      agentId: 'yuanxiao',
      sessionId: parent.sessionId,
      level: 'high',
    })

    const sourceId = await findUserMessageId(
      driver,
      parent.sessionId,
      '第一个问题',
    )
    const fork = await driver.forkSession({
      agentId: 'yuanxiao',
      sessionId: parent.sessionId,
      entryId: sourceId,
    })

    await expect(
      driver.getSessionModelInfo({
        agentId: 'yuanxiao',
        sessionId: fork.sessionId,
      }),
    ).resolves.toMatchObject({
      providerId: 'anthropic',
      modelId: 'claude-opus-4-6',
      thinkingLevel: 'high',
    })

    // 分叉侧换配置不影响父会话。
    await driver.setSessionThinkingLevel({
      agentId: 'yuanxiao',
      sessionId: fork.sessionId,
      level: 'low',
    })

    await expect(
      driver.getSessionModelInfo({
        agentId: 'yuanxiao',
        sessionId: parent.sessionId,
      }),
    ).resolves.toMatchObject({ thinkingLevel: 'high' })
    await expect(
      driver.getSessionModelInfo({
        agentId: 'yuanxiao',
        sessionId: fork.sessionId,
      }),
    ).resolves.toMatchObject({ thinkingLevel: 'low' })
  })

  it('重启后打开历史会话恢复会话运行配置，而不是 Agent 默认配置', async () => {
    const gateway = createRealFileGateway()
    const { driver, rootPath, userDataPath } = await createDriver({ gateway })
    await driver.saveConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    const session = await driver.createSession({
      agentId: 'yuanxiao',
      title: '换过模型的会话',
    })
    await driver.sendMessage({
      agentId: 'yuanxiao',
      sessionId: session.sessionId,
      content: '第一个问题',
    })
    await driver.setSessionModel({
      agentId: 'yuanxiao',
      sessionId: session.sessionId,
      providerId: 'anthropic',
      modelId: 'claude-opus-4-6',
    })
    await driver.setSessionThinkingLevel({
      agentId: 'yuanxiao',
      sessionId: session.sessionId,
      level: 'medium',
    })

    const restartedDriver = createDriverAtPath({
      gateway,
      rootPath,
      userDataPath,
    })
    await restartedDriver.listSessions({ agentId: 'yuanxiao' })

    await expect(
      restartedDriver.getSessionModelInfo({
        agentId: 'yuanxiao',
        sessionId: session.sessionId,
      }),
    ).resolves.toMatchObject({
      providerId: 'anthropic',
      modelId: 'claude-opus-4-6',
      thinkingLevel: 'medium',
    })
  })

  it('索引丢失后从全局 Pi session 扫描恢复会话运行配置', async () => {
    const gateway = createRealFileGateway()
    const { driver, rootPath, userDataPath } = await createDriver({ gateway })
    await driver.saveConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })
    const session = await driver.createSession({
      agentId: 'yuanxiao',
      title: '换过模型的会话',
    })
    await driver.sendMessage({
      agentId: 'yuanxiao',
      sessionId: session.sessionId,
      content: '第一个问题',
    })
    await driver.setSessionModel({
      agentId: 'yuanxiao',
      sessionId: session.sessionId,
      providerId: 'anthropic',
      modelId: 'claude-opus-4-6',
    })
    await driver.setSessionThinkingLevel({
      agentId: 'yuanxiao',
      sessionId: session.sessionId,
      level: 'medium',
    })

    await unlink(join(userDataPath, 'sessions/index.json'))
    const rebuiltDriver = createDriverAtPath({
      gateway,
      rootPath,
      userDataPath,
    })
    await rebuiltDriver.listSessions({ agentId: 'yuanxiao' })

    await expect(
      rebuiltDriver.getSessionModelInfo({
        agentId: 'yuanxiao',
        sessionId: session.sessionId,
      }),
    ).resolves.toMatchObject({
      providerId: 'anthropic',
      modelId: 'claude-opus-4-6',
      thinkingLevel: 'medium',
    })
  })
})
