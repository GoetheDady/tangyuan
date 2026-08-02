import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  ConfigEncryptionAdapter,
  TranscriptEntry,
  TranscriptSnapshot,
} from '@yuanxiao/contracts'
import {
  type InternalMessage,
  PiSdkDriver,
  type PiSdkCreateSessionRequest,
  type PiSdkDriverOptions,
  type PiSdkGateway,
  type PiSdkListSessionsRequest,
  type PiSdkOpenSessionRequest,
  type PiSdkReadMessagesRequest,
  type PiSdkSessionHandle,
  type PiSdkVerificationRequest,
} from './index'

export { createDeferred } from '../test-utils'

const tempDirs: string[] = []

export async function cleanupTempDirs(): Promise<void> {
  for (const directory of tempDirs.splice(0)) {
    await import('node:fs/promises').then(({ rm }) =>
      rm(directory, { recursive: true, force: true }),
    )
  }
}

export function snapshotFromMessages(
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

export async function createDriver(
  options: {
    gateway?: PiSdkGateway
    encryptionAdapter?: ConfigEncryptionAdapter | null
  } = {},
) {
  const rootPath = await mkdtemp(join(tmpdir(), 'yuanxiao-agent-runtime-'))
  const userDataPath = join(rootPath, 'Library/Application Support/Yuanxiao')
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
    homePath: '~/.yuanxiao/agents/yuanxiao',
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
export async function writeInitializedProfile(
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
    const profileDir = join(rootPath, '.yuanxiao/profile')
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
export function createDriverAtPath(options: {
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
    agentHomePath: '~/.yuanxiao/agents/yuanxiao',
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
export function createFakeEncryptionAdapter(): ConfigEncryptionAdapter {
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
export function createPiSdkGateway(
  options: Partial<PiSdkGateway> = {},
): PiSdkGateway & {
  requests: PiSdkVerificationRequest[]
  sessionRequests: PiSdkCreateSessionRequest[]
  openSessionRequests: PiSdkOpenSessionRequest[]
  listSessionRequests: PiSdkListSessionsRequest[]
  readMessageRequests: PiSdkReadMessagesRequest[]
  sessionHandles: Array<
    PiSdkSessionHandle & { prompts: string[]; systemPromptContexts: string[] }
  >
} {
  const requests: PiSdkVerificationRequest[] = []
  const sessionRequests: PiSdkCreateSessionRequest[] = []
  const openSessionRequests: PiSdkOpenSessionRequest[] = []
  const listSessionRequests: PiSdkListSessionsRequest[] = []
  const readMessageRequests: PiSdkReadMessagesRequest[] = []
  const sessionHandles: Array<
    PiSdkSessionHandle & { prompts: string[]; systemPromptContexts: string[] }
  > = []
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
        messagesBySession.get(request.sessionId)?.[0]?.agentId ?? 'yuanxiao',
        messagesBySession.get(request.sessionId) ?? [],
      )
    },
    createBranchedSession: async (request) => {
      if (options.createBranchedSession) {
        return options.createBranchedSession(request)
      }

      throw new Error('测试网关未配置 createBranchedSession。')
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
export function createPromptingHandle(
  sessionId: string,
  onMessages?: (messages: InternalMessage[]) => void,
): PiSdkSessionHandle & {
  prompts: string[]
  systemPromptContexts: string[]
} {
  const prompts: string[] = []
  const systemPromptContexts: string[] = []

  return {
    prompts,
    systemPromptContexts,
    setSystemPromptContext: (context: string) => {
      systemPromptContexts.push(context)
    },
    prompt: async (prompt: string) => {
      prompts.push(prompt)
      const userContent = prompt.trim()
      const messages: InternalMessage[] = [
        {
          messageId: `${sessionId}-sdk-user-1`,
          agentId: 'yuanxiao',
          sessionId,
          role: 'user',
          content: userContent,
          createdAt: '2026-07-08T00:00:00.000Z',
        },
        {
          messageId: `${sessionId}-sdk-agent-1`,
          agentId: 'yuanxiao',
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
export async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown
}
