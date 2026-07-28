import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it } from 'vitest'
import { RealPiSdkGateway } from './gateway'
import { stringifyPiSdkMessageContent } from './utils'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('RealPiSdkGateway independent fork', () => {
  it('creates a new Pi JSONL that excludes the fork source user message', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'tangyuan-pi-fork-'))
    tempDirs.push(rootPath)
    const cwd = join(rootPath, 'agent-home')
    const sessionDir = join(rootPath, 'sessions')
    const parent = SessionManager.create(cwd, sessionDir)
    const previousMessageId = parent.appendMessage({
      role: 'user',
      content: '保留的历史消息',
      timestamp: 1,
    })
    const previousReplyId = parent.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: '保留的历史回答' }],
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
    const sourceMessageId = parent.appendMessage({
      role: 'user',
      content: '作为草稿的分叉源消息',
      timestamp: 3,
    })
    const sourceReplyId = parent.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: '父会话中的后续回答' }],
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
      timestamp: 4,
    })
    const parentSessionId = parent.getSessionId()
    const parentSessionFile = parent.getSessionFile()

    expect(parentSessionFile).toBeDefined()

    const forked = await new RealPiSdkGateway().createBranchedSession({
      sdkSessionFile: parentSessionFile!,
      entryId: sourceMessageId,
    })

    expect(forked.sessionId).not.toBe(parentSessionId)
    expect(forked.sdkSessionFile).not.toBe(parentSessionFile)
    await expect(stat(forked.sdkSessionFile)).resolves.toBeDefined()

    const child = SessionManager.open(forked.sdkSessionFile, sessionDir)
    expect(child.getSessionId()).toBe(forked.sessionId)
    expect(child.getHeader()?.parentSession).toBe(parentSessionFile)
    expect(child.getEntries()).toEqual([
      expect.objectContaining({ id: previousMessageId }),
      expect.objectContaining({ id: previousReplyId }),
      expect.objectContaining({
        type: 'custom',
        customType: 'tangyuan:fork-source',
        data: { sessionId: parentSessionId, entryId: sourceMessageId },
      }),
    ])
    await expect(
      new RealPiSdkGateway().listSessions({ cwd, sessionDir }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sessionId: forked.sessionId,
          forkedFrom: { sessionId: parentSessionId, entryId: sourceMessageId },
        }),
      ]),
    )

    const reopenedParent = SessionManager.open(parentSessionFile!, sessionDir)
    expect(reopenedParent.getEntries()).toEqual([
      expect.objectContaining({ id: previousMessageId }),
      expect.objectContaining({ id: previousReplyId }),
      expect.objectContaining({ id: sourceMessageId }),
      expect.objectContaining({ id: sourceReplyId }),
    ])
  })
  it('creates an empty child JSONL when the source is the first user message', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'tangyuan-pi-first-fork-'))
    tempDirs.push(rootPath)
    const cwd = join(rootPath, 'agent-home')
    const sessionDir = join(rootPath, 'sessions')
    const parent = SessionManager.create(cwd, sessionDir)
    const sourceMessageId = parent.appendMessage({
      role: 'user',
      content: '首条消息作为草稿',
      timestamp: 1,
    })
    parent.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: '父会话回答' }],
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
    const parentSessionFile = parent.getSessionFile()

    const forked = await new RealPiSdkGateway().createBranchedSession({
      sdkSessionFile: parentSessionFile!,
      entryId: sourceMessageId,
    })

    const child = SessionManager.open(forked.sdkSessionFile, sessionDir)
    expect(child.getEntries()).toEqual([
      expect.objectContaining({
        type: 'custom',
        customType: 'tangyuan:fork-source',
        data: { sessionId: parent.getSessionId(), entryId: sourceMessageId },
      }),
    ])
  })
  it('keeps the fork source record out of the model context when the child continues', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'tangyuan-pi-fork-context-'))
    tempDirs.push(rootPath)
    const cwd = join(rootPath, 'agent-home')
    const sessionDir = join(rootPath, 'sessions')
    const parent = SessionManager.create(cwd, sessionDir)
    parent.appendMessage({
      role: 'user',
      content: '保留的历史消息',
      timestamp: 1,
    })
    parent.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: '保留的历史回答' }],
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
    const sourceMessageId = parent.appendMessage({
      role: 'user',
      content: '作为草稿的分叉源消息',
      timestamp: 3,
    })
    const forked = await new RealPiSdkGateway().createBranchedSession({
      sdkSessionFile: parent.getSessionFile()!,
      entryId: sourceMessageId,
    })
    const child = SessionManager.open(forked.sdkSessionFile, sessionDir)

    child.appendMessage({
      role: 'user',
      content: '子会话的新消息',
      timestamp: 4,
    })

    // 断言完整上下文：保留来源消息之前的历史，不包含分叉源消息和来源记录。
    expect(
      child
        .buildSessionContext()
        .messages.map((message) =>
          stringifyPiSdkMessageContent(
            (message as { content?: unknown }).content,
          ),
        ),
    ).toEqual(['保留的历史消息', '保留的历史回答', '子会话的新消息'])
  })
  it('reports an unavailable parent session when the source file has no persisted history', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'tangyuan-pi-fork-empty-'))
    tempDirs.push(rootPath)
    const sessionDir = join(rootPath, 'sessions')
    // Pi 会话在出现首条 assistant 回复前不落盘，此时父文件不可读。
    const parent = SessionManager.create(
      join(rootPath, 'agent-home'),
      sessionDir,
    )
    const sourceMessageId = parent.appendMessage({
      role: 'user',
      content: '尚未落盘的消息',
      timestamp: 1,
    })

    await expect(
      new RealPiSdkGateway().createBranchedSession({
        sdkSessionFile: parent.getSessionFile()!,
        entryId: sourceMessageId,
      }),
    ).rejects.toThrow('来源会话尚无可读取的历史记录，无法分叉。')
  })
})
