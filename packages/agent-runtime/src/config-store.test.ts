import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type {
  ConfigEncryptionAdapter,
  InternalRuntimeConfig,
} from '@tangyuan/contracts'
import { DirectoryLayout } from './directory-layout'
import { ConfigStore } from './config-store'
import { AgentRuntimeError } from './errors'

/** 可逆的假加密适配器：base64 编解码代替真实加密。 */
const fakeAdapter: ConfigEncryptionAdapter = {
  encrypt: async (plaintext) =>
    `enc:${Buffer.from(plaintext, 'utf8').toString('base64')}`,
  decrypt: async (ciphertext) =>
    Buffer.from(ciphertext.replace(/^enc:/, ''), 'base64').toString('utf8'),
  isAvailable: () => true,
}

const sampleConfig: InternalRuntimeConfig = {
  schemaVersion: 2,
  providers: { openai: { apiKey: 'sk-secret', updatedAt: 'now' } },
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

let dir: string
let store: ConfigStore
let layout: DirectoryLayout

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'config-store-'))
  layout = new DirectoryLayout({
    agentHomePath: join(dir, 'agents', 'tangyuan'),
    fsRoot: dir,
    userDataPath: dir,
  })
  store = new ConfigStore({ layout, encryptionAdapter: fakeAdapter, now: () => 'now' })
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('ConfigStore.write/read 往返', () => {
  it('写入后读回等价配置，磁盘上凭据被加密', async () => {
    await store.write(sampleConfig)

    const read = await store.read()
    expect(read.recoveryState).toBe('ok')
    expect(read.config).toEqual(sampleConfig)

    const onDisk = JSON.parse(await readFile(layout.config(), 'utf8'))
    expect(onDisk.providers.openai.encryptedApiKey).toMatch(/^enc:/)
    expect(onDisk.providers.openai.apiKey).toBeUndefined()
  })
})

describe('ConfigStore.read 边界', () => {
  it('配置不存在时返回默认配置', async () => {
    const read = await store.read()
    expect(read.recoveryState).toBe('ok')
    expect(read.config?.agents.tangyuan?.displayName).toBe('汤圆')
    expect(read.hasBackup).toBe(false)
  })

  it('配置文件损坏时标记 corrupted', async () => {
    await writeFile(layout.config(), '{ not valid json', 'utf8')
    const read = await store.read()
    expect(read.recoveryState).toBe('corrupted')
    expect(read.config).toBeNull()
  })
})

describe('ConfigStore.readRequired', () => {
  it('返回 Agent 运行时配置', async () => {
    await store.write(sampleConfig)
    expect(await store.readRequired('tangyuan')).toEqual({
      providerId: 'openai',
      modelId: 'gpt-4',
      apiKey: 'sk-secret',
    })
  })

  it('配置缺失时抛 AgentRuntimeError', async () => {
    await expect(store.readRequired('tangyuan')).rejects.toThrow(
      AgentRuntimeError,
    )
  })
})

describe('ConfigStore.readProviderApiKey', () => {
  it('返回明文 API Key', async () => {
    await store.write(sampleConfig)
    expect(await store.readProviderApiKey('openai')).toBe('sk-secret')
  })

  it('Provider 未配置时返回 undefined', async () => {
    await store.write(sampleConfig)
    expect(await store.readProviderApiKey('missing')).toBeUndefined()
  })
})

describe('ConfigStore.restore/reset/hasBackup', () => {
  it('二次写入产生备份，restore 回滚到上一版本', async () => {
    await store.write(sampleConfig)
    const updated: InternalRuntimeConfig = {
      ...sampleConfig,
      providers: { openai: { apiKey: 'sk-new', updatedAt: 'now' } },
    }
    await store.write(updated)

    expect(await store.hasBackup()).toBe(true)
    await store.restore()

    const read = await store.read()
    expect(read.config?.providers.openai?.apiKey).toBe('sk-secret')
  })

  it('无备份时 restore 抛错', async () => {
    await expect(store.restore()).rejects.toThrow(AgentRuntimeError)
  })

  it('reset 删除配置与备份', async () => {
    await store.write(sampleConfig)
    await store.write({
      ...sampleConfig,
      providers: { openai: { apiKey: 'sk-new', updatedAt: 'now' } },
    })
    await store.reset()

    expect(await store.hasBackup()).toBe(false)
    const read = await store.read()
    expect(read.config?.agents.tangyuan?.displayName).toBe('汤圆')
  })
})
