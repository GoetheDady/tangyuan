import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Button, buttonVariants } from '@/components/ui/button'

describe('Button', () => {
  it('renders a button element by default', () => {
    render(<Button>点击</Button>)

    const button = screen.getByRole('button', { name: '点击' })
    expect(button).toBeInTheDocument()
    expect(button.tagName).toBe('BUTTON')
  })

  it('applies default variant and size data attributes', () => {
    render(<Button>默认</Button>)

    const button = screen.getByRole('button', { name: '默认' })
    expect(button).toHaveAttribute('data-slot', 'button')
    expect(button).toHaveAttribute('data-variant', 'default')
    expect(button).toHaveAttribute('data-size', 'default')
  })

  it('renders with explicit variant and size', () => {
    render(
      <Button variant="destructive" size="lg">
        危险
      </Button>
    )

    const button = screen.getByRole('button', { name: '危险' })
    expect(button).toHaveAttribute('data-variant', 'destructive')
    expect(button).toHaveAttribute('data-size', 'lg')
  })

  it.each(['default', 'secondary', 'outline', 'ghost', 'destructive', 'link'] as const)(
    'renders variant %s without error',
    (variant) => {
      render(<Button variant={variant}>{variant}</Button>)
      expect(screen.getByRole('button')).toHaveAttribute('data-variant', variant)
    }
  )

  it.each(['xs', 'sm', 'default', 'lg', 'icon', 'icon-xs', 'icon-sm', 'icon-lg'] as const)(
    'renders size %s without error',
    (size) => {
      render(<Button size={size}>{size}</Button>)
      expect(screen.getByRole('button')).toHaveAttribute('data-size', size)
    }
  )

  it('merges className with variant classes', () => {
    render(<Button className="custom-class">合并</Button>)

    const button = screen.getByRole('button', { name: '合并' })
    expect(button.className).toContain('custom-class')
    // 不断言完整的 Tailwind class 字符串，只验证合并行为
    expect(button.className).toContain('inline-flex')
  })

  it('forwards ref to the button element', () => {
    const ref = createRef<HTMLButtonElement>()
    render(<Button ref={ref}>Ref 按钮</Button>)

    expect(ref.current).toBeInstanceOf(HTMLButtonElement)
    expect(ref.current?.textContent).toBe('Ref 按钮')
  })

  it('renders as a child element when asChild is true', () => {
    render(
      <Button asChild>
        <a href="/test">链接按钮</a>
      </Button>
    )

    const link = screen.getByRole('link', { name: '链接按钮' })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', '/test')
    expect(link).toHaveAttribute('data-slot', 'button')
  })

  it('passes through native button props', () => {
    render(
      <Button type="submit" disabled aria-label="提交表单" name="submit-btn" value="1">
        提交
      </Button>
    )

    const button = screen.getByRole('button', { name: '提交表单' })
    expect(button).toHaveAttribute('type', 'submit')
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('name', 'submit-btn')
    expect(button).toHaveAttribute('value', '1')
  })

  it('handles click events', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<Button onClick={onClick}>点击我</Button>)

    await user.click(screen.getByRole('button', { name: '点击我' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does not fire click when disabled', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        不可点击
      </Button>
    )

    await user.click(screen.getByRole('button', { name: '不可点击' }))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('renders with aria-invalid when specified', () => {
    render(<Button aria-invalid="true">无效</Button>)

    const button = screen.getByRole('button', { name: '无效' })
    expect(button).toHaveAttribute('aria-invalid', 'true')
  })

  it('preserves buttonVariants export for external composition', () => {
    // buttonVariants 应保持为函数，供外部通过 cva 组合使用
    expect(buttonVariants).toBeInstanceOf(Function)
    const classes = buttonVariants({ variant: 'outline', size: 'sm' })
    expect(classes).toContain('border')
    expect(classes).toContain('h-8')
  })
})
