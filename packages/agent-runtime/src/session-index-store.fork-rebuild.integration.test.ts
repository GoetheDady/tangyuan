import { mkdtemp, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ConfigEncryptionAdapter } from '@tangyuan/contracts'
import { ConfigStore, DirectoryLayout } from './core'
import { RealPiSdkGateway } from './gateway'
import { SessionIndexStore } from './session-index-store'

const fakeAdapter: ConfigEncryptionAdapter = {
  encrypt: async (plaintext) =>
    `enc:${Buffer.from(plaintext, 'utf8').toString('base64')}`,
  decrypt: async (ciphertext) =>
    Buffer.from(ciphertext.replace(/^enc:/, ''), 'base64').toString('utf8'),
  isAvailable: () => true,
}

let rootPath: string
let layout: DirectoryLayout
let configStore: ConfigStore

beforeEach(async () => {
  rootPath = await mkdtemp(join(tmpdir(), 'tangyuan-fork-rebuild-'))
  layout = new DirectoryLayout({
    agentHomePath: join(rootPath, 'agents', 'tangyuan'),
    fsRoot: rootPath,
    userDataPath: rootPath,
  })
  configStore = new ConfigStore({
    layout,
    encryptionAdapter: fakeAdapter,
    now: () => 'now',
  })
  await configStore.write({
    schemaVersion: 2,
    providers: { anthropic: { apiKey: 'sk-test', updatedAt: 'now' } },
    agents: {
      tangyuan: {
        displayName: '汤圆',
        defaultProviderId: 'anthropic',
        defaultModelId: 'claude-sonnet-4-5',
        status: 'active',
        archivedAt: null,
      },
    },
  })
})

afterEach(async () => {
  await rm(rootPath, { recursive: true, force: true })
})

/**
 * 在真实 Pi session 目录里写一个含 assistant 回复的会话，返回其 session 文件。
 *
 * @param label - 用于区分不同会话消息内容的标签。
 * @returns 会话文件路径、session ID 与首条用户消息标识。
 */
function createPersistedSession(label: string): {
  sessionFile: string
  sessionId: string
  firstUserMessageId: string
  secondUserMessageId: string
} {
  const session = SessionManager.create(
    layout.agentHome(),
    layout.sdkSessionDir(),
  )
  const firstUserMessageId = session.appendMessage({
    role: 'user',
    content: `${label} 的第一条消息`,
    timestamp: 1,
  })
  session.appendMessage({
    role: 'assistant',
    content: [{ type: 'text', text: `${label} 的回答` }],
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: 'test',
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: 2,
  })
  const secondUserMessageId = session.appendMessage({
    role: 'user',
    content: `${label} 的第二条消息`,
    timestamp: 3,
  })

  return {
    sessionFile: session.getSessionFile()!,
    sessionId: session.getSessionId(),
    firstUserMessageId,
    secondUserMessageId,
  }
}

describe('SessionIndexStore 从真实 Pi session 重建会话谱系', () => {
  it('删除本地索引后仍能恢复任意深度谱系与精确来源', async () => {
    const gateway = new RealPiSdkGateway()
    const parent = createPersistedSession('父会话')
    const child = await gateway.createBranchedSession({
      sdkSessionFile: parent.sessionFile,
      entryId: parent.secondUserMessageId,
    })
    const childSession = SessionManager.open(
      child.sdkSessionFile,
      layout.sdkSessionDir(),
    )
    const childUserMessageId = childSession.appendMessage({
      role: 'user',
      content: '子会话的消息',
      timestamp: 4,
    })
    const grandchild = await gateway.createBranchedSession({
      sdkSessionFile: child.sdkSessionFile,
      entryId: childUserMessageId,
    })
    // 同源第二个分叉，验证互不覆盖。
    const sibling = await gateway.createBranchedSession({
      sdkSessionFile: parent.sessionFile,
      entryId: parent.secondUserMessageId,
    })

    const store = new SessionIndexStore({ layout, configStore, gateway })
    await store.load()
    await store.write()
    // 模拟本地会话索引丢失。
    await unlink(layout.sessionIndex())

    const rebuiltStore = new SessionIndexStore({ layout, configStore, gateway })
    await rebuiltStore.load()

    expect(
      rebuiltStore.getSummary(parent.sessionId)?.forkedFrom,
    ).toBeUndefined()
    expect(rebuiltStore.getSummary(child.sessionId)).toMatchObject({
      forkedFrom: {
        sessionId: parent.sessionId,
        entryId: parent.secondUserMessageId,
      },
    })
    expect(rebuiltStore.getSummary(sibling.sessionId)).toMatchObject({
      forkedFrom: {
        sessionId: parent.sessionId,
        entryId: parent.secondUserMessageId,
      },
    })
    expect(rebuiltStore.getSummary(grandchild.sessionId)).toMatchObject({
      forkedFrom: {
        sessionId: child.sessionId,
        entryId: childUserMessageId,
      },
    })
    expect(
      rebuiltStore
        .listSummaries('tangyuan')
        .map((summary) => summary.sessionId)
        .sort(),
    ).toEqual(
      [
        parent.sessionId,
        child.sessionId,
        sibling.sessionId,
        grandchild.sessionId,
      ].sort(),
    )
  })

  it('首条用户消息分叉出的空历史会话在重建后仍保留来源', async () => {
    const gateway = new RealPiSdkGateway()
    const parent = createPersistedSession('父会话')
    const child = await gateway.createBranchedSession({
      sdkSessionFile: parent.sessionFile,
      entryId: parent.firstUserMessageId,
    })

    const store = new SessionIndexStore({ layout, configStore, gateway })
    await store.load()

    expect(store.getSummary(child.sessionId)).toMatchObject({
      forkedFrom: {
        sessionId: parent.sessionId,
        entryId: parent.firstUserMessageId,
      },
    })
  })
})
