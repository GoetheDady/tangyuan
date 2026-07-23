import { describe, expect, it } from 'vitest'

import { cn } from './utils'

describe('cn', () => {
  it('把语义字号 token 当字号处理，不删除同元素的颜色类', () => {
    // 模拟 Button：base 字号 + variant 颜色 + 调用点语义字号
    const result = cn('text-sm text-primary-foreground', 'text-caption font-semibold')
    expect(result).toContain('text-primary-foreground')
    expect(result).toContain('text-caption')
    expect(result).not.toContain('text-sm')
  })

  it('语义字号 token 与颜色类可共存', () => {
    const result = cn('text-muted-foreground', 'text-body')
    expect(result).toContain('text-muted-foreground')
    expect(result).toContain('text-body')
  })

  it('两个语义字号 token 冲突时取后者', () => {
    expect(cn('text-body', 'text-label')).toBe('text-label')
  })

  it('语义字号 token 覆盖原厂字号类', () => {
    expect(cn('text-sm', 'text-body')).toBe('text-body')
  })
})
