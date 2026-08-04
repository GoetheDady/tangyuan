import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type {
  ConfigEncryptionAdapter,
  InternalRuntimeConfig,
} from '@yuanxiao/contracts'
import { ConfigStore, DirectoryLayout } from '../core'
import {
  SessionIndexStore,
  type PersistedSessionIndexEntry,
} from './session-index-store'
import type { PiSdkGateway } from '../index'
import { AgentRuntimeError } from '../core'

const fakeAdapter: ConfigEncryptionAdapter = {
  encrypt: async (p) => `enc:${Buffer.from(p, 'utf8').toString('base64')}`,
  decrypt: async (c) =>
    Buffer.from(c.replace(/^enc:/, ''), 'base64').toString('utf8'),
  isAvailable: () => true,
}

/** 只实现 SessionIndexStore 会用到的 listSessions，其余方法抛错。 */
function createFakeGateway(
  sessions: Array<{
    sessionId: string
    sdkSessionFile: string
    title?: string
    cwd?: string
    createdAt: string
    updatedAt: string
    forkedFrom?: { sessionId: string; entryId: string }
    provider?: string
    model?: string
    thinkingLevel?: string
  }> = [],
): PiSdkGateway {
  return {
    // 全局扫描返回的会话默认归属默认元宵的 Agent Home。
    listSessions: async () =>
      sessions.map((session) => ({
        ...session,
        cwd: session.cwd ?? layout.agentHome(),
      })),
  } as unknown as PiSdkGateway
}

function makeEntry(
  overrides: Partial<PersistedSessionIndexEntry> = {},
): PersistedSessionIndexEntry {
  return {
    sessionId: 's1',
    sdkSessionFile: '/tmp/s1.jsonl',
    title: '会话一',
    createdAt: 'now',
    updatedAt: '2026-01-01',
    provider: 'openai',
    model: 'gpt-4',
    agentId: 'yuanxiao',
    lastMessagePreview: '',
    status: 'idle',
    ...overrides,
  }
}

let dir: string
let layout: DirectoryLayout
let configStore: ConfigStore

async function makeStore(
  gateway = createFakeGateway(),
): Promise<SessionIndexStore> {
  return new SessionIndexStore({ layout, configStore, gateway })
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'session-index-'))
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
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('SessionIndexStore.addSession / 摘要派生', () => {
  it('新增会话后可查摘要、条目与列表', async () => {
    const store = await makeStore()
    const summary = store.addSession(makeEntry())

    expect(summary).toEqual({
      agentId: 'yuanxiao',
      sessionId: 's1',
      title: '会话一',
      state: 'idle',
      updatedAt: '2026-01-01',
    })
    expect(store.hasSummary('s1')).toBe(true)
    expect(store.getEntry('s1').model).toBe('gpt-4')
    expect(store.listSummaries('yuanxiao')).toHaveLength(1)
    expect(store.listSummaries('other')).toHaveLength(0)
  })

  it('getEntry 不存在时抛错', async () => {
    const store = await makeStore()
    expect(() => store.getEntry('missing')).toThrow(AgentRuntimeError)
    expect(store.getEntryOrNull('missing')).toBeUndefined()
  })
})

describe('SessionIndexStore.updateEntry / write / load 往返', () => {
  it('updateEntry 写盘后可被新 store load 读回', async () => {
    const store = await makeStore()
    store.addSession(makeEntry())
    await store.updateEntry('s1', { title: '改名了', status: 'completed' })

    // 磁盘上应有 index.json
    const raw = JSON.parse(await readFile(layout.sessionIndex(), 'utf8'))
    expect(raw.sessions[0].title).toBe('改名了')

    // 新 store load 读回
    const store2 = await makeStore()
    const entries = await store2.load()
    expect(entries).toHaveLength(1)
    expect(store2.getSummary('s1')?.state).toBe('completed')
  })
})

