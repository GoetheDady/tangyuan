import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { CircleAlert, Info } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

describe('Alert', () => {
  it('preserves the default composition, role and Level 0 contract', () => {
    render(
      <Alert>
        <Info aria-hidden="true" />
        <AlertTitle>配置提示</AlertTitle>
        <AlertDescription>请选择模型并配置 Provider 凭据。</AlertDescription>
      </Alert>
    )

    const alert = screen.getByRole('alert')
    expect(alert).toHaveAttribute('data-slot', 'alert')
    expect(alert).toHaveAttribute('data-variant', 'default')
    expect(alert).toHaveAttribute('data-level', '0')
    expect(alert.className).toContain('rounded-lg')
    expect(alert.className).toContain('border')
    expect(alert.className).toContain('shadow-level-0')

    expect(screen.getByText('配置提示')).toHaveAttribute('data-slot', 'alert-title')
    expect(screen.getByText('请选择模型并配置 Provider 凭据。')).toHaveAttribute(
      'data-slot',
      'alert-description'
    )
  })

  it.each([
    ['info', 'border-info-border', 'bg-info-soft', 'text-info-foreground'],
    ['success', 'border-success-border', 'bg-success-soft', 'text-success-foreground'],
    ['warning', 'border-warning-border', 'bg-warning-soft', 'text-warning-foreground'],
    [
      'destructive',
      'border-destructive-border',
      'bg-destructive-soft',
      'text-destructive-soft-foreground'
    ]
  ] as const)(
    'renders the %s semantic variant with shared status tokens',
    (variant, borderClass, backgroundClass, foregroundClass) => {
      render(
        <Alert variant={variant} aria-label={`${variant} feedback`}>
          <CircleAlert aria-hidden="true" />
          <AlertTitle>{variant}</AlertTitle>
          <AlertDescription>状态说明</AlertDescription>
        </Alert>
      )

      const alert = screen.getByRole('alert', { name: `${variant} feedback` })
      expect(alert).toHaveAttribute('data-variant', variant)
      expect(alert.className).toContain(borderClass)
      expect(alert.className).toContain(backgroundClass)
      expect(alert.className).toContain(foregroundClass)
      expect(alert.className).toContain('*:data-[slot=alert-description]:text-foreground')
    }
  )

  it('forwards native props, allows role overrides and merges className', () => {
    const onClick = vi.fn()

    render(
      <Alert
        role="status"
        id="settings-feedback"
        title="设置反馈"
        className="custom-alert"
        onClick={onClick}
      >
        已保存
      </Alert>
    )

    const alert = screen.getByRole('status')
    expect(alert).toHaveAttribute('id', 'settings-feedback')
    expect(alert).toHaveAttribute('title', '设置反馈')
    expect(alert.className).toContain('custom-alert')

    fireEvent.click(alert)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('keeps long copy, icon-free content and nested actions in the public composition seam', () => {
    render(
      <Alert variant="warning">
        <AlertTitle className="custom-title">
          这是一个需要自然换行而不是被截断的很长很长的警告标题
        </AlertTitle>
        <AlertDescription className="custom-description">
          <p>这是一段会跨越多行的说明内容，用于验证有限宽度下仍然保持可读。</p>
          <button type="button">查看详情</button>
        </AlertDescription>
      </Alert>
    )

    const title = screen.getByText(/这是一个需要自然换行/)
    expect(title.className).toContain('custom-title')
    expect(title.className).toContain('break-words')
    expect(title.className).not.toContain('line-clamp-1')

    const description = screen.getByText(/这是一段会跨越多行/).parentElement
    expect(description).toHaveAttribute('data-slot', 'alert-description')
    expect(description?.className).toContain('custom-description')
    expect(description?.className).toContain('break-words')
    expect(screen.getByRole('button', { name: '查看详情' })).toBeInTheDocument()
  })
})
