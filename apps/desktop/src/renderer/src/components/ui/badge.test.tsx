import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Badge, badgeVariants } from '@/components/ui/badge'

describe('Badge', () => {
  it('renders a div with the default variant contract', () => {
    render(<Badge>默认</Badge>)

    const badge = screen.getByText('默认')
    expect(badge.tagName).toBe('DIV')
    expect(badge).toHaveAttribute('data-slot', 'badge')
    expect(badge).toHaveAttribute('data-variant', 'default')
  })

  it.each(['default', 'secondary', 'success', 'destructive', 'outline'] as const)(
    'renders variant %s without changing the public element contract',
    (variant) => {
      render(<Badge variant={variant}>{variant}</Badge>)

      expect(screen.getByText(variant)).toHaveAttribute('data-variant', variant)
    }
  )

  it('merges className and forwards native div props', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()

    render(
      <Badge className="custom-badge" id="status-badge" title="状态" onClick={onClick}>
        可用
      </Badge>
    )

    const badge = screen.getByText('可用')
    expect(badge).toHaveAttribute('id', 'status-badge')
    expect(badge).toHaveAttribute('title', '状态')
    expect(badge.className).toContain('custom-badge')
    expect(badge.className).toContain('inline-flex')

    await user.click(badge)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('composes onto a child element when asChild is true', () => {
    render(
      <Badge asChild variant="success" className="linked-badge">
        <a href="/status">已配置</a>
      </Badge>
    )

    const link = screen.getByRole('link', { name: '已配置' })
    expect(link).toHaveAttribute('href', '/status')
    expect(link).toHaveAttribute('data-slot', 'badge')
    expect(link).toHaveAttribute('data-variant', 'success')
    expect(link.className).toContain('linked-badge')
  })

  it('preserves badgeVariants for external semantic composition', () => {
    expect(badgeVariants).toBeInstanceOf(Function)
    expect(badgeVariants({ variant: 'success' })).toContain('bg-success-soft')
    expect(badgeVariants({ variant: 'outline' })).toContain('border-border')
  })
})