describe('SessionIndexStore 会话归档', () => {
  it('整批归档后从日常列表隐藏，重载后仍可显式读取', async () => {
    const store = await makeStore()
    store.addSession(makeEntry({ sessionId: 'parent', title: '父会话' }))
    store.addSession(
      makeEntry({
        sessionId: 'child',
        title: '子会话',
        forkedFrom: { sessionId: 'parent', entryId: 'source-message' },
      }),
    )
    store.addSession(makeEntry({ sessionId: 'sibling', title: '兄弟会话' }))

    await store.setArchived(['parent', 'child'], '2026-07-29T03:00:00.000Z')

    expect(store.listSummaries('yuanxiao')).toEqual([
      expect.objectContaining({ sessionId: 'sibling' }),
    ])
    expect(store.listSummaries('yuanxiao', true)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sessionId: 'parent',
          archivedAt: '2026-07-29T03:00:00.000Z',
        }),
        expect.objectContaining({
          sessionId: 'child',
          archivedAt: '2026-07-29T03:00:00.000Z',
        }),
        expect.objectContaining({ sessionId: 'sibling' }),
      ]),
    )

    const reloadedStore = await makeStore()
    await reloadedStore.load()
    expect(reloadedStore.listSummaries('yuanxiao')).toHaveLength(1)
    expect(reloadedStore.getSummary('child')).toMatchObject({
      archivedAt: '2026-07-29T03:00:00.000Z',
    })
  })
})

describe('SessionIndexStore.upsertAttempt', () => {
  it('新增与更新 attempt，超过 20 条时截断', async () => {
    const store = await makeStore()
    store.addSession(makeEntry())

    for (let i = 0; i < 25; i++) {
      await store.upsertAttempt(
        's1',
        {
          attemptId: `a${i}`,
          runId: `r${i}`,
          messageId: `m${i}`,
          status: 'completed',
          startedAt: 'now',
          completedAt: 'now',
        },
        { status: 'completed', updatedAt: 'now' },
      )
    }

    const attempts = store.getAttempts('s1')
    expect(attempts).toHaveLength(20)
    expect(attempts[0]?.attemptId).toBe('a5')
    expect(attempts[19]?.attemptId).toBe('a24')
  })

  it('写盘后重读仍可取得 attempts', async () => {
    const store = await makeStore()
    store.addSession(makeEntry())

    await store.upsertAttempt(
      's1',
      {
        attemptId: 'a1',
        runId: 'r1',
        messageId: 'm1',
        status: 'failed',
        startedAt: 'now',
        completedAt: 'later',
      },
      {
        status: 'failed',
        lastMessagePreview: '失败',
        updatedAt: 'later',
      },
    )

    // 新 store 加载同一份磁盘索引
    const store2 = await makeStore()
    await store2.load()
    const attempts = store2.getAttempts('s1')
    expect(attempts).toHaveLength(1)
    expect(attempts[0]?.attemptId).toBe('a1')
    expect(attempts[0]?.status).toBe('failed')
    expect(store2.getSummary('s1')).toMatchObject({
      state: 'failed',
    })
    expect(store2.getEntryOrNull('s1')?.lastMessagePreview).toBe('失败')
  })
})

describe('SessionIndexStore 会话运行配置', () => {
  it('Thinking Level 写盘后可被新 store 读回', async () => {
    const store = await makeStore()
    store.addSession(makeEntry())
    await store.updateEntry('s1', { thinkingLevel: 'high' })

    const store2 = await makeStore()
    await store2.load()

    expect(store2.getEntry('s1').thinkingLevel).toBe('high')
  })
})

