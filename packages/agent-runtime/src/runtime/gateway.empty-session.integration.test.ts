import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { PiSdkCreateSessionRequest } from '../driver'
import { RealPiSdkGateway } from './gateway'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('RealPiSdkGateway 空会话持久化', () => {
  it('创建后立即落盘 header，并可读取为空 transcript', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'yuanxiao-empty-session-'))
    const sessionDir = join(rootPath, 'sessions')
    const cwd = join(rootPath, 'workspace')
    tempDirs.push(rootPath)
    await Promise.all([
      mkdir(sessionDir, { recursive: true }),
      mkdir(cwd, { recursive: true }),
    ])

    const request: PiSdkCreateSessionRequest = {
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      apiKey: 'sk-test',
      agentId: 'yuanxiao',
      sessionId: 'empty-session',
      sdkSessionFile: join(sessionDir, 'empty-session.jsonl'),
      cwd,
      agentSkillsPath: join(rootPath, 'agent-skills'),
      sharedSkillsPath: join(rootPath, 'shared-skills'),
      onUpdateSoul: async () => ({
        target: 'soul',
        status: 'updated',
        version: 'sha256:soul',
      }),
      onUpdateUserProfile: async () => ({
        target: 'user',
        status: 'updated',
        version: 'sha256:user',
      }),
    }

    const gateway = new RealPiSdkGateway()
    const handle = await gateway.createSession(request)

    try {
      expect(handle.sdkSessionFile).toBeDefined()
      const sessionFile = handle.sdkSessionFile!
      const lines = (await readFile(sessionFile, 'utf8'))
        .split('\n')
        .filter(Boolean)

      expect(lines.length).toBeGreaterThanOrEqual(1)
      expect(JSON.parse(lines[0]!)).toMatchObject({
        type: 'session',
        id: request.sessionId,
        cwd,
      })

      await expect(
        gateway.readMessages({
          sessionId: request.sessionId,
          sdkSessionFile: sessionFile,
        }),
      ).resolves.toMatchObject({
        agentId: 'yuanxiao',
        sessionId: request.sessionId,
        entries: [],
      })
    } finally {
      handle.dispose()
    }
  })
})
