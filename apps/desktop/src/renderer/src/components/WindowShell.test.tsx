import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { WindowShell } from './WindowShell'

describe('WindowShell', () => {
  it('渲染顶部窗口拖拽区', () => {
    render(
      <WindowShell>
        <div>内容</div>
      </WindowShell>
    )

    const dragRegion = screen.getByTestId('window-drag-region')
    expect(dragRegion).toBeInTheDocument()
    expect(dragRegion).toHaveClass('window-drag-region')
  })

  it('拖拽区标记为装饰性，不进入无障碍树', () => {
    render(
      <WindowShell>
        <div>内容</div>
      </WindowShell>
    )

    expect(screen.getByTestId('window-drag-region')).toHaveAttribute('aria-hidden', 'true')
  })

  it('在拖拽区下方渲染子内容', () => {
    render(
      <WindowShell>
        <div data-testid="page">页面内容</div>
      </WindowShell>
    )

    expect(screen.getByTestId('page')).toHaveTextContent('页面内容')
  })
})
