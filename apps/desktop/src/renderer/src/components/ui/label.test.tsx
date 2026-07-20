import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

describe('Label', () => {
  it('renders a label associated with its control', async () => {
    const user = userEvent.setup()
    render(
      <div>
        <Label htmlFor="display-name">显示名称</Label>
        <Input id="display-name" />
      </div>
    )

    const label = screen.getByText('显示名称')
    const input = screen.getByRole('textbox', { name: '显示名称' })

    expect(label.tagName).toBe('LABEL')
    expect(label).toHaveAttribute('for', 'display-name')
    await user.click(label)
    expect(input).toHaveFocus()
  })

  it('forwards ref to the Radix label element', () => {
    const ref = createRef<HTMLLabelElement>()
    render(<Label ref={ref}>Ref 标签</Label>)

    expect(ref.current).toBeInstanceOf(HTMLLabelElement)
    expect(ref.current?.tagName).toBe('LABEL')
  })

  it('passes through events, className, data attributes, and Radix asChild', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <Label asChild className="custom-label" data-state="ready" onClick={onClick}>
        <span>组合标签</span>
      </Label>
    )

    const label = screen.getByText('组合标签')
    expect(label.tagName).toBe('SPAN')
    expect(label).toHaveAttribute('data-slot', 'label')
    expect(label).toHaveAttribute('data-state', 'ready')
    expect(label.className).toContain('custom-label')

    await user.click(label)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('keeps a disabled control accessible by its label', () => {
    render(
      <div>
        <Label htmlFor="disabled-control">禁用标签</Label>
        <Input id="disabled-control" disabled />
      </div>
    )

    expect(screen.getByRole('textbox', { name: '禁用标签' })).toBeDisabled()
  })
})
