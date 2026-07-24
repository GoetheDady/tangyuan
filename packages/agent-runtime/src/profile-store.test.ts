import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type {
  ConfigEncryptionAdapter,
  InternalRuntimeConfig,
} from '@tangyuan/contracts'
import { DirectoryLayout } from './directory-layout'
import { ConfigStore } from './config-store'
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
    await writeFile(join(layout.agentHome(), 'soul.md'), '# 汤圆\n有内容', 'utf8')
    await mkdir(layout.sharedProfile(), { recursive: true })
    await writeFile(layout.userProfile(), '# 用户\n有内容', 'utf8')

    const status = await store.ensureDefaultAgentHome()
    expect(status.initialized).toBe(true)
  })
})

describe('ProfileStore.writeSoul', () => {
  it('无权修改他人 soul 时返回失败且不写入', async () => {
    const outcome = await store.writeSoul('agent-a', '内容', 'agent-b')
    expect(outcome.written).toBe(false)
    expect(outcome.result.success).toBe(false)
  })

  it('缺少备份时拒绝覆盖非空 soul', async () => {
    await store.ensureAgentHome('agent-a')
    // ensureAgentHome 写了默认 soul.md（非空），history 为空 → 无备份
    const outcome = await store.writeSoul('agent-a', '新内容', 'agent-a')
    expect(outcome.written).toBe(false)
    expect(outcome.result.success).toBe(false)
  })

  it('有备份时写入成功并脱敏 API Key', async () => {
    // 配置里存一个 API Key
    const config: InternalRuntimeConfig = {
      schemaVersion: 2,
      providers: { openai: { apiKey: 'sk-secret-123456789', updatedAt: 'now' } },
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
    await store.ensureAgentHome('tangyuan')
    // 造一个 history 备份文件
    await writeFile(
      join(layout.soulHistory('tangyuan'), 'backup.md'),
      'old',
      'utf8',
    )

    const outcome = await store.writeSoul(
      'tangyuan',
      '# 汤圆\nkey 是 sk-secret-123456789 请记住',
      'tangyuan',
    )
    expect(outcome.written).toBe(true)
    const written = await readFile(layout.soul('tangyuan'), 'utf8')
    expect(written).not.toContain('sk-secret-123456789')
    expect(written).toContain('[已隐藏敏感凭据]')
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
