import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Search } from 'lucide-react'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea
} from '@/components/ui/input-group'

describe('InputGroup', () => {
  it('forwards root props and ref', () => {
    const ref = createRef<HTMLDivElement>()

    render(
      <InputGroup ref={ref} className="custom-group" data-testid="group">
        <InputGroupInput aria-label="搜索" />
      </InputGroup>
    )

    const group = screen.getByTestId('group')
    expect(group).toHaveAttribute('role', 'group')
    expect(group).toHaveAttribute('data-slot', 'input-group')
    expect(group.className).toContain('custom-group')
    expect(ref.current).toBe(group)
  })

  it('keeps native input props, ref, events, and invalid state', async () => {
    const user = userEvent.setup()
    const ref = createRef<HTMLInputElement>()
    const onChange = vi.fn()

    render(
      <InputGroup invalid>
        <InputGroupAddon>
          <Search aria-hidden="true" />
        </InputGroupAddon>
        <InputGroupInput
          ref={ref}
          name="query"
          placeholder="搜索 Agent"
          defaultValue="汤圆"
          onChange={onChange}
          aria-label="搜索 Agent"
        />
      </InputGroup>
    )

    const input = screen.getByRole('textbox', { name: '搜索 Agent' })
    expect(input).toHaveAttribute('data-slot', 'input-group-control')
    expect(input).toHaveAttribute('name', 'query')
    expect(input).toHaveAttribute('placeholder', '搜索 Agent')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveValue('汤圆')
    expect(ref.current).toBe(input)
    expect(document.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')

    await user.type(input, '助手')
    expect(onChange).toHaveBeenCalled()
    expect(input).toHaveValue('汤圆助手')
  })

  it('keeps native textarea props, ref, and events', async () => {
    const user = userEvent.setup()
    const ref = createRef<HTMLTextAreaElement>()
    const onChange = vi.fn()

    render(
      <InputGroup>
        <InputGroupTextarea
          ref={ref}
          rows={4}
          defaultValue="第一行"
          onChange={onChange}
          aria-label="消息"
        />
        <InputGroupAddon align="block-end">
          <InputGroupText>Claude Sonnet</InputGroupText>
        </InputGroupAddon>
      </InputGroup>
    )

    const textarea = screen.getByRole('textbox', { name: '消息' })
    expect(textarea.tagName).toBe('TEXTAREA')
    expect(textarea).toHaveAttribute('rows', '4')
    expect(textarea).toHaveValue('第一行')
    expect(ref.current).toBe(textarea)

    await user.type(textarea, '\n第二行')
    expect(onChange).toHaveBeenCalled()
    expect(textarea).toHaveValue('第一行\n第二行')
  })

  it('focuses either input control when a non-button addon is clicked', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <InputGroup>
        <InputGroupAddon data-testid="addon">https://</InputGroupAddon>
        <InputGroupInput aria-label="网址" />
      </InputGroup>
    )

    await user.click(screen.getByTestId('addon'))
    expect(screen.getByRole('textbox', { name: '网址' })).toHaveFocus()

    rerender(
      <InputGroup>
        <InputGroupTextarea aria-label="说明" />
        <InputGroupAddon data-testid="addon" align="block-end">
          辅助信息
        </InputGroupAddon>
      </InputGroup>
    )

    await user.click(screen.getByTestId('addon'))
    expect(screen.getByRole('textbox', { name: '说明' })).toHaveFocus()
  })

  it('keeps addon actions in Tab order without stealing input focus', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()

    render(
      <InputGroup>
        <InputGroupInput aria-label="API Key" />
        <InputGroupAddon align="inline-end">
          <InputGroupButton aria-label="显示 API Key" onClick={onAction}>
            显示
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    )

    await user.tab()
    expect(screen.getByRole('textbox', { name: 'API Key' })).toHaveFocus()
    await user.tab()
    const button = screen.getByRole('button', { name: '显示 API Key' })
    expect(button).toHaveFocus()

    await user.click(button)
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(button).toHaveFocus()
  })

  it('propagates disabled state to controls and actions', async () => {
    const user = userEvent.setup()

    render(
      <InputGroup disabled data-testid="group">
        <InputGroupAddon data-testid="addon">https://</InputGroupAddon>
        <InputGroupInput aria-label="禁用网址" />
        <InputGroupAddon align="inline-end">
          <InputGroupButton aria-label="禁用操作">操作</InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    )

    const group = screen.getByTestId('group')
    const input = screen.getByRole('textbox', { name: '禁用网址' })
    const button = screen.getByRole('button', { name: '禁用操作' })
    expect(group).toHaveAttribute('data-disabled', 'true')
    expect(group).toHaveAttribute('aria-disabled', 'true')
    expect(input).toBeDisabled()
    expect(button).toBeDisabled()

    await user.click(screen.getByTestId('addon'))
    expect(input).not.toHaveFocus()
  })
})
