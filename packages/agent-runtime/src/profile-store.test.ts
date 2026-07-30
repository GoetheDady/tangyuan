import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type {
  ConfigEncryptionAdapter,
  InternalRuntimeConfig,
} from '@tangyuan/contracts'
import { ConfigStore, DirectoryLayout } from './core'
import { ProfileStore } from './profile-store'

const fakeAdapter: ConfigEncryptionAdapter = {
  encrypt: async (p) => `enc:${Buffer.from(p, 'utf8').toString('base64')}`,
  decrypt: async (c) =>
    Buffer.from(c.replace(/^enc:/, ''), 'base64').toString('utf8'),
  isAvailable: () => true,
}

let dir: string
let layout: DirectoryLayout
let configStore: ConfigStore
let store: ProfileStore

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'profile-store-'))
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
  store = new ProfileStore({ layout, configStore, now: () => 'now' })
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('ProfileStore.ensureDefaultAgentHome', () => {
  it('全新环境写入 bootstrap.md 并标记未初始化', async () => {
    const status = await store.ensureDefaultAgentHome()
    expect(status.initialized).toBe(false)
    expect(status.bootstrapFileExists).toBe(true)
    const bootstrap = await readFile(
      join(layout.agentHome(), 'bootstrap.md'),
      'utf8',
    )
    expect(bootstrap).toContain('# Bootstrap')
  })

  it('soul.md 与 user.md 均有内容时标记已初始化', async () => {
    await store.ensureDefaultAgentHome()
    await writeFile(
      join(layout.agentHome(), 'soul.md'),
      '# 汤圆\n有内容',
      'utf8',
    )
    await mkdir(layout.sharedProfile(), { recursive: true })
    await writeFile(layout.userProfile(), '# 用户\n有内容', 'utf8')

    const status = await store.ensureDefaultAgentHome()
    expect(status.initialized).toBe(true)
  })
})

