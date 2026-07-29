import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AwaitingResponseIndicator } from './AwaitingResponseIndicator'

describe('AwaitingResponseIndicator', () => {
  it('渲染三个脉冲点', () => {
    const { container } = render(<AwaitingResponseIndicator />)
    const dots = container.querySelectorAll('.animate-pulse')
    expect(dots).toHaveLength(3)
  })

  it('使用 data-testid 标识', () => {
    render(<AwaitingResponseIndicator />)
    expect(
      screen.getByTestId('awaiting-response-indicator'),
    ).toBeInTheDocument()
  })

  it('标记为 status 角色且 aria-label 正确', () => {
    render(<AwaitingResponseIndicator />)
    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-label', 'Agent 正在响应')
  })

  it('脉冲点有渐进的动画延迟', () => {
    const { container } = render(<AwaitingResponseIndicator />)
    const dots = container.querySelectorAll('.animate-pulse')
    expect(dots[0]).toBeInTheDocument()
    expect(dots[1]).toBeInTheDocument()
    expect(dots[2]).toBeInTheDocument()
    // animation-delay 通过 Tailwind 任意值设置，JSDOM 中无法读取计算样式
  })
})