describe('SessionIndexStore.load 重建', () => {
  it('索引缺失时从 SDK 会话重建', async () => {
    const config: InternalRuntimeConfig = {
      schemaVersion: 2,
      providers: { openai: { apiKey: 'sk-x', updatedAt: 'now' } },
      agents: {
        yuanxiao: {
          displayName: '元宵',
          defaultProviderId: 'openai',
          defaultModelId: 'gpt-4',
          status: 'active',
          archivedAt: null,
        },
      },
    }
    await configStore.write(config)

    const gateway = createFakeGateway([
      {
        sessionId: 'sdk-1',
        sdkSessionFile: '/tmp/sdk-1.jsonl',
        title: 'SDK 会话',
        createdAt: 'now',
        updatedAt: 'now',
      },
    ])
    const store = await makeStore(gateway)
    const entries = await store.load()

    expect(entries).toHaveLength(1)
    expect(entries[0]?.sessionId).toBe('sdk-1')
    expect(store.getSummary('sdk-1')?.title).toBe('SDK 会话')
  })

  it('索引缺失时从 Pi session 元数据恢复分叉来源', async () => {
    await configStore.write({
      schemaVersion: 2,
      providers: { openai: { apiKey: 'sk-x', updatedAt: 'now' } },
      agents: {
        yuanxiao: {
          displayName: '元宵',
          defaultProviderId: 'openai',
          defaultModelId: 'gpt-4',
          status: 'active',
          archivedAt: null,
        },
      },
    })
    const store = await makeStore(
      createFakeGateway([
        {
          sessionId: 'parent',
          sdkSessionFile: '/tmp/parent.jsonl',
          title: '父会话',
          createdAt: 'now',
          updatedAt: 'now',
        },
        {
          sessionId: 'child',
          sdkSessionFile: '/tmp/child.jsonl',
          title: '子会话',
          createdAt: 'now',
          updatedAt: 'now',
          forkedFrom: { sessionId: 'parent', entryId: 'source-user' },
        },
      ]),
    )

    await store.load()

    expect(store.getSummary('child')).toMatchObject({
      forkedFrom: { sessionId: 'parent', entryId: 'source-user' },
    })
  })

  it('损坏的索引 JSON 触发重建', async () => {
    await mkdir(join(dir, 'sessions'), { recursive: true })
    await writeFile(layout.sessionIndex(), '{ 坏 json', 'utf8')
    await configStore.write({
      schemaVersion: 2,
      providers: {},
      agents: {
        yuanxiao: {
          displayName: '元宵',
          defaultProviderId: null,
          defaultModelId: null,
          status: 'active',
          archivedAt: null,
        },
      },
    })

    const store = await makeStore(createFakeGateway([]))
    const entries = await store.load()
    expect(entries).toEqual([])
  })

  it('重建优先恢复 Pi session 里的会话运行配置，不回退到 Agent 默认值', async () => {
    await configStore.write({
      schemaVersion: 2,
      providers: {
        openai: { apiKey: 'sk-x', updatedAt: 'now' },
        anthropic: { apiKey: 'sk-y', updatedAt: 'now' },
      },
      agents: {
        yuanxiao: {
          displayName: '元宵',
          defaultProviderId: 'openai',
          defaultModelId: 'gpt-4',
          status: 'active',
          archivedAt: null,
        },
      },
    })
    // Pi session 自己记住了该会话已切到另一个模型和 Thinking Level。
    const store = await makeStore(
      createFakeGateway([
        {
          sessionId: 's1',
          sdkSessionFile: '/tmp/s1.jsonl',
          title: '已改过模型的会话',
          createdAt: 'now',
          updatedAt: 'now',
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          thinkingLevel: 'high',
        },
      ]),
    )

    await store.load()

    expect(store.getEntry('s1')).toMatchObject({
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      thinkingLevel: 'high',
    })
  })

  it('全局扫描失败时不提交空索引，下次 load 仍会重试', async () => {
    await configStore.write({
      schemaVersion: 2,
      providers: { openai: { apiKey: 'sk-x', updatedAt: 'now' } },
      agents: {
        yuanxiao: {
          displayName: '元宵',
          defaultProviderId: 'openai',
          defaultModelId: 'gpt-4',
          status: 'active',
          archivedAt: null,
        },
      },
    })
    let scanCount = 0
    const recoveringGateway = {
      listSessions: async () => {
        scanCount++
        if (scanCount === 1) {
          throw new Error('session 目录不可读')
        }
        return [
          {
            sessionId: 'recovered-session',
            sdkSessionFile: '/tmp/recovered-session.jsonl',
            title: '恢复的会话',
            cwd: layout.agentHome(),
            createdAt: 'now',
            updatedAt: 'now',
          },
        ]
      },
    } as unknown as PiSdkGateway
    const store = await makeStore(recoveringGateway)

    await expect(store.load()).rejects.toThrow('session 目录不可读')
    expect(store.listSummaries('yuanxiao')).toEqual([])
    await expect(readFile(layout.sessionIndex(), 'utf8')).rejects.toMatchObject(
      {
        code: 'ENOENT',
      },
    )

    await expect(store.load()).resolves.toEqual([
      expect.objectContaining({ sessionId: 'recovered-session' }),
    ])
    expect(scanCount).toBe(2)
  })

  it('按 session header 工作目录归属 Agent，无法归属的会话不入索引', async () => {
    await configStore.write({
      schemaVersion: 2,
      providers: { openai: { apiKey: 'sk-x', updatedAt: 'now' } },
      agents: {
        yuanxiao: {
          displayName: '元宵',
          defaultProviderId: 'openai',
          defaultModelId: 'gpt-4',
          status: 'active',
          archivedAt: null,
        },
        helper: {
          displayName: '助手',
          defaultProviderId: 'openai',
          defaultModelId: 'gpt-4',
          status: 'active',
          archivedAt: null,
        },
      },
    })
    const store = await makeStore(
      createFakeGateway([
        {
          sessionId: 'yuanxiao-session',
          sdkSessionFile: '/tmp/a.jsonl',
          title: '元宵会话',
          cwd: layout.agentHome(),
          createdAt: 'now',
          updatedAt: 'now',
        },
        {
          sessionId: 'helper-session',
          sdkSessionFile: '/tmp/b.jsonl',
          title: '助手会话',
          cwd: layout.workspace('helper'),
          createdAt: 'now',
          updatedAt: 'now',
        },
        {
          sessionId: 'foreign-session',
          sdkSessionFile: '/tmp/c.jsonl',
          title: '其他工具写入的会话',
          cwd: join(dir, 'somewhere-else'),
          createdAt: 'now',
          updatedAt: 'now',
        },
      ]),
    )

    await store.load()

    expect(
      store.listSummaries('yuanxiao').map((item) => item.sessionId),
    ).toEqual(['yuanxiao-session'])
    expect(store.listSummaries('helper').map((item) => item.sessionId)).toEqual(
      ['helper-session'],
    )
    expect(store.getEntryOrNull('foreign-session')).toBeUndefined()
  })

  it('已归档 Agent 的会话在重建后保留，且不混入活跃 Agent 列表', async () => {
    await configStore.write({
      schemaVersion: 2,
      providers: { openai: { apiKey: 'sk-x', updatedAt: 'now' } },
      agents: {
        yuanxiao: {
          displayName: '元宵',
          defaultProviderId: 'openai',
          defaultModelId: 'gpt-4',
          status: 'active',
          archivedAt: null,
        },
        retired: {
          displayName: '已归档助手',
          defaultProviderId: 'openai',
          defaultModelId: 'gpt-4',
          status: 'archived',
          archivedAt: 'now',
        },
      },
    })
    const store = await makeStore(
      createFakeGateway([
        {
          sessionId: 'retired-root',
          sdkSessionFile: '/tmp/retired-root.jsonl',
          title: '归档会话',
          cwd: layout.workspace('retired'),
          createdAt: 'now',
          updatedAt: 'now',
        },
        {
          sessionId: 'retired-fork',
          sdkSessionFile: '/tmp/retired-fork.jsonl',
          title: '归档分叉',
          cwd: layout.workspace('retired'),
          createdAt: 'now',
          updatedAt: 'now',
          forkedFrom: { sessionId: 'retired-root', entryId: 'source-user' },
        },
      ]),
    )

    await store.load()

    expect(store.listSummaries('yuanxiao')).toEqual([])
    expect(
      store.listSummaries('retired').map((item) => item.sessionId),
    ).toEqual(expect.arrayContaining(['retired-root', 'retired-fork']))
    expect(store.getSummary('retired-fork')).toMatchObject({
      forkedFrom: { sessionId: 'retired-root', entryId: 'source-user' },
    })
  })
})

describe('SessionIndexStore.setSummaryState', () => {
  it('改状态返回新摘要，不存在时抛错', async () => {
    const store = await makeStore()
    store.addSession(makeEntry())

    const next = store.setSummaryState('s1', 'running', '2026-02-02')
    expect(next.state).toBe('running')
    expect(next.updatedAt).toBe('2026-02-02')
    expect(store.getSummary('s1')?.state).toBe('running')

    expect(() => store.setSummaryState('missing', 'idle', 'now')).toThrow(
      AgentRuntimeError,
    )
  })
})
