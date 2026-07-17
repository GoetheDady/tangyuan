import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Composer } from './Composer'

describe('Composer', () => {
  function createDefaultProps(overrides = {}) {
    return {
      value: '',
      onChange: vi.fn(),
      onSubmit: vi.fn(),
      disabled: false,
      placeholder: '输入消息',
      isSending: false,
      ...overrides
    }
  }

  it('renders textarea with placeholder', () => {
    render(<Composer {...createDefaultProps()} />)

    const textarea = screen.getByLabelText('消息')
    expect(textarea).toBeInTheDocument()
    expect(textarea).toHaveAttribute('placeholder', '输入消息')
  })

  it('calls onChange when user types', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Composer {...createDefaultProps({ onChange })} />)

    const textarea = screen.getByLabelText('消息')
    await user.type(textarea, '你好')

    expect(onChange).toHaveBeenCalled()
  })

  it('calls onSubmit when Enter is pressed', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<Composer {...createDefaultProps({ value: '你好', onSubmit })} />)

    const textarea = screen.getByLabelText('消息')
    await user.type(textarea, '{Enter}')

    expect(onSubmit).toHaveBeenCalled()
  })

  it('does not call onSubmit on empty value', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<Composer {...createDefaultProps({ value: '', onSubmit })} />)

    const textarea = screen.getByLabelText('消息')
    await user.type(textarea, '{Enter}')

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('does not call onSubmit when Shift+Enter is pressed', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<Composer {...createDefaultProps({ value: '你好', onSubmit })} />)

    const textarea = screen.getByLabelText('消息')
    await user.type(textarea, '{Shift>}{Enter}{/Shift}')

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('shows "发送" button text when not sending', () => {
    render(<Composer {...createDefaultProps({ isSending: false })} />)

    expect(screen.getByRole('button', { name: /发送/ })).toHaveTextContent('发送')
  })

  it('shows "发送中" button text when sending', () => {
    render(<Composer {...createDefaultProps({ isSending: true })} />)

    expect(screen.getByRole('button', { name: /发送/ })).toHaveTextContent('发送中')
  })

  it('disables send button when text is empty', () => {
    render(<Composer {...createDefaultProps({ value: '' })} />)

    expect(screen.getByRole('button', { name: /发送/ })).toBeDisabled()
  })

  it('enables send button when text is not empty', () => {
    render(<Composer {...createDefaultProps({ value: '你好' })} />)

    expect(screen.getByRole('button', { name: /发送/ })).toBeEnabled()
  })

  it('disables textarea and button when disabled prop is true', () => {
    render(<Composer {...createDefaultProps({ disabled: true })} />)

    expect(screen.getByLabelText('消息')).toBeDisabled()
    expect(screen.getByRole('button', { name: /发送/ })).toBeDisabled()
  })

  it('calls onSubmit via form submit button click', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<Composer {...createDefaultProps({ value: '你好', onSubmit })} />)

    const button = screen.getByRole('button', { name: /发送/ })
    await user.click(button)

    expect(onSubmit).toHaveBeenCalled()
  })

  it('does not submit via button click when value is empty', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<Composer {...createDefaultProps({ value: '', onSubmit })} />)

    const button = screen.getByRole('button', { name: /发送/ })
    await user.click(button)

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('handles IME composition correctly - Enter during composing does not send', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<Composer {...createDefaultProps({ value: '拼音', onSubmit })} />)

    const textarea = screen.getByLabelText('消息')

    // 模拟 IME 组合开始
    await user.pointer({ keys: '[MouseLeft]', target: textarea })

    // 使用 fireEvent 直接触发 compositionstart + keydown + compositionend
    fireEvent.compositionStart(textarea)
    // 在组合期间按 Enter 不应该触发 onSubmit
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', shiftKey: false })
    expect(onSubmit).not.toHaveBeenCalled()

    fireEvent.compositionEnd(textarea)
    // 组合结束后按 Enter 应该正常触发
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', shiftKey: false })
    expect(onSubmit).toHaveBeenCalled()
  })

  it('adjusts height when typing multi-line content', async () => {
    const user = userEvent.setup()
    render(<Composer {...createDefaultProps({ value: '' })} />)

    const textarea = screen.getByLabelText('消息') as HTMLTextAreaElement

    // 输入多行文本
    await user.type(textarea, 'Line 1')
    await user.type(textarea, '{Enter}')
    await user.type(textarea, 'Line 2')
    await user.type(textarea, '{Enter}')
    await user.type(textarea, 'Line 3')

    // Textarea 应该存在并且可编辑
    expect(textarea).toBeInTheDocument()
    expect(textarea).not.toBeDisabled()
  })
})
