import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createTangyuanRuntime } from './index'
import {
  createFakeEncryptionAdapter,
  createPiSdkGateway,
} from './pi-sdk-driver.test-helpers'

let rootPath: string | null = null

afterEach(async () => {
  if (rootPath) {
    await rm(rootPath, { recursive: true, force: true })
    rootPath = null
  }
})

describe('createTangyuanRuntime · 最后激活会话存储', () => {
  it('从生产 Runtime 的 userDataPath 恢复磁盘记录', async () => {
    rootPath = await mkdtemp(join(tmpdir(), 'tangyuan-runtime-last-active-'))
    const sessionsPath = join(rootPath, 'sessions')
    await mkdir(sessionsPath, { recursive: true })
    await writeFile(
      join(sessionsPath, 'index.json'),
      JSON.stringify({
        sessions: [
          {
            sessionId: 'session-1',
            sdkSessionFile: join(sessionsPath, 'pi-sdk', 'session-1.jsonl'),
            title: '最近会话',
            createdAt: '2026-07-28T08:00:00.000Z',
            updatedAt: '2026-07-28T09:00:00.000Z',
            provider: 'anthropic',
            model: 'claude-sonnet-4-5',
            agentId: 'tangyuan',
            lastMessagePreview: '',
            status: 'idle',
          },
        ],
      }),
      'utf8',
    )
    await writeFile(
      join(sessionsPath, 'last-active-session.json'),
      JSON.stringify({
        agentId: 'tangyuan',
        sessionId: 'session-1',
        updatedAt: '2026-07-28T10:00:00.000Z',
      }),
      'utf8',
    )
    const runtime = createTangyuanRuntime({
      agentHomePath: join(rootPath, 'agents', 'tangyuan'),
      fsRoot: rootPath,
      userDataPath: rootPath,
      gateway: createPiSdkGateway(),
      encryptionAdapter: createFakeEncryptionAdapter(),
    })
    await runtime.saveRuntimeConfiguration({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-test-secret-7890',
    })

    await expect(runtime.getLastActiveSession()).resolves.toEqual({
      agentId: 'tangyuan',
      sessionId: 'session-1',
      updatedAt: '2026-07-28T10:00:00.000Z',
    })
  })
})
