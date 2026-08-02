import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RealPiSdkGateway } from './gateway'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('RealPiSdkGateway.readMessages', () => {
  it('会话文件不存在时拒绝返回空 transcript', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'yuanxiao-read-messages-'))
    tempDirs.push(rootPath)

    await expect(
      new RealPiSdkGateway().readMessages({
        sessionId: 'missing-session',
        sdkSessionFile: join(rootPath, 'missing-session.jsonl'),
      }),
    ).rejects.toThrow('会话文件不可读')
  })

  it('会话文件缺少合法 header 时拒绝返回空 transcript', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'yuanxiao-read-messages-'))
    const sessionFile = join(rootPath, 'corrupted-session.jsonl')
    tempDirs.push(rootPath)
    await writeFile(sessionFile, '{ not valid json\n', 'utf8')

    await expect(
      new RealPiSdkGateway().readMessages({
        sessionId: 'corrupted-session',
        sdkSessionFile: sessionFile,
      }),
    ).rejects.toThrow('会话文件不可读')
  })

  it('合法 header 后存在损坏条目时拒绝返回截断 transcript', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'yuanxiao-read-messages-'))
    const sessionFile = join(rootPath, 'corrupted-entry-session.jsonl')
    tempDirs.push(rootPath)
    await writeFile(
      sessionFile,
      `${JSON.stringify({
        type: 'session',
        version: 3,
        id: 'corrupted-entry-session',
        timestamp: '2026-07-28T00:00:00.000Z',
        cwd: rootPath,
      })}\n{ not valid json\n`,
      'utf8',
    )

    await expect(
      new RealPiSdkGateway().readMessages({
        sessionId: 'corrupted-entry-session',
        sdkSessionFile: sessionFile,
      }),
    ).rejects.toThrow('会话文件不可读')
  })
})
