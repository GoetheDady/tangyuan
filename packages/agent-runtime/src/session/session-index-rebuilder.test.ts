import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ConfigEncryptionAdapter,
  InternalRuntimeConfig,
} from '@yuanxiao/contracts'
import { ConfigStore, DirectoryLayout } from '../core'
import type { PiSdkGateway } from '../index'
import {
  normalizePersistedIndexEntry,
  SessionIndexRebuilder,
} from './session-index-rebuilder'

const fakeAdapter: ConfigEncryptionAdapter = {
  encrypt: async (p) => `enc:${Buffer.from(p, 'utf8').toString('base64')}`,
  decrypt: async (c) =>
    Buffer.from(c.replace(/^enc:/, ''), 'base64').toString('utf8'),
  isAvailable: () => true,
}

function createConfig(): InternalRuntimeConfig {
  return {
    schemaVersion: 2,
    providers: {
      openai: { apiKey: 'sk-x', updatedAt: 'now' },
      anthropic: { apiKey: 'sk-y', updatedAt: 'now' },
    },
    agents: {
      yuanxiao: {
        displayName: '元宵',
        defaultProviderId: 'openai',
        defaultModelId: 'gpt-5',
        status: 'active',
        archivedAt: null,
      },
    },
  }
}

let dir: string
let layout: DirectoryLayout
let configStore: ConfigStore

function createRebuilder(gateway: PiSdkGateway): SessionIndexRebuilder {
  return new SessionIndexRebuilder({ layout, configStore, gateway })
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'session-index-rebuilder-'))
  layout = new DirectoryLayout({
    agentHomePath: join(dir, 'agents', 'yuanxiao'),
    fsRoot: dir,
    userDataPath: dir,
  })
  configStore = new ConfigStore({
    layout,
    encryptionAdapter: fakeAdapter,
    now: () => 'now',
  })
  await configStore.write(createConfig())
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function fakeGateway(
  sessions: Array<{
    sessionId: string
    sdkSessionFile: string
    title?: string
    cwd?: string
    createdAt: string
    updatedAt: string
    forkedFrom?: { sessionId: string; entryId: string; sdkEntryId?: string }
    provider?: string
    model?: string
    thinkingLevel?: string
  }>,
): PiSdkGateway {
  return {
    listSessions: async () =>
      sessions.map((session) => ({
        ...session,
        cwd: session.cwd ?? layout.agentHome(),
      })),
  } as unknown as PiSdkGateway
}

