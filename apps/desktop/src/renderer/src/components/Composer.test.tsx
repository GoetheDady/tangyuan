import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Composer, type ComposerProps } from './Composer'

function createDefaultSessionModelInfo(overrides = {}) {
  return {
    providerId: 'anthropic',
    modelId: 'claude-sonnet-4-5',
    displayName: 'Claude Sonnet 4.5',
    thinkingLevel: null,
    supportedThinkingLevels: ['off', 'low', 'medium', 'high'],
    supportsThinking: true,
    ...overrides
  }
}

function createDefaultProviders() {
  return [
    { providerId: 'anthropic', displayName: 'Anthropic' },
    { providerId: 'openai', displayName: 'OpenAI' }
  ]
}

function createDefaultSelectableModels() {
  return [
    { providerId: 'anthropic', modelId: 'claude-sonnet-4-5', displayName: 'Claude Sonnet 4.5' },
    { providerId: 'anthropic', modelId: 'claude-opus-4-5', displayName: 'Claude Opus 4.5' }
  ]
}

function createDefaultProps(overrides: Partial<ComposerProps> = {}): ComposerProps {
  return {
    value: '',
    onChange: vi.fn(),
    onSubmit: vi.fn(),
    placeholder: '输入消息',
    isRunning: false,
    onCancel: vi.fn(),
    sessionModelInfo: createDefaultSessionModelInfo(),
    isLoadingModelInfo: false,
    isSwitchingModel: false,
    providers: createDefaultProviders(),
    selectableModels: createDefaultSelectableModels(),
    onModelChange: vi.fn(),
    onThinkingLevelChange: vi.fn(),
    ...overrides
  }
}

