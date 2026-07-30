import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DirectoryLayout } from './core'
import { LastActiveSessionStore } from './last-active-session-store'

let rootPath: string
let layout: DirectoryLayout
let store: LastActiveSessionStore

beforeEach(async () => {
  rootPath = await mkdtemp(join(tmpdir(), 'tangyuan-last-active-'))
  layout = new DirectoryLayout({
    agentHomePath: join(rootPath, 'agents', 'tangyuan'),
    fsRoot: rootPath,
    userDataPath: rootPath,
  })
  store = new LastActiveSessionStore({
    layout,
    now: () => '2026-07-08T00:00:00.000Z',
  })
})

afterEach(async () => {
  await rm(rootPath, { recursive: true, force: true })
})

describe('LastActiveSessionStore · read', () => {
  it('文件不存在时返回 null', async () => {
    expect(await store.read()).toBeNull()
  })

  it('读取已持久化的最后激活会话记录', async () => {
    await store.write({
      agentId: 'tangyuan',
      sessionId: 'sess-1',
    })

    expect(await store.read()).toEqual({
      agentId: 'tangyuan',
      sessionId: 'sess-1',
      updatedAt: '2026-07-08T00:00:00.000Z',
    })
  })

  it('文件损坏（非合法 JSON）时返回 null', async () => {
    const path = layout.lastActiveSession()
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, '{not json', 'utf8')

    expect(await store.read()).toBeNull()
  })

  it('文件结构不合法时返回 null', async () => {
    const path = layout.lastActiveSession()
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify({ foo: 'bar' }), 'utf8')

    expect(await store.read()).toBeNull()
  })
})

describe('LastActiveSessionStore · write', () => {
  it('原子写入最后激活会话记录', async () => {
    await store.write({
      agentId: 'agent-2',
      sessionId: 'sess-9',
    })

    const raw = await readFile(layout.lastActiveSession(), 'utf8')
    expect(JSON.parse(raw)).toEqual({
      agentId: 'agent-2',
      sessionId: 'sess-9',
      updatedAt: '2026-07-08T00:00:00.000Z',
    })
  })

  it('使用注入的 now 作为 updatedAt', async () => {
    const fixedNow = '2026-08-01T12:00:00.000Z'
    const fixedStore = new LastActiveSessionStore({
      layout,
      now: () => fixedNow,
    })

    const result = await fixedStore.write({
      agentId: 'tangyuan',
      sessionId: 'sess-1',
    })

    expect(result.updatedAt).toBe(fixedNow)
    expect(await fixedStore.read()).toEqual({
      agentId: 'tangyuan',
      sessionId: 'sess-1',
      updatedAt: fixedNow,
    })
  })
})

describe('LastActiveSessionStore · clear', () => {
  it('清除已存在的记录文件', async () => {
    await store.write({
      agentId: 'tangyuan',
      sessionId: 'sess-1',
    })

    await store.clear()
    expect(await store.read()).toBeNull()
  })

  it('记录不存在时清除不报错', async () => {
    await store.clear()
    expect(await store.read()).toBeNull()
  })
})
