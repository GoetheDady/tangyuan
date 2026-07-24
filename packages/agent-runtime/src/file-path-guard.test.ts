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
    ['/home/agents/tangyuan/soul.md', 'soul.md'],
    ['/home/agents/tangyuan/soul.history/1.md', 'soul.history'],
    ['/home/agents/tangyuan/skills/demo/SKILL.md', 'skills'],
    ['/home/config.json', 'config.json'],
    ['/home/config.backups/2024.json', 'config.backups'],
  ])('拦截受保护路径 %s', (path) => {
    const result = validateFilePath({ agentId: 'tangyuan', path, operation: 'write' })
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('不允许')
  })

  it('profile 目录仅在命中 user.md/user.history 时拦截', () => {
    expect(
      validateFilePath({
        agentId: 'tangyuan',
        path: '/home/profile/user.md',
        operation: 'edit',
      }).allowed,
    ).toBe(false)
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
