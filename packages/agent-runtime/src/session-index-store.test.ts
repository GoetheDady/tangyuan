import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type {
  ConfigEncryptionAdapter,
  InternalRuntimeConfig,
} from '@tangyuan/contracts'
import { DirectoryLayout } from './directory-layout'
import { ConfigStore } from './config-store'
import {
  SessionIndexStore,
  type PersistedSessionIndexEntry,
} from './session-index-store'
import type { PiSdkGateway } from './index'
import { AgentRuntimeError } from './errors'

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
    createdAt: string
    updatedAt: string
  }> = [],
): PiSdkGateway {
  return {
    listSessions: async () => sessions,
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
    agentId: 'tangyuan',
    lastMessagePreview: '',
    status: 'idle',
    ...overrides,
  }
}

let dir: string
let layout: DirectoryLayout
let configStore: ConfigStore

async function makeStore(gateway = createFakeGateway()): Promise<SessionIndexStore> {
  return new SessionIndexStore({ layout, configStore, gateway })
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'session-index-'))
  layout = new DirectoryLayout({
    agentHomePath: join(dir, 'agents', 'tangyuan'),
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
      agentId: 'tangyuan',
      sessionId: 's1',
      title: '会话一',
      state: 'idle',
      updatedAt: '2026-01-01',
    })
    expect(store.hasSummary('s1')).toBe(true)
    expect(store.getEntry('s1').model).toBe('gpt-4')
    expect(store.listSummaries('tangyuan')).toHaveLength(1)
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

describe('SessionIndexStore.upsertAttempt', () => {
  it('新增与更新 attempt，超过 20 条时截断', async () => {
    const store = await makeStore()
    store.addSession(makeEntry())

    for (let i = 0; i < 25; i++) {
      await store.upsertAttempt('s1', {
        attemptId: `a${i}`,
        runId: `r${i}`,
        messageId: `m${i}`,
        status: 'completed',
        startedAt: 'now',
        completedAt: 'now',
      })
    }

    const attempts = store.getAttempts('s1')
    expect(attempts).toHaveLength(20)
    expect(attempts[0]?.attemptId).toBe('a5')
    expect(attempts[19]?.attemptId).toBe('a24')
  })

  it('写盘后重读仍可取得 attempts', async () => {
    const store = await makeStore()
    store.addSession(makeEntry())

    await store.upsertAttempt('s1', {
      attemptId: 'a1',
      runId: 'r1',
      messageId: 'm1',
      status: 'failed',
      startedAt: 'now',
      completedAt: 'later',
    })

    // 新 store 加载同一份磁盘索引
    const store2 = await makeStore()
    await store2.load()
    const attempts = store2.getAttempts('s1')
    expect(attempts).toHaveLength(1)
    expect(attempts[0]?.attemptId).toBe('a1')
    expect(attempts[0]?.status).toBe('failed')
  })
})

describe('SessionIndexStore.load 重建', () => {
  it('索引缺失时从 SDK 会话重建', async () => {
    const config: InternalRuntimeConfig = {
      schemaVersion: 2,
      providers: { openai: { apiKey: 'sk-x', updatedAt: 'now' } },
      agents: {
        tangyuan: {
          displayName: '汤圆',
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

  it('损坏的索引 JSON 触发重建', async () => {
    await mkdir(join(dir, 'sessions'), { recursive: true })
    await writeFile(layout.sessionIndex(), '{ 坏 json', 'utf8')
    await configStore.write({
      schemaVersion: 2,
      providers: {},
      agents: {
        tangyuan: {
          displayName: '汤圆',
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