describe('SessionIndexRebuilder.rebuild', () => {
  it('无配置时返回空数组', async () => {
    await configStore.reset()
    const rebuilder = createRebuilder(fakeGateway([]))

    await expect(rebuilder.rebuild()).resolves.toEqual([])
  })

  it('全局扫描失败时传播错误，避免调用方把失败提交为空索引', async () => {
    const gateway = {
      listSessions: vi.fn().mockRejectedValue(new Error('扫描失败')),
    } as unknown as PiSdkGateway
    const rebuilder = createRebuilder(gateway)

    await expect(rebuilder.rebuild()).rejects.toThrow('扫描失败')
  })

  it('按工作目录归属 Agent，会话配置优先于 Agent 默认值', async () => {
    const rebuilder = createRebuilder(
      fakeGateway([
        {
          sessionId: 's1',
          sdkSessionFile: '/tmp/s1.jsonl',
          title: '会话一',
          createdAt: 'now',
          updatedAt: 'now',
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          thinkingLevel: 'medium',
        },
      ]),
    )

    const entries = await rebuilder.rebuild()
    expect(entries).toEqual([
      expect.objectContaining({
        sessionId: 's1',
        agentId: 'yuanxiao',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        thinkingLevel: 'medium',
      }),
    ])
  })

  it('重建保留旧索引的归档、来源与展示状态，执行记录随索引重建丢失', async () => {
    await mkdir(join(dir, 'sessions'), { recursive: true })
    await writeFile(
      layout.sessionIndex(),
      JSON.stringify({
        sessions: [
          {
            sessionId: 's1',
            sdkSessionFile: '/tmp/s1.jsonl',
            title: '旧标题',
            createdAt: 'old',
            updatedAt: 'old',
            provider: '',
            model: '',
            agentId: 'yuanxiao',
            lastMessagePreview: '旧预览',
            status: 'failed',
            archivedAt: '2026-07-01T00:00:00.000Z',
            forkedFrom: { sessionId: 'p1', entryId: 'e1', sdkEntryId: 'e1' },
            attempts: [
              {
                attemptId: 'a1',
                runId: 'r1',
                messageId: 'm1',
                status: 'failed',
                startedAt: 'now',
                completedAt: 'later',
              },
            ],
          },
        ],
      }),
      'utf8',
    )
    const rebuilder = createRebuilder(
      fakeGateway([
        {
          sessionId: 's1',
          sdkSessionFile: '/tmp/s1.jsonl',
          title: '新标题',
          createdAt: 'new',
          updatedAt: 'new',
        },
      ]),
    )

    const entries = await rebuilder.rebuild()
    expect(entries).toEqual([
      expect.objectContaining({
        sessionId: 's1',
        title: '新标题',
        status: 'failed',
        lastMessagePreview: '旧预览',
        archivedAt: '2026-07-01T00:00:00.000Z',
        forkedFrom: { sessionId: 'p1', entryId: 'e1', sdkEntryId: 'e1' },
      }),
    ])
    // 执行记录不可从 Pi session 重建，索引重建后随旧索引一起丢失
    expect(entries[0]?.attempts).toBeUndefined()
  })

  it('旧索引单 id 来源在重建时用 Pi session 投影补齐 sdkEntryId', async () => {
    await mkdir(join(dir, 'sessions'), { recursive: true })
    await writeFile(
      layout.sessionIndex(),
      JSON.stringify({
        sessions: [
          {
            sessionId: 's1',
            sdkSessionFile: '/tmp/s1.jsonl',
            title: '旧标题',
            createdAt: 'old',
            updatedAt: 'old',
            provider: '',
            model: '',
            agentId: 'yuanxiao',
            lastMessagePreview: '',
            status: 'idle',
            forkedFrom: { sessionId: 'p1', entryId: 'msg-1' },
          },
        ],
      }),
      'utf8',
    )
    const rebuilder = createRebuilder(
      fakeGateway([
        {
          sessionId: 's1',
          sdkSessionFile: '/tmp/s1.jsonl',
          title: '新标题',
          createdAt: 'new',
          updatedAt: 'new',
          forkedFrom: {
            sessionId: 'p1',
            entryId: 'msg-1',
            sdkEntryId: 'sdk-e1',
          },
        },
      ]),
    )

    const entries = await rebuilder.rebuild()
    expect(entries).toEqual([
      expect.objectContaining({
        forkedFrom: { sessionId: 'p1', entryId: 'msg-1', sdkEntryId: 'sdk-e1' },
      }),
    ])
  })

  it('无法归属到已知 Agent 的会话不进入索引', async () => {
    const rebuilder = createRebuilder(
      fakeGateway([
        {
          sessionId: 'foreign',
          sdkSessionFile: '/tmp/foreign.jsonl',
          cwd: '/elsewhere',
          createdAt: 'now',
          updatedAt: 'now',
        },
      ]),
    )

    const entries = await rebuilder.rebuild()
    expect(entries).toEqual([])
  })
})

describe('normalizePersistedIndexEntry', () => {
  it('合法条目原样规范化并保留可选扩展字段', () => {
    const [entry] = normalizePersistedIndexEntry({
      sessionId: 's1',
      sdkSessionFile: '/tmp/s1.jsonl',
      title: '会话一',
      createdAt: 'now',
      updatedAt: 'now',
      provider: 'openai',
      model: 'gpt-5',
      agentId: 'yuanxiao',
      lastMessagePreview: '',
      status: 'running',
      archivedAt: '2026-07-01T00:00:00.000Z',
      forkedFrom: { sessionId: 'p1', entryId: 'e1' },
      attempts: [
        {
          attemptId: 'a1',
          runId: 'r1',
          messageId: 'm1',
          status: 'completed',
          startedAt: 'now',
          completedAt: 'now',
        },
      ],
    })

    expect(entry?.sessionId).toBe('s1')
    expect(entry?.archivedAt).toBe('2026-07-01T00:00:00.000Z')
    expect(entry?.forkedFrom).toEqual({ sessionId: 'p1', entryId: 'e1' })
    expect(entry?.attempts).toHaveLength(1)
  })

  it('缺关键字段或状态非法时返回空数组', () => {
    expect(
      normalizePersistedIndexEntry({
        sessionId: 's1',
        sdkSessionFile: '/tmp/s1.jsonl',
      }),
    ).toEqual([])
    expect(
      normalizePersistedIndexEntry({
        sessionId: 's1',
        sdkSessionFile: '/tmp/s1.jsonl',
        title: 't',
        createdAt: 'now',
        updatedAt: 'now',
        provider: 'openai',
        model: 'gpt-5',
        agentId: 'yuanxiao',
        lastMessagePreview: '',
        status: 'weird',
      }),
    ).toEqual([])
  })
})
