import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Slider } from '@/components/ui/slider'

describe('Slider', () => {
  it('renders slider with aria attributes forwarded to the thumb', () => {
    render(
      <Slider
        aria-label="思考强度"
        aria-valuetext="中"
        min={0}
        max={2}
        step={1}
        value={[1]}
      />,
    )

    const slider = screen.getByRole('slider', { name: '思考强度' })
    expect(slider).toHaveAttribute('aria-valuenow', '1')
    expect(slider).toHaveAttribute('aria-valuetext', '中')
  })

  it('reports value change when clicking the track', () => {
    const onValueChange = vi.fn()
    render(
      <Slider
        aria-label="思考强度"
        min={0}
        max={2}
        step={1}
        value={[0]}
        onValueChange={onValueChange}
      />,
    )

    // jsdom 布局全为 0，轨道宽度 mock 为 1024；clientX=512 映射到中间值
    const track = screen.getByTestId('slider-track')
    fireEvent.pointerDown(track, { clientX: 512, pointerId: 1 })
    fireEvent.pointerUp(track, { clientX: 512, pointerId: 1 })

    expect(onValueChange).toHaveBeenCalledWith([1])
  })

  it('marks the thumb disabled when disabled', () => {
    render(
      <Slider
        aria-label="思考强度"
        disabled
        min={0}
        max={2}
        step={1}
        value={[1]}
      />,
    )

    expect(screen.getByRole('slider', { name: '思考强度' })).toHaveAttribute(
      'data-disabled',
    )
  })

  it('uses pointer cursor to signal interactivity', () => {
    const { container } = render(
      <Slider
        aria-label="思考强度"
        min={0}
        max={2}
        step={1}
        value={[0]}
      />,
    )

    expect(container.querySelector('[data-slot="slider"]')).toHaveClass(
      'cursor-pointer',
    )
  })
})
