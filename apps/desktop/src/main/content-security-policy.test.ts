import { describe, expect, it } from 'vitest'
import { buildContentSecurityPolicy } from './content-security-policy'

describe('buildContentSecurityPolicy', () => {
  it('开发模式允许 Vite React Refresh 内联脚本和热更新连接', () => {
    const policy = buildContentSecurityPolicy('http://localhost:5173')

    expect(policy).toContain("script-src 'self' 'unsafe-inline'")
    expect(policy).toContain("connect-src 'self' http://localhost:5173 ws://localhost:*")
  })

  it('生产模式继续禁止内联脚本和开发服务器连接', () => {
    const policy = buildContentSecurityPolicy()

    expect(policy).toContain("script-src 'self';")
    expect(policy).not.toContain("script-src 'self' 'unsafe-inline'")
    expect(policy).toContain("connect-src 'self';")
    expect(policy).not.toContain('ws://localhost:*')
  })
})
