import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import type * as React from 'react'
import { createRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const contentPropsSpy = vi.hoisted(() => vi.fn())

vi.mock('@radix-ui/react-tooltip', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@radix-ui/react-tooltip')>()
  const ReactModule = await import('react')
  const Content = ReactModule.forwardRef<
    React.ComponentRef<typeof actual.Content>,
    React.ComponentPropsWithoutRef<typeof actual.Content>
  >((props, ref) => {
    contentPropsSpy(props)
    return ReactModule.createElement(actual.Content, { ...props, ref })
  })
  Content.displayName = actual.Content.displayName

  return { ...actual, Content }
})

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

function renderOpenTooltip({
  side,
  sideOffset,
  className
}: {
  side?: 'top' | 'right' | 'bottom' | 'left'
  sideOffset?: number
  className?: string
} = {}) {
  const triggerRef = createRef<HTMLButtonElement>()
  const contentRef = createRef<HTMLDivElement>()
  const result = render(
    <TooltipProvider delayDuration={0}>
      <Tooltip open>
        <TooltipTrigger ref={triggerRef} asChild>
          <button type="button" aria-label="查看配置说明">
            ?
          </button>
        </TooltipTrigger>
        <TooltipContent
          ref={contentRef}
          data-testid="tooltip-content"
          side={side}
          sideOffset={sideOffset}
          avoidCollisions={false}
          className={className}
        >
          当前 Agent 使用默认模型。
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )

  return { ...result, triggerRef, contentRef }
}

describe('Tooltip', () => {
  beforeEach(() => {
    contentPropsSpy.mockClear()
  })

  it('preserves the public composition API, Portal behavior, props, className and refs', () => {
    const { container, triggerRef, contentRef } = renderOpenTooltip({
      sideOffset: 12,
      className: 'custom-tooltip'
    })

    const trigger = screen.getByRole('button', { name: '查看配置说明' })
    const content = screen.getByTestId('tooltip-content')

    expect(TooltipProvider).toBeDefined()
    expect(Tooltip).toBeDefined()
    expect(TooltipTrigger).toBeDefined()
    expect(TooltipContent).toBeDefined()
    expect(triggerRef.current).toBe(trigger)
    expect(contentRef.current).toBe(content)
    expect(trigger).toHaveAccessibleName('查看配置说明')
    expect(container).not.toContainElement(content)
    expect(document.body).toContainElement(content)
    expect(screen.getByRole('tooltip')).toHaveTextContent('当前 Agent 使用默认模型。')
    expect(content).toHaveAttribute('data-slot', 'tooltip-content')
    expect(content.className).toContain('custom-tooltip')
  })

  it('uses the unified Level 2 appearance, top preference and 10px arrow', () => {
    renderOpenTooltip()

    const content = screen.getByTestId('tooltip-content')
    expect(content).toHaveAttribute('data-level', '2')
    expect(content).toHaveAttribute('data-side', 'top')
    expect(contentPropsSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ side: 'top', sideOffset: 0 })
    )

    for (const className of [
      'rounded-[6px]',
      'bg-primary',
      'px-3',
      'py-1.5',
      'text-xs',
      'text-primary-foreground',
      'shadow-level-2'
    ]) {
      expect(content.className).toContain(className)
    }

    const arrow = content.querySelector('[data-slot="tooltip-arrow"]')
    expect(arrow).toBeInTheDocument()
    expect(arrow).toHaveAttribute('width', '10')
    expect(arrow).toHaveAttribute('height', '5')
    expect(arrow?.getAttribute('class')).toContain('fill-primary')
  })

  it('preserves Content asChild composition without injecting an extra sibling', () => {
    const contentRef = createRef<HTMLDivElement>()

    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip open>
          <TooltipTrigger>查看说明</TooltipTrigger>
          <TooltipContent ref={contentRef} asChild>
            <div data-testid="custom-tooltip-content">自定义 Tooltip 内容</div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )

    const content = contentRef.current!
    expect(content).toBeInstanceOf(HTMLDivElement)
    expect(content).toHaveAttribute('data-slot', 'tooltip-content')
    expect(screen.getByRole('tooltip')).toHaveTextContent('自定义 Tooltip 内容')
    expect(content.querySelector('[data-slot="tooltip-arrow"]')).not.toBeInTheDocument()
  })

  it('allows callers to override side and sideOffset without replacing the trigger name', () => {
    renderOpenTooltip({ side: 'right', sideOffset: 16 })

    expect(screen.getByTestId('tooltip-content')).toHaveAttribute('data-side', 'right')
    expect(contentPropsSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ avoidCollisions: false, side: 'right', sideOffset: 16 })
    )
    expect(screen.getByRole('button', { name: '查看配置说明' })).toHaveAccessibleName(
      '查看配置说明'
    )
  })
})
