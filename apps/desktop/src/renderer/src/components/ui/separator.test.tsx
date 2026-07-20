import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'

import { Separator } from '@/components/ui/separator'

describe('Separator', () => {
  it('uses the global 1px border token and Level 0 while preserving props, className and refs', () => {
    const ref = createRef<HTMLDivElement>()

    render(
      <Separator
        ref={ref}
        id="settings-separator"
        data-testid="separator"
        title="设置分隔"
        className="custom-separator"
      />
    )

    const separator = screen.getByTestId('separator')
    expect(ref.current).toBe(separator)
    expect(separator).toHaveAttribute('id', 'settings-separator')
    expect(separator).toHaveAttribute('title', '设置分隔')
    expect(separator).toHaveAttribute('data-slot', 'separator')
    expect(separator).toHaveAttribute('data-level', '0')
    expect(separator).toHaveAttribute('data-orientation', 'horizontal')
    expect(separator.className).toContain('h-px')
    expect(separator.className).toContain('w-full')
    expect(separator.className).toContain('bg-border')
    expect(separator.className).toContain('shadow-level-0')
    expect(separator.className).toContain('custom-separator')
  })

  it('allows className to override the default dimensions in either orientation', () => {
    render(
      <>
        <Separator data-testid="custom-horizontal" className="h-2 w-1/2" />
        <Separator data-testid="custom-vertical" orientation="vertical" className="h-6 w-2" />
      </>
    )

    const horizontal = screen.getByTestId('custom-horizontal')
    expect(horizontal.className).toContain('h-2')
    expect(horizontal.className).toContain('w-1/2')
    expect(horizontal.className).not.toContain('h-px')
    expect(horizontal.className).not.toContain('w-full')

    const vertical = screen.getByTestId('custom-vertical')
    expect(vertical.className).toContain('h-6')
    expect(vertical.className).toContain('w-2')
    expect(vertical.className).not.toContain('h-full')
    expect(vertical.className).not.toContain('w-px')
  })

  it('preserves decorative defaults and explicit Radix separator semantics in both directions', () => {
    render(
      <>
        <Separator data-testid="decorative-horizontal" />
        <div className="h-8">
          <Separator data-testid="semantic-vertical" orientation="vertical" decorative={false} />
        </div>
      </>
    )

    const decorative = screen.getByTestId('decorative-horizontal')
    expect(decorative).toHaveAttribute('role', 'none')
    expect(decorative).not.toHaveAttribute('aria-orientation')

    const semantic = screen.getByRole('separator')
    expect(semantic).toBe(screen.getByTestId('semantic-vertical'))
    expect(semantic).toHaveAttribute('aria-orientation', 'vertical')
    expect(semantic).toHaveAttribute('data-orientation', 'vertical')
    expect(semantic.className).toContain('h-full')
    expect(semantic.className).toContain('w-px')
  })

  it('composes full-width, inset, vertical and labeled separators without extending its API', () => {
    render(
      <>
        <Separator data-testid="full-width" />
        <div data-testid="inset-wrapper" className="px-6">
          <Separator data-testid="inset" />
        </div>
        <div className="flex h-6 items-center">
          <span>刷新</span>
          <Separator data-testid="vertical" orientation="vertical" />
          <span>导出</span>
        </div>
        <div className="flex items-center gap-3">
          <span>高级设置</span>
          <Separator data-testid="section-label" />
        </div>
        <div className="flex items-center gap-3">
          <Separator data-testid="center-label-start" />
          <span>或者</span>
          <Separator data-testid="center-label-end" />
        </div>
      </>
    )

    expect(screen.getByTestId('full-width')).toHaveAttribute('data-orientation', 'horizontal')
    expect(screen.getByTestId('inset-wrapper')).toContainElement(screen.getByTestId('inset'))
    expect(screen.getByTestId('vertical')).toHaveAttribute('data-orientation', 'vertical')
    expect(screen.getByText('高级设置')).toBeInTheDocument()
    expect(screen.getByText('或者')).toBeInTheDocument()
    expect(screen.getByTestId('section-label')).toHaveAttribute('role', 'none')
    expect(screen.getByTestId('center-label-start')).toHaveAttribute('role', 'none')
    expect(screen.getByTestId('center-label-end')).toHaveAttribute('role', 'none')
  })
})