describe('Composer', () => {
  // ===========================================================================
  // 文本输入与键盘
  // ===========================================================================

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

  // ===========================================================================
  // IME 输入法保护
  // ===========================================================================

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

  // ===========================================================================
  // 自动增高
  // ===========================================================================

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

  // ===========================================================================
  // 发送/停止按钮状态
  // ===========================================================================

  it('shows "发送" button when not running', () => {
    render(<Composer {...createDefaultProps({ isRunning: false })} />)

    expect(screen.getByRole('button', { name: /发送/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /停止/ })).not.toBeInTheDocument()
  })

  it('shows "停止" button when running', () => {
    render(<Composer {...createDefaultProps({ isRunning: true })} />)

    expect(screen.getByRole('button', { name: /停止/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /发送/ })).not.toBeInTheDocument()
  })

  it('disables send button when text is empty', () => {
    render(<Composer {...createDefaultProps({ value: '' })} />)

    expect(screen.getByRole('button', { name: /发送/ })).toBeDisabled()
  })

  it('enables send button when text is not empty', () => {
    render(<Composer {...createDefaultProps({ value: '你好' })} />)

    expect(screen.getByRole('button', { name: /发送/ })).toBeEnabled()
  })

  it('calls onCancel when stop button is clicked', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(<Composer {...createDefaultProps({ isRunning: true, onCancel, value: '草稿' })} />)

    const stopButton = screen.getByRole('button', { name: /停止/ })
    await user.click(stopButton)

    expect(onCancel).toHaveBeenCalled()
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

  // ===========================================================================
  // 运行状态：textarea 可编辑但不可发送
  // ===========================================================================

  it('keeps textarea enabled during running for draft editing', () => {
    render(<Composer {...createDefaultProps({ isRunning: true, value: '草稿内容' })} />)

    const textarea = screen.getByLabelText('消息')
    expect(textarea).not.toBeDisabled()
    expect(textarea).toHaveValue('草稿内容')
  })

  it('does not call onSubmit when Enter is pressed during running', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<Composer {...createDefaultProps({ isRunning: true, value: '你好', onSubmit })} />)

    const textarea = screen.getByLabelText('消息')
    await user.type(textarea, '{Enter}')

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('does not submit via form submit during running', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<Composer {...createDefaultProps({ isRunning: true, value: '你好', onSubmit })} />)

    const button = screen.getByRole('button', { name: /停止/ })
    await user.click(button)

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('preserves draft after stopping run', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <Composer {...createDefaultProps({ isRunning: true, value: '我的草稿', onChange })} />
    )

    const textarea = screen.getByLabelText('消息')
    expect(textarea).toHaveValue('我的草稿')

    // 模拟运行结束：isRunning 变为 false
    rerender(
      <Composer {...createDefaultProps({ isRunning: false, value: '我的草稿', onChange })} />
    )

    expect(textarea).toHaveValue('我的草稿')
    expect(screen.getByRole('button', { name: /发送/ })).toBeInTheDocument()
  })

  // ===========================================================================
  // 无会话状态：整体禁用
  // ===========================================================================

  it('disables textarea when disabled prop is true', () => {
    render(<Composer {...createDefaultProps({ disabled: true })} />)

    const textarea = screen.getByLabelText('消息')
    expect(textarea).toBeDisabled()
  })

  it('does not render model controls when no session model info', () => {
    render(<Composer {...createDefaultProps({ sessionModelInfo: null })} />)

    // 发送按钮仍然存在且可用（因为 disabled=false 且有文本）
    expect(screen.getByRole('button', { name: /发送/ })).toBeInTheDocument()
    // 模型选择器（combobox）不应该渲染
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('disables send button when disabled prop is true', () => {
    render(<Composer {...createDefaultProps({ disabled: true, value: '你好' })} />)

    const textarea = screen.getByLabelText('消息')
    expect(textarea).toBeDisabled()
    expect(screen.getByRole('button', { name: /发送/ })).toBeDisabled()
  })

  // ===========================================================================
  // 模型选择控件
  // ===========================================================================

  it('renders the Pencil model pill selector', () => {
    render(<Composer {...createDefaultProps()} />)

    const modelTrigger = screen.getByRole('combobox', { name: '模型' })
    expect(modelTrigger).toBeInTheDocument()
    expect(modelTrigger).toHaveTextContent('Claude Sonnet 4.5')
    expect(screen.queryByText('Anthropic')).not.toBeInTheDocument()
  })

  it('calls onModelChange when selecting a different model', async () => {
    const user = userEvent.setup()
    const onModelChange = vi.fn()
    render(<Composer {...createDefaultProps({ onModelChange })} />)

    const modelTrigger = screen.getByRole('combobox', { name: '模型' })
    await user.click(modelTrigger)

    // 选择另一个模型（SelectContent portal 到 body，查找 option）
    const opusOption = screen.getByRole('option', { name: 'Claude Opus 4.5' })
    await user.click(opusOption)

    expect(onModelChange).toHaveBeenCalledWith('anthropic', 'claude-opus-4-5')
  })

  it('disables model selectors when isSwitchingModel is true', () => {
    render(<Composer {...createDefaultProps({ isSwitchingModel: true })} />)

    const triggerButtons = screen.getAllByRole('combobox')
    for (const button of triggerButtons) {
      expect(button).toBeDisabled()
    }
  })

  it('disables model selectors during running', () => {
    render(<Composer {...createDefaultProps({ isRunning: true })} />)

    const triggerButtons = screen.getAllByRole('combobox')
    for (const button of triggerButtons) {
      expect(button).toBeDisabled()
    }
  })

  // ===========================================================================
  // 思考强度控件
  // ===========================================================================

  it('renders thinking level selector when model supports thinking', () => {
    render(
      <Composer
        {...createDefaultProps({
          sessionModelInfo: createDefaultSessionModelInfo({
            supportsThinking: true,
            supportedThinkingLevels: ['off', 'low', 'medium', 'high'],
            thinkingLevel: 'off'
          })
        })}
      />
    )

    expect(screen.getByRole('combobox', { name: '模型' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '思考强度' })).toBeInTheDocument()
    expect(screen.getAllByRole('combobox')).toHaveLength(2)
  })

  it('does not render thinking level selector when model does not support thinking', () => {
    render(
      <Composer
        {...createDefaultProps({
          sessionModelInfo: createDefaultSessionModelInfo({
            supportsThinking: false,
            supportedThinkingLevels: []
          })
        })}
      />
    )

    // Thinking 控件不应该渲染
    expect(screen.queryByText(/Thinking:/)).not.toBeInTheDocument()
  })

  it('does not render thinking level selector when supportedThinkingLevels is empty', () => {
    render(
      <Composer
        {...createDefaultProps({
          sessionModelInfo: createDefaultSessionModelInfo({
            supportsThinking: true,
            supportedThinkingLevels: []
          })
        })}
      />
    )

    // Thinking 控件不应该渲染（即使 supportsThinking 为 true 但没有 levels）
    expect(screen.queryByText(/Thinking:/)).not.toBeInTheDocument()
  })

  it('calls onThinkingLevelChange when selecting a different level', async () => {
    const user = userEvent.setup()
    const onThinkingLevelChange = vi.fn()
    render(
      <Composer
        {...createDefaultProps({
          sessionModelInfo: createDefaultSessionModelInfo({
            supportsThinking: true,
            supportedThinkingLevels: ['off', 'low', 'medium', 'high'],
            thinkingLevel: 'off'
          }),
          onThinkingLevelChange
        })}
      />
    )

    const thinkingTrigger = screen.getByRole('combobox', { name: '思考强度' })
    await user.click(thinkingTrigger)

    // 选择 high
    const highOption = screen.getByRole('option', { name: 'Thinking: high' })
    await user.click(highOption)

    expect(onThinkingLevelChange).toHaveBeenCalledWith('high')
  })

  // ===========================================================================
  // 附件占位
  // ===========================================================================

  it('renders disabled attachment placeholder button', () => {
    render(<Composer {...createDefaultProps()} />)

    const attachmentButton = screen.getByLabelText('附件功能暂未开放')
    expect(attachmentButton).toBeInTheDocument()
    expect(attachmentButton).toBeDisabled()
    expect(attachmentButton.tagName).toBe('BUTTON')
  })

  it('attachment button has type button to prevent form submission', () => {
    render(<Composer {...createDefaultProps()} />)

    const attachmentButton = screen.getByLabelText('附件功能暂未开放')
    expect(attachmentButton).toHaveAttribute('type', 'button')
  })

  // ===========================================================================
  // 加载状态
  // ===========================================================================

  it('shows loading text when model info is loading', () => {
    render(<Composer {...createDefaultProps({ isLoadingModelInfo: true })} />)

    expect(screen.getByText('加载中...')).toBeInTheDocument()
  })
})