describe('ProfileStore.writeSoul', () => {
  it('首次创建无需空备份', async () => {
    const current = await store.readSoul('agent-a')

    const outcome = await store.writeSoul(
      'agent-a',
      '# Agent A\n首次内容',
      current.version,
    )

    expect(outcome.result).toEqual({
      target: 'soul',
      status: 'updated',
      version: expect.any(String),
    })
    expect(await readFile(layout.soul('agent-a'), 'utf8')).toBe(
      '# Agent A\n首次内容',
    )
    expect(await readdir(layout.soulHistory('agent-a'))).toEqual([])
  })

  it('内容变化时先自动备份旧内容再写入', async () => {
    const initial = await store.readSoul('agent-a')
    const created = await store.writeSoul('agent-a', '旧内容', initial.version)

    const outcome = await store.writeSoul(
      'agent-a',
      '新内容',
      created.result.version,
    )

    expect(outcome.result.status).toBe('updated')
    expect(await readFile(layout.soul('agent-a'), 'utf8')).toBe('新内容')
    const historyFiles = await readdir(layout.soulHistory('agent-a'))
    expect(historyFiles).toHaveLength(1)
    expect(
      await readFile(
        join(layout.soulHistory('agent-a'), historyFiles[0]!),
        'utf8',
      ),
    ).toBe('旧内容')
  })

  it('内容无变化时不写文件且不创建备份', async () => {
    const initial = await store.readSoul('agent-a')
    const created = await store.writeSoul(
      'agent-a',
      '相同内容',
      initial.version,
    )

    const outcome = await store.writeSoul(
      'agent-a',
      '相同内容',
      created.result.version,
    )

    expect(outcome.written).toBe(false)
    expect(outcome.result).toEqual({
      target: 'soul',
      status: 'unchanged',
      version: created.result.version,
    })
    expect(await readdir(layout.soulHistory('agent-a'))).toEqual([])
  })

  it('纯空白内容被拒绝且不写文件或创建备份', async () => {
    const initial = await store.readSoul('agent-a')
    const created = await store.writeSoul('agent-a', '原内容', initial.version)

    const outcome = await store.writeSoul(
      'agent-a',
      ' \n\t ',
      created.result.version,
    )

    expect(outcome.written).toBe(false)
    expect(outcome.result).toMatchObject({
      target: 'soul',
      status: 'rejected',
      reason: { code: 'invalid-content' },
    })
    expect(await readFile(layout.soul('agent-a'), 'utf8')).toBe('原内容')
    expect(await readdir(layout.soulHistory('agent-a'))).toEqual([])
  })

  it('调用方版本落后时拒绝覆盖', async () => {
    const initial = await store.readSoul('agent-a')
    const first = await store.writeSoul('agent-a', '第一版', initial.version)
    await store.writeSoul('agent-a', '第二版', first.result.version)

    const outcome = await store.writeSoul(
      'agent-a',
      '过期会话的版本',
      first.result.version,
    )

    expect(outcome.written).toBe(false)
    expect(outcome.result).toMatchObject({
      target: 'soul',
      status: 'rejected',
      reason: { code: 'version-conflict' },
    })
    expect(await readFile(layout.soul('agent-a'), 'utf8')).toBe('第二版')
  })

  it('并发更新基于同一版本时只允许一个写入', async () => {
    const initial = await store.readSoul('agent-a')

    const outcomes = await Promise.all([
      store.writeSoul('agent-a', '并发版本 A', initial.version),
      store.writeSoul('agent-a', '并发版本 B', initial.version),
    ])

    expect(
      outcomes.filter((outcome) => outcome.result.status === 'updated'),
    ).toHaveLength(1)
    expect(outcomes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          written: false,
          result: expect.objectContaining({
            status: 'rejected',
            reason: { code: 'version-conflict', message: expect.any(String) },
          }),
        }),
      ]),
    )
  })

  it('检测到敏感凭据时拒绝整次更新', async () => {
    const config: InternalRuntimeConfig = {
      schemaVersion: 2,
      providers: {
        openai: { apiKey: 'sk-secret-123456789', updatedAt: 'now' },
      },
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
    const current = await store.readSoul('tangyuan')
    const created = await store.writeSoul(
      'tangyuan',
      '安全的旧内容',
      current.version,
    )

    const outcome = await store.writeSoul(
      'tangyuan',
      '# 汤圆\nkey 是 sk-secret-123456789 请记住',
      created.result.version,
    )

    expect(outcome.written).toBe(false)
    expect(outcome.result).toMatchObject({
      status: 'rejected',
      reason: { code: 'sensitive-content' },
    })
    expect(await readFile(layout.soul('tangyuan'), 'utf8')).toBe('安全的旧内容')
    expect(await readdir(layout.soulHistory('tangyuan'))).toEqual([])
  })

  it('备份失败时正式内容保持不变', async () => {
    const initial = await store.readSoul('agent-a')
    const created = await store.writeSoul('agent-a', '旧内容', initial.version)
    await rm(layout.soulHistory('agent-a'), { recursive: true })
    await writeFile(layout.soulHistory('agent-a'), '阻止创建目录', 'utf8')

    const outcome = await store.writeSoul(
      'agent-a',
      '新内容',
      created.result.version,
    )

    expect(outcome.written).toBe(false)
    expect(outcome.result).toMatchObject({
      status: 'rejected',
      reason: { code: 'backup-failed' },
    })
    expect(await readFile(layout.soul('agent-a'), 'utf8')).toBe('旧内容')
  })
})

describe('ProfileStore.redactSensitiveContent', () => {
  it('移除 sk- 密钥与 key: 模式', () => {
    const out = store.redactSensitiveContent(
      'token: abc123def456\n普通文本 sk-abcdefghij',
      null,
    )
    expect(out).not.toContain('abc123def456')
    expect(out).not.toContain('sk-abcdefghij')
  })
})

describe('ProfileStore.buildSystemPromptContext', () => {
  it('未初始化时注入 bootstrap 指令', async () => {
    await store.ensureDefaultAgentHome()
    const ctx = await store.buildSystemPromptContext('tangyuan')
    expect(ctx).toContain('bootstrap.md')
    expect(ctx).toContain('尚未初始化')
  })

  it('已初始化时注入 soul 与 user 内容', async () => {
    await store.ensureDefaultAgentHome()
    await writeFile(join(layout.agentHome(), 'soul.md'), 'SOUL_BODY', 'utf8')
    await mkdir(layout.sharedProfile(), { recursive: true })
    await writeFile(layout.userProfile(), 'USER_BODY', 'utf8')

    const ctx = await store.buildSystemPromptContext('tangyuan')
    expect(ctx).toContain('SOUL_BODY')
    expect(ctx).toContain('USER_BODY')
  })
})
