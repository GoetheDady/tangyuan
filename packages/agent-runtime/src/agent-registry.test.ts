import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type {
  AgentEvent,
  ConfigEncryptionAdapter,
} from '@tangyuan/contracts'
import { DirectoryLayout } from './directory-layout'
import { ConfigStore } from './config-store'
import { AgentRegistry } from './agent-registry'
import { AgentRuntimeError } from './errors'

const fakeAdapter: ConfigEncryptionAdapter = {
  encrypt: async (p) => `enc:${Buffer.from(p, 'utf8').toString('base64')}`,
  decrypt: async (c) =>
    Buffer.from(c.replace(/^enc:/, ''), 'base64').toString('utf8'),
  isAvailable: () => true,
}

let dir: string
let layout: DirectoryLayout
let configStore: ConfigStore
let registry: AgentRegistry
let events: AgentEvent[]

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agent-registry-'))
  const agentHomePath = join(dir, 'agents', 'tangyuan')
  layout = new DirectoryLayout({ agentHomePath, fsRoot: dir, userDataPath: dir })
  configStore = new ConfigStore({
    layout,
    encryptionAdapter: fakeAdapter,
    now: () => 'now',
  })
  events = []
  registry = new AgentRegistry({
    layout,
    configStore,
    now: () => 'now',
    emit: (e) => events.push(e),
    agentHomePath,
  })
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('AgentRegistry.createAgent', () => {
  it('创建 Agent 写入配置、建目录并 emit agent-created', async () => {
    const summary = await registry.createAgent('测试助手')
    expect(summary.displayName).toBe('测试助手')
    expect(summary.status).toBe('active')
    expect(summary.directoryStatus).toBe('healthy')
    expect(events.map((e) => e.type)).toContain('agent-created')

    const agents = await registry.listAgents()
    expect(agents.map((a) => a.displayName)).toContain('测试助手')
  })
})

describe('AgentRegistry.updateAgentConfig', () => {
  it('更新已有 Agent 的默认模型并 emit', async () => {
    const created = await registry.createAgent('a')
    const updated = await registry.updateAgentConfig(created.agentId, {
      defaultProviderId: 'openai',
      defaultModelId: 'gpt-4',
    })
    expect(updated.defaultProviderId).toBe('openai')
    expect(updated.defaultModelId).toBe('gpt-4')
    expect(events.map((e) => e.type)).toContain('agent-config-updated')
  })

  it('Agent 不存在时抛错', async () => {
    await expect(
      registry.updateAgentConfig('missing', { defaultModelId: 'x' }),
    ).rejects.toThrow(AgentRuntimeError)
  })
})

describe('AgentRegistry.archive/recover', () => {
  it('归档后再恢复，状态往返', async () => {
    const created = await registry.createAgent('a')
    const archived = await registry.archiveAgent(created.agentId)
    expect(archived.status).toBe('archived')
    expect(archived.archivedAt).toBe('now')

    const recovered = await registry.recoverAgent(created.agentId)
    expect(recovered.status).toBe('active')
    expect(recovered.archivedAt).toBeNull()

    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining(['agent-archived', 'agent-recovered']),
    )
  })

  it('默认汤圆不可归档', async () => {
    await expect(registry.archiveAgent('tangyuan')).rejects.toThrow(
      AgentRuntimeError,
    )
  })
})

describe('AgentRegistry.reconcile/claim', () => {
  it('发现未归属目录并可认领', async () => {
    // 手工造一个磁盘目录但不写配置
    const orphanHome = layout.agentHome('orphan')
    await mkdir(orphanHome, { recursive: true })
    await writeFile(join(orphanHome, 'soul.md'), '# orphan', 'utf8')

    const report = await registry.reconcileAgentDirectories()
    expect(report.unclaimedDirectories.map((d) => d.agentId)).toContain(
      'orphan',
    )

    const claimed = await registry.claimAgentDirectory('orphan', '孤儿')
    expect(claimed.displayName).toBe('孤儿')
    const agents = await registry.listAgents()
    expect(agents.map((a) => a.agentId)).toContain('orphan')
  })

  it('认领缺少 soul.md 的目录抛错', async () => {
    await expect(registry.claimAgentDirectory('nope', 'x')).rejects.toThrow(
      AgentRuntimeError,
    )
  })
})

describe('AgentRegistry.rebuildTangyuanHome', () => {
  it('重建默认汤圆目录结构', async () => {
    const summary = await registry.rebuildTangyuanHome()
    expect(summary.agentId).toBe('tangyuan')
    expect(summary.directoryStatus).toBe('healthy')
  })
})
