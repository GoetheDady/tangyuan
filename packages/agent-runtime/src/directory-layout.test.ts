import { describe, expect, it } from 'vitest'
import { DirectoryLayout } from './directory-layout'

/**
 * Characterization 测试：锁住搬迁前 PiSdkDriver 各 resolveXxxPath 方法的确切输出，
 * 确保 DirectoryLayout 搬迁后路径行为零变化。
 */
const layout = new DirectoryLayout({
  agentHomePath: '~/.tangyuan/agents/tangyuan',
  fsRoot: '/home/tester',
  userDataPath: '/home/tester/.tangyuan',
})

describe('DirectoryLayout · agent home 派生路径', () => {
  it('默认 Agent 的 home 由 ~ 展开到 fsRoot', () => {
    expect(layout.agentHome()).toBe('/home/tester/.tangyuan/agents/tangyuan')
  })

  it('自定义 Agent 的 home 与默认同级', () => {
    expect(layout.agentHome('foo')).toBe('/home/tester/.tangyuan/agents/foo')
  })

  it('workspace 位于 agent home 下', () => {
    expect(layout.workspace('foo')).toBe(
      '/home/tester/.tangyuan/agents/foo/workspace',
    )
  })

  it('agent 专属 skills 位于 agent home 下', () => {
    expect(layout.agentSkills('foo')).toBe(
      '/home/tester/.tangyuan/agents/foo/skills',
    )
  })

  it('soul 与 soul 历史位于 agent home 下', () => {
    expect(layout.soul('foo')).toBe(
      '/home/tester/.tangyuan/agents/foo/soul.md',
    )
    expect(layout.soulHistory('foo')).toBe(
      '/home/tester/.tangyuan/agents/foo/soul.history',
    )
  })
})

describe('DirectoryLayout · 共享目录派生路径', () => {
  it('共享 skills 位于 .tangyuan 根下', () => {
    expect(layout.sharedSkills()).toBe('/home/tester/.tangyuan/skills')
  })

  it('共享 profile 目录与 user 文件、历史目录', () => {
    expect(layout.sharedProfile()).toBe('/home/tester/.tangyuan/profile')
    expect(layout.userProfile()).toBe(
      '/home/tester/.tangyuan/profile/user.md',
    )
    expect(layout.userHistory()).toBe(
      '/home/tester/.tangyuan/profile/user.history',
    )
  })
})

describe('DirectoryLayout · userDataPath 派生路径', () => {
  it('config 与 config 备份位于 userDataPath 下', () => {
    expect(layout.config()).toBe('/home/tester/.tangyuan/config.json')
    expect(layout.configBackup()).toBe(
      '/home/tester/.tangyuan/config.backup.json',
    )
  })

  it('session index 与 sdk session 路径', () => {
    expect(layout.sessionIndex()).toBe(
      '/home/tester/.tangyuan/sessions/index.json',
    )
    expect(layout.sdkSessionDir()).toBe(
      '/home/tester/.tangyuan/sessions/pi-sdk',
    )
    expect(layout.sdkSessionFile('sess-1')).toBe(
      '/home/tester/.tangyuan/sessions/pi-sdk/sess-1.jsonl',
    )
  })
})

describe('DirectoryLayout · install records', () => {
  it('shared 记录位于共享 skills 下', () => {
    expect(layout.installRecords('shared')).toBe(
      '/home/tester/.tangyuan/skills/.tangyuan-records.json',
    )
  })

  it('agent 记录位于 agent 专属 skills 下', () => {
    expect(layout.installRecords('agent', 'foo')).toBe(
      '/home/tester/.tangyuan/agents/foo/skills/.tangyuan-records.json',
    )
  })

  it('agent 记录缺少 agentId 时抛错', () => {
    expect(() => layout.installRecords('agent')).toThrow(
      'Agent 专属 Skill 记录需要提供 agentId。',
    )
  })
})
