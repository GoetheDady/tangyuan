import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SessionLoadingHint } from './SessionLoadingHint'

describe('SessionLoadingHint', () => {
  it('渲染会话读取提示并声明 status 语义', () => {
    render(<SessionLoadingHint />)

    const hint = screen.getByRole('status')
    expect(hint).toHaveAttribute('aria-label', '正在打开会话')
    expect(hint).toHaveClass('animate-session-hint-in')
    expect(screen.getByText('正在打开会话…')).toBeInTheDocument()
  })
})
