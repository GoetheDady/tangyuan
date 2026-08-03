import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it } from 'vitest'
import { RealPiSdkGateway } from './gateway'
import { stringifyPiSdkMessageContent } from '../core'

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
    const rootPath = await mkdtemp(join(tmpdir(), 'yuanxiao-pi-fork-'))
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
      messageId: sourceMessageId,
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
        customType: 'yuanxiao:fork-source',
        data: {
          sessionId: parentSessionId,
          entryId: sourceMessageId,
          sdkEntryId: sourceMessageId,
        },
      }),
    ])
    await expect(
      new RealPiSdkGateway().listSessions({ sessionDir }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sessionId: forked.sessionId,
          forkedFrom: expect.objectContaining({
            sessionId: parentSessionId,
            entryId: sourceMessageId,
          }),
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
    const rootPath = await mkdtemp(join(tmpdir(), 'yuanxiao-pi-first-fork-'))
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
      messageId: sourceMessageId,
    })

    const child = SessionManager.open(forked.sdkSessionFile, sessionDir)
    expect(child.getEntries()).toEqual([
      expect.objectContaining({
        type: 'custom',
        customType: 'yuanxiao:fork-source',
        data: {
          sessionId: parent.getSessionId(),
          entryId: sourceMessageId,
          sdkEntryId: sourceMessageId,
        },
      }),
    ])
  })
  it('keeps the fork source record out of the model context when the child continues', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'yuanxiao-pi-fork-context-'))
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
      messageId: sourceMessageId,
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
  it('persists the fork source record when the retained path has no assistant reply', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'yuanxiao-pi-fork-draft-'))
    tempDirs.push(rootPath)
    const cwd = join(rootPath, 'agent-home')
    const sessionDir = join(rootPath, 'sessions')
    const parent = SessionManager.create(cwd, sessionDir)
    const firstMessageId = parent.appendMessage({
      role: 'user',
      content: '第一条用户消息',
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
    // 首条分叉得到空历史子会话；随后在子会话里只追加一条用户消息（无 assistant），
    // 再从这条消息递归分叉时保留路径里同样没有 assistant 回复。
    const child = await new RealPiSdkGateway().createBranchedSession({
      sdkSessionFile: parent.getSessionFile()!,
      entryId: firstMessageId,
      messageId: firstMessageId,
    })
    const childSession = SessionManager.open(child.sdkSessionFile, sessionDir)
    const childMessageId = childSession.appendMessage({
      role: 'user',
      content: '子会话里的用户消息',
      timestamp: 3,
    })

    const grandchild = await new RealPiSdkGateway().createBranchedSession({
      sdkSessionFile: child.sdkSessionFile,
      entryId: childMessageId,
      messageId: childMessageId,
    })

    await expect(stat(grandchild.sdkSessionFile)).resolves.toBeDefined()
    const grandchildSession = SessionManager.open(
      grandchild.sdkSessionFile,
      sessionDir,
    )
    expect(grandchildSession.getSessionId()).toBe(grandchild.sessionId)
    expect(grandchildSession.getCwd()).toBe(cwd)
    expect(grandchildSession.getHeader()?.parentSession).toBe(
      child.sdkSessionFile,
    )
    // 递归分叉的来源记录必须落盘，且只保留指向直接父会话的最新一条。
    expect(
      grandchildSession
        .getEntries()
        .filter(
          (entry) =>
            entry.type === 'custom' &&
            entry.customType === 'yuanxiao:fork-source',
        ),
    ).toEqual([
      expect.objectContaining({
        data: {
          sessionId: child.sessionId,
          entryId: childMessageId,
          sdkEntryId: childMessageId,
        },
      }),
    ])
    await expect(
      new RealPiSdkGateway().listSessions({ sessionDir }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sessionId: grandchild.sessionId,
          forkedFrom: expect.objectContaining({
            sessionId: child.sessionId,
            entryId: childMessageId,
          }),
        }),
      ]),
    )
  })
  it('keeps sibling forks from the same source independent', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'yuanxiao-pi-fork-siblings-'))
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
      content: '同一条分叉源消息',
      timestamp: 3,
    })
    const parentSessionFile = parent.getSessionFile()!

    const first = await new RealPiSdkGateway().createBranchedSession({
      sdkSessionFile: parentSessionFile,
      entryId: sourceMessageId,
      messageId: sourceMessageId,
    })
    const second = await new RealPiSdkGateway().createBranchedSession({
      sdkSessionFile: parentSessionFile,
      entryId: sourceMessageId,
      messageId: sourceMessageId,
    })

    expect(second.sessionId).not.toBe(first.sessionId)
    expect(second.sdkSessionFile).not.toBe(first.sdkSessionFile)

    const firstSession = SessionManager.open(first.sdkSessionFile, sessionDir)
    const secondSession = SessionManager.open(second.sdkSessionFile, sessionDir)
    firstSession.appendMessage({
      role: 'user',
      content: '第一个方案',
      timestamp: 4,
    })
    secondSession.appendMessage({
      role: 'user',
      content: '第二个方案',
      timestamp: 5,
    })

    expect(
      SessionManager.open(first.sdkSessionFile, sessionDir)
        .buildSessionContext()
        .messages.map((message) =>
          stringifyPiSdkMessageContent(
            (message as { content?: unknown }).content,
          ),
        ),
    ).toEqual(['保留的历史消息', '保留的历史回答', '第一个方案'])
    expect(
      SessionManager.open(second.sdkSessionFile, sessionDir)
        .buildSessionContext()
        .messages.map((message) =>
          stringifyPiSdkMessageContent(
            (message as { content?: unknown }).content,
          ),
        ),
    ).toEqual(['保留的历史消息', '保留的历史回答', '第二个方案'])
    await expect(
      new RealPiSdkGateway().listSessions({ sessionDir }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sessionId: first.sessionId,
          forkedFrom: expect.objectContaining({
            sessionId: parent.getSessionId(),
            entryId: sourceMessageId,
          }),
        }),
        expect.objectContaining({
          sessionId: second.sessionId,
          forkedFrom: expect.objectContaining({
            sessionId: parent.getSessionId(),
            entryId: sourceMessageId,
          }),
        }),
      ]),
    )
  })
  it('keeps exactly one fork source record and excludes it from the model context on recursive forks', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'yuanxiao-pi-fork-nested-'))
    tempDirs.push(rootPath)
    const cwd = join(rootPath, 'agent-home')
    const sessionDir = join(rootPath, 'sessions')
    /**
     * 向会话追加一问一答。
     *
     * @param session - Pi SDK 会话管理器。
     * @param label - 消息文本前缀。
     * @param timestamp - 用户消息时间戳。
     * @returns 用户消息标识。
     */
    const appendExchange = (
      session: SessionManager,
      label: string,
      timestamp: number,
    ): string => {
      const messageId = session.appendMessage({
        role: 'user',
        content: label,
        timestamp,
      })
      session.appendMessage({
        role: 'assistant',
        content: [{ type: 'text', text: `回答：${label}` }],
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
        timestamp: timestamp + 1,
      })

      return messageId
    }

    const parent = SessionManager.create(cwd, sessionDir)
    appendExchange(parent, '父会话历史', 1)
    const parentSourceId = appendExchange(parent, '父会话来源消息', 3)
    const child = await new RealPiSdkGateway().createBranchedSession({
      sdkSessionFile: parent.getSessionFile()!,
      entryId: parentSourceId,
      messageId: parentSourceId,
    })
    // 子会话追加一问一答，使递归分叉的保留路径含 assistant 回复（Pi SDK 会自行落盘）。
    const childSession = SessionManager.open(child.sdkSessionFile, sessionDir)
    appendExchange(childSession, '子会话历史', 5)
    const childSourceId = appendExchange(childSession, '子会话来源消息', 7)

    const grandchild = await new RealPiSdkGateway().createBranchedSession({
      sdkSessionFile: child.sdkSessionFile,
      entryId: childSourceId,
      messageId: childSourceId,
    })

    const grandchildSession = SessionManager.open(
      grandchild.sdkSessionFile,
      sessionDir,
    )
    // 从父路径继承来的旧来源记录不得残留，否则同一文件里会出现多条矛盾的来源。
    expect(
      grandchildSession
        .getEntries()
        .filter(
          (entry) =>
            entry.type === 'custom' &&
            entry.customType === 'yuanxiao:fork-source',
        ),
    ).toEqual([
      expect.objectContaining({
        data: {
          sessionId: child.sessionId,
          entryId: childSourceId,
          sdkEntryId: childSourceId,
        },
      }),
    ])
    // 来源记录不参与模型上下文；上下文只包含保留的对话历史。
    expect(
      grandchildSession
        .buildSessionContext()
        .messages.map((message) =>
          stringifyPiSdkMessageContent(
            (message as { content?: unknown }).content,
          ),
        ),
    ).toEqual([
      '父会话历史',
      '回答：父会话历史',
      '子会话历史',
      '回答：子会话历史',
    ])
  })
  it('reports an unavailable parent session when the source file has no persisted history', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'yuanxiao-pi-fork-empty-'))
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
        messageId: sourceMessageId,
      }),
    ).rejects.toThrow('来源会话尚无可读取的历史记录，无法分叉。')
  })
})
