import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SkillOperationParams } from '@tangyuan/contracts'
import { DirectoryLayout } from './directory-layout'
import { SkillStore } from './skill-store'

// mock 重型 Pi SDK ResourceLoader：安装/删除后 install 会调 list*，
// 这里只让它返回空列表，聚焦验证磁盘写入与安装记录行为。
vi.mock('@earendil-works/pi-coding-agent', () => ({
  DefaultResourceLoader: class {
    async reload(): Promise<void> {}
    getSkills(): { skills: never[]; diagnostics: never[] } {
      return { skills: [], diagnostics: [] }
    }
  },
}))

let dir: string
let layout: DirectoryLayout
let store: SkillStore

/** 造一个合法 Skill 源目录（含带 description 的 SKILL.md）。 */
async function makeSourceSkill(name: string): Promise<string> {
  const src = join(dir, 'src', name)
  await mkdir(src, { recursive: true })
  await writeFile(
    join(src, 'SKILL.md'),
    `---\nname: ${name}\ndescription: 测试用途的 skill\n---\n# ${name}\n`,
    'utf8',
  )
  return src
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'skill-store-'))
  layout = new DirectoryLayout({
    agentHomePath: join(dir, 'agents', 'tangyuan'),
    fsRoot: dir,
    userDataPath: dir,
  })
  store = new SkillStore({ layout, now: () => '2026-01-01T00:00:00.000Z' })
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('SkillStore.installSkill', () => {
  it('安装共享 Skill：写入目标目录并记录安装', async () => {
    const src = await makeSourceSkill('demo')
    const params: SkillOperationParams = {
      operation: 'install',
      source: 'shared',
      agentId: 'tangyuan',
      skillName: 'demo',
      skillDirPath: src,
    }
    await store.installSkill(params)

    // 目标目录已写入 SKILL.md
    const installed = join(layout.sharedSkills(), 'demo', 'SKILL.md')
    expect(await readFile(installed, 'utf8')).toContain('description:')

    // 安装记录已写入
    const records = await store.getSkillInstallRecords()
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      skillName: 'demo',
      source: 'shared',
      status: 'active',
    })
  })

  it('源目录缺少 SKILL.md 时拒绝安装', async () => {
    const bad = join(dir, 'bad')
    await mkdir(bad, { recursive: true })
    await expect(
      store.installSkill({
        operation: 'install',
        source: 'shared',
        agentId: 'tangyuan',
        skillName: 'bad',
        skillDirPath: bad,
      }),
    ).rejects.toThrow(/缺少 SKILL.md/)
  })

  it('缺少 skillDirPath 时报错', async () => {
    await expect(
      store.installSkill({
        operation: 'install',
        source: 'shared',
        agentId: 'tangyuan',
        skillName: 'x',
      }),
    ).rejects.toThrow(/需要提供 skillDirPath/)
  })
})

describe('SkillStore.deleteSkill', () => {
  it('删除已安装 Skill：移入 trash 并标记记录为 deleted', async () => {
    const src = await makeSourceSkill('demo')
    const base: SkillOperationParams = {
      operation: 'install',
      source: 'shared',
      agentId: 'tangyuan',
      skillName: 'demo',
      skillDirPath: src,
    }
    await store.installSkill(base)

    await store.deleteSkill({ ...base, operation: 'delete' })

    const records = await store.getSkillInstallRecords()
    expect(records[0]?.status).toBe('deleted')
  })

  it('删除不存在的 Skill 报错', async () => {
    await expect(
      store.deleteSkill({
        operation: 'delete',
        source: 'shared',
        agentId: 'tangyuan',
        skillName: 'ghost',
      }),
    ).rejects.toThrow(/不存在/)
  })
})

describe('SkillStore.installSkill 更新', () => {
  it('二次安装同名 Skill 保留 installedAt、刷新 updatedAt', async () => {
    const src = await makeSourceSkill('demo')
    const params: SkillOperationParams = {
      operation: 'install',
      source: 'shared',
      agentId: 'tangyuan',
      skillName: 'demo',
      skillDirPath: src,
    }
    await store.installSkill(params)
    await store.installSkill(params)

    const records = await store.getSkillInstallRecords()
    expect(records).toHaveLength(1)
    expect(records[0]?.status).toBe('active')
  })
})
