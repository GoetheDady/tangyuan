import { describe, expect, it } from 'vitest'

import type { TranscriptSnapshot } from '@yuanxiao/contracts'
import type { InternalMessage } from './pi-sdk-driver-events'
import type { PiSdkGateway } from './pi-sdk-driver-contracts'
import { resolveSdkEntryId } from './sdk-entry-id-resolver'

function createUserMessage(
  sessionId: string,
  messageId: string,
  content: string,
): InternalMessage {
  return {
    messageId,
    agentId: 'yuanxiao',
    sessionId,
    role: 'user',
    content,
    createdAt: '2026-07-08T00:00:00.000Z',
  }
}

function createSnapshot(
  sessionId: string,
  entries: TranscriptSnapshot['entries'],
): TranscriptSnapshot {
  return {
    sessionId,
    agentId: 'yuanxiao',
    entries,
    updatedAt: '2026-07-08T00:00:00.000Z',
  }
}

describe('resolveSdkEntryId', () => {
  it('调用方直接传 SDK 原生 entry id 时原样返回', async () => {
    const gateway: Pick<PiSdkGateway, 'readMessages'> = {
      readMessages: async () =>
        createSnapshot('session-1', [
          {
            kind: 'user-message',
            index: 0,
            messageId: 'sdk-uuid-1',
            content: '第一个问题',
            createdAt: '2026-07-08T00:00:00.000Z',
          },
        ]),
    }

    await expect(
      resolveSdkEntryId(
        { gateway, messageStore: { getMessages: () => [] } },
        {
          sessionId: 'session-1',
          driverMessageId: 'sdk-uuid-1',
          sdkSessionFile: '/tmp/session-1.jsonl',
        },
      ),
    ).resolves.toBe('sdk-uuid-1')
  })

  it('分叉继承历史时按尾部对齐把运行期消息桥接到文件 entry', async () => {
    const gateway: Pick<PiSdkGateway, 'readMessages'> = {
      readMessages: async () =>
        createSnapshot('session-1', [
          {
            kind: 'user-message',
            index: 0,
            messageId: 'inherited-uuid',
            content: '第一个问题',
            createdAt: '2026-07-08T00:00:00.000Z',
          },
          {
            kind: 'user-message',
            index: 1,
            messageId: 'live-uuid',
            content: '第一个方案',
            createdAt: '2026-07-08T00:00:00.000Z',
          },
        ]),
    }
    // messageStore 只含运行期消息（文件比 store 多一条继承历史）。
    const messageStore = {
      getMessages: () => [
        createUserMessage('session-1', 'session-1-message-1', '第一个方案'),
      ],
    }

    await expect(
      resolveSdkEntryId(
        { gateway, messageStore },
        {
          sessionId: 'session-1',
          driverMessageId: 'session-1-message-1',
          sdkSessionFile: '/tmp/session-1.jsonl',
        },
      ),
    ).resolves.toBe('live-uuid')
  })

  it('调用方标识找不到或文件未追平运行期消息时回退原标识', async () => {
    const gateway: Pick<PiSdkGateway, 'readMessages'> = {
      readMessages: async () =>
        createSnapshot('session-1', [
          {
            kind: 'user-message',
            index: 0,
            messageId: 'inherited-uuid',
            content: '第一个问题',
            createdAt: '2026-07-08T00:00:00.000Z',
          },
        ]),
    }
    const messageStore = {
      getMessages: () => [
        createUserMessage('session-1', 'session-1-message-1', '第一个问题'),
        createUserMessage('session-1', 'session-1-message-2', '尚未落盘'),
      ],
    }

    await expect(
      resolveSdkEntryId(
        { gateway, messageStore },
        {
          sessionId: 'session-1',
          driverMessageId: 'unknown-message-id',
          sdkSessionFile: '/tmp/session-1.jsonl',
        },
      ),
    ).resolves.toBe('unknown-message-id')
    await expect(
      resolveSdkEntryId(
        { gateway, messageStore },
        {
          sessionId: 'session-1',
          driverMessageId: 'session-1-message-2',
          sdkSessionFile: '/tmp/session-1.jsonl',
        },
      ),
    ).resolves.toBe('session-1-message-2')
  })
})
