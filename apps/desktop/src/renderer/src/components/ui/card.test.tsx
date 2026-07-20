import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@/components/ui/card'

describe('Card', () => {
  it('preserves the complete composition API, native props, className and refs', () => {
    const cardRef = createRef<HTMLDivElement>()
    const headerRef = createRef<HTMLDivElement>()
    const titleRef = createRef<HTMLDivElement>()
    const descriptionRef = createRef<HTMLDivElement>()
    const contentRef = createRef<HTMLDivElement>()
    const footerRef = createRef<HTMLDivElement>()

    render(
      <Card ref={cardRef} id="agent-card" className="custom-card" aria-label="Agent 配置">
        <CardHeader ref={headerRef} className="custom-header">
          <CardTitle ref={titleRef} className="custom-title">
            Agent 配置
          </CardTitle>
          <CardDescription ref={descriptionRef} className="custom-description">
            管理当前 Agent 的模型与运行参数。
          </CardDescription>
        </CardHeader>
        <CardContent ref={contentRef} className="custom-content">
          Claude Sonnet 4
        </CardContent>
        <CardFooter ref={footerRef} className="custom-footer">
          保存
        </CardFooter>
      </Card>
    )

    const card = screen.getByLabelText('Agent 配置')
    expect(card.tagName).toBe('DIV')
    expect(card).toHaveAttribute('id', 'agent-card')
    expect(card).toHaveAttribute('data-slot', 'card')
    expect(card.className).toContain('custom-card')

    const slots = [
      [headerRef, 'card-header', 'custom-header'],
      [titleRef, 'card-title', 'custom-title'],
      [descriptionRef, 'card-description', 'custom-description'],
      [contentRef, 'card-content', 'custom-content'],
      [footerRef, 'card-footer', 'custom-footer']
    ] as const

    expect(cardRef.current).toBe(card)
    for (const [ref, slot, className] of slots) {
      expect(ref.current).toBeInstanceOf(HTMLDivElement)
      expect(ref.current).toHaveAttribute('data-slot', slot)
      expect(ref.current?.className).toContain(className)
    }
  })

  it('uses an 8px Level 0 container with 20px default and 16px compact padding', () => {
    const { rerender } = render(
      <Card aria-label="默认 Card">
        <CardHeader>Header</CardHeader>
        <CardContent>Content</CardContent>
        <CardFooter>Footer</CardFooter>
      </Card>
    )

    let card = screen.getByLabelText('默认 Card')
    expect(card).toHaveAttribute('data-size', 'default')
    expect(card.className).toContain('rounded-lg')
    expect(card.className).toContain('shadow-level-0')
    expect(card.classList.contains('shadow')).toBe(false)
    expect(card.className).toContain('[--card-padding:1.25rem]')

    for (const slot of ['card-header', 'card-content', 'card-footer']) {
      expect(card.querySelector(`[data-slot="${slot}"]`)?.className).toContain(
        'p-[var(--card-padding)]'
      )
    }

    rerender(
      <Card size="compact" aria-label="紧凑 Card">
        <CardContent>Content</CardContent>
      </Card>
    )

    card = screen.getByLabelText('紧凑 Card')
    expect(card).toHaveAttribute('data-size', 'compact')
    expect(card.className).toContain('[--card-padding:1rem]')
  })

  it('gates whole-card interaction states behind an accessible interactive element', () => {
    const interactiveRef = createRef<HTMLButtonElement>()

    render(
      <>
        <Card aria-label="静态 Card">静态内容</Card>
        <Card ref={interactiveRef} interactive aria-pressed="true" disabled>
          可操作 Card
        </Card>
      </>
    )

    const staticCard = screen.getByLabelText('静态 Card')
    expect(staticCard).toHaveAttribute('data-interactive', 'false')
    expect(staticCard.className).not.toContain('hover:border-input-hover')
    expect(staticCard.className).not.toContain('focus-visible:ring-[3px]')
    expect(staticCard.className).not.toContain('active:bg-secondary')

    const interactiveCard = screen.getByRole('button', { name: '可操作 Card' })
    expect(interactiveCard).toHaveAttribute('data-slot', 'card')
    expect(interactiveCard).toHaveAttribute('type', 'button')
    expect(interactiveRef.current).toBe(interactiveCard)
    expect(interactiveCard).toHaveAttribute('data-interactive', 'true')
    expect(interactiveCard).toHaveAttribute('aria-pressed', 'true')
    expect(interactiveCard).toBeDisabled()

    for (const className of [
      'hover:border-input-hover',
      'focus-visible:border-ring',
      'focus-visible:ring-[3px]',
      'active:bg-secondary',
      'aria-pressed:border-primary',
      'aria-selected:border-primary',
      'disabled:opacity-[var(--disabled-opacity)]',
      'aria-disabled:opacity-[var(--disabled-opacity)]'
    ]) {
      expect(interactiveCard.className).toContain(className)
    }
  })
})
