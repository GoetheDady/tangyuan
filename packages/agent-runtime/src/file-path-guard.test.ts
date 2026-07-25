import { describe, expect, it } from 'vitest'
import { validateFilePath } from './file-path-guard'

describe('validateFilePath', () => {
  it('允许访问普通工作空间文件', () => {
    const result = validateFilePath({
      agentId: 'tangyuan',
      path: '/home/agents/tangyuan/workspace/notes.txt',
      operation: 'read',
    })
    expect(result).toEqual({ allowed: true })
  })

  it.each([
    ['/home/agents/tangyuan/soul.md', 'update_soul'],
    ['/home/agents/tangyuan/soul.history/1.md', 'update_soul'],
    ['/home/agents/other-agent/soul.md', 'update_soul'],
    ['/home/agents/other-agent/soul.history/backup.md', 'update_soul'],
  ])('拦截 Agent 灵魂路径 %s 并引导使用 update_soul', (path) => {
    const result = validateFilePath({ agentId: 'tangyuan', path, operation: 'write' })
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('update_soul')
  })

  it.each([
    ['/home/profile/user.md', 'update_user_profile'],
    ['/home/profile/user.history/1.md', 'update_user_profile'],
  ])('拦截用户画像路径 %s 并引导使用 update_user_profile', (path) => {
    const result = validateFilePath({ agentId: 'tangyuan', path, operation: 'write' })
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('update_user_profile')
  })

  it.each([
    ['/home/agents/tangyuan/skills/demo/SKILL.md'],
    ['/home/config.json'],
    ['/home/config.backups/2024.json'],
  ])('拦截其他受保护路径 %s', (path) => {
    const result = validateFilePath({ agentId: 'tangyuan', path, operation: 'write' })
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('不允许')
    expect(result.reason).toContain('专用工具')
  })

  it('profile 目录仅在命中 user.md/user.history 时拦截并引导使用 update_user_profile', () => {
    const userMd = validateFilePath({
      agentId: 'tangyuan',
      path: '/home/profile/user.md',
      operation: 'edit',
    })
    expect(userMd.allowed).toBe(false)
    expect(userMd.reason).toContain('update_user_profile')

    expect(
      validateFilePath({
        agentId: 'tangyuan',
        path: '/home/profile/other.txt',
        operation: 'edit',
      }).allowed,
    ).toBe(true)
  })

  it('拒绝原因按操作类型显示中文标签', () => {
    expect(
      validateFilePath({
        agentId: 'tangyuan',
        path: '/home/agents/tangyuan/soul.md',
        operation: 'read',
      }).reason,
    ).toContain('读取')
    expect(
      validateFilePath({
        agentId: 'tangyuan',
        path: '/home/agents/tangyuan/soul.md',
        operation: 'write',
      }).reason,
    ).toContain('写入')
    expect(
      validateFilePath({
        agentId: 'tangyuan',
        path: '/home/agents/tangyuan/soul.md',
        operation: 'edit',
      }).reason,
    ).toContain('编辑')
  })

  it('相对路径先解析再校验', () => {
    const result = validateFilePath({
      agentId: 'tangyuan',
      path: 'some/dir/../../skills/x.md',
      operation: 'read',
    })
    expect(result.allowed).toBe(false)
  })
})
