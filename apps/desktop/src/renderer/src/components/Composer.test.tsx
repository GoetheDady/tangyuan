import '@testing-library/jest-dom/vitest'
import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Composer, type ComposerProps } from './Composer'

/**
 * Composer 依赖 TooltipProvider（生产环境由 App 根节点提供），
 * 单测直接渲染组件时需自行补上。
 */
function renderWithTooltip(ui: Parameters<typeof render>[0]) {
  return render(ui, {
    wrapper: ({ children }) => <TooltipProvider>{children}</TooltipProvider>,
  })
}

function createDefaultSessionModelInfo(overrides = {}) {
  return {
    providerId: 'anthropic',
    modelId: 'claude-sonnet-4-5',
    displayName: 'Claude Sonnet 4.5',
    thinkingLevel: null,
    supportedThinkingLevels: ['off', 'low', 'medium', 'high'],
    supportsThinking: true,
    ...overrides,
  }
}

function createDefaultProviders() {
  return [
    { providerId: 'anthropic', displayName: 'Anthropic' },
    { providerId: 'openai', displayName: 'OpenAI' },
  ]
}

function createDefaultSelectableModels() {
  return [
    {
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      displayName: 'Claude Sonnet 4.5',
    },
    {
      providerId: 'anthropic',
      modelId: 'claude-opus-4-5',
      displayName: 'Claude Opus 4.5',
    },
  ]
}

function createDefaultProps(
  overrides: Partial<ComposerProps> = {},
): ComposerProps {
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
    ...overrides,
  }
}

describe('Composer', () => {
  // ===========================================================================
  // 文本输入与键盘
  // ===========================================================================

  it('renders textarea with placeholder', () => {
    renderWithTooltip(<Composer {...createDefaultProps()} />)

    const textarea = screen.getByLabelText('消息')
    expect(textarea).toBeInTheDocument()
    expect(textarea).toHaveAttribute('placeholder', '输入消息')
  })

  it('calls onChange when user types', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderWithTooltip(<Composer {...createDefaultProps({ onChange })} />)

    const textarea = screen.getByLabelText('消息')
    await user.type(textarea, '你好')

    expect(onChange).toHaveBeenCalled()
  })

  it('calls onSubmit when Enter is pressed', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    renderWithTooltip(
      <Composer {...createDefaultProps({ value: '你好', onSubmit })} />,
    )

    const textarea = screen.getByLabelText('消息')
    await user.type(textarea, '{Enter}')

    expect(onSubmit).toHaveBeenCalled()
  })

  it('does not call onSubmit on empty value', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    renderWithTooltip(
      <Composer {...createDefaultProps({ value: '', onSubmit })} />,
    )

    const textarea = screen.getByLabelText('消息')
    await user.type(textarea, '{Enter}')

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('does not call onSubmit when Shift+Enter is pressed', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    renderWithTooltip(
      <Composer {...createDefaultProps({ value: '你好', onSubmit })} />,
    )

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
    renderWithTooltip(
      <Composer {...createDefaultProps({ value: '拼音', onSubmit })} />,
    )

    const textarea = screen.getByLabelText('消息')

    // 模拟 IME 组合开始
    await user.pointer({ keys: '[MouseLeft]', target: textarea })

    // 使用 fireEvent 直接触发 compositionstart + keydown + compositionend
    fireEvent.compositionStart(textarea)
    // 在组合期间按 Enter 不应该触发 onSubmit
    fireEvent.keyDown(textarea, {
      key: 'Enter',
      code: 'Enter',
      shiftKey: false,
    })
    expect(onSubmit).not.toHaveBeenCalled()

    fireEvent.compositionEnd(textarea)
    // 组合结束后按 Enter 应该正常触发
    fireEvent.keyDown(textarea, {
      key: 'Enter',
      code: 'Enter',
      shiftKey: false,
    })
    expect(onSubmit).toHaveBeenCalled()
  })

  // ===========================================================================
  // 自动增高
  // ===========================================================================

  it('adjusts height when typing multi-line content', async () => {
    const user = userEvent.setup()
    renderWithTooltip(<Composer {...createDefaultProps({ value: '' })} />)

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
    renderWithTooltip(
      <Composer {...createDefaultProps({ isRunning: false })} />,
    )

    expect(screen.getByRole('button', { name: /发送/ })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /停止/ }),
    ).not.toBeInTheDocument()
  })

  it('shows "停止" button when running', () => {
    renderWithTooltip(<Composer {...createDefaultProps({ isRunning: true })} />)

    expect(screen.getByRole('button', { name: /停止/ })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /发送/ }),
    ).not.toBeInTheDocument()
  })

  it('disables send button when text is empty', () => {
    renderWithTooltip(<Composer {...createDefaultProps({ value: '' })} />)

    expect(screen.getByRole('button', { name: /发送/ })).toBeDisabled()
  })

  it('enables send button when text is not empty', () => {
    renderWithTooltip(<Composer {...createDefaultProps({ value: '你好' })} />)

    expect(screen.getByRole('button', { name: /发送/ })).toBeEnabled()
  })

  it('calls onCancel when stop button is clicked', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    renderWithTooltip(
      <Composer
        {...createDefaultProps({ isRunning: true, onCancel, value: '草稿' })}
      />,
    )

    const stopButton = screen.getByRole('button', { name: /停止/ })
    await user.click(stopButton)

    expect(onCancel).toHaveBeenCalled()
  })

  it('calls onSubmit via form submit button click', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    renderWithTooltip(
      <Composer {...createDefaultProps({ value: '你好', onSubmit })} />,
    )

    const button = screen.getByRole('button', { name: /发送/ })
    await user.click(button)

    expect(onSubmit).toHaveBeenCalled()
  })

  it('does not submit via button click when value is empty', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    renderWithTooltip(
      <Composer {...createDefaultProps({ value: '', onSubmit })} />,
    )

    const button = screen.getByRole('button', { name: /发送/ })
    await user.click(button)

    expect(onSubmit).not.toHaveBeenCalled()
  })

  // ===========================================================================
  // 运行状态：textarea 可编辑但不可发送
  // ===========================================================================

  it('keeps textarea enabled during running for draft editing', () => {
    renderWithTooltip(
      <Composer
        {...createDefaultProps({ isRunning: true, value: '草稿内容' })}
      />,
    )

    const textarea = screen.getByLabelText('消息')
    expect(textarea).not.toBeDisabled()
    expect(textarea).toHaveValue('草稿内容')
  })

  it('does not call onSubmit when Enter is pressed during running', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    renderWithTooltip(
      <Composer
        {...createDefaultProps({ isRunning: true, value: '你好', onSubmit })}
      />,
    )

    const textarea = screen.getByLabelText('消息')
    await user.type(textarea, '{Enter}')

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('does not submit via form submit during running', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    renderWithTooltip(
      <Composer
        {...createDefaultProps({ isRunning: true, value: '你好', onSubmit })}
      />,
    )

    const button = screen.getByRole('button', { name: /停止/ })
    await user.click(button)

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('preserves draft after stopping run', () => {
    const onChange = vi.fn()
    const { rerender } = renderWithTooltip(
      <Composer
        {...createDefaultProps({
          isRunning: true,
          value: '我的草稿',
          onChange,
        })}
      />,
    )

    const textarea = screen.getByLabelText('消息')
    expect(textarea).toHaveValue('我的草稿')

    // 模拟运行结束：isRunning 变为 false
    rerender(
      <Composer
        {...createDefaultProps({
          isRunning: false,
          value: '我的草稿',
          onChange,
        })}
      />,
    )

    expect(textarea).toHaveValue('我的草稿')
    expect(screen.getByRole('button', { name: /发送/ })).toBeInTheDocument()
  })

  // ===========================================================================
  // 无会话状态：整体禁用
  // ===========================================================================

  it('disables textarea when disabled prop is true', () => {
    renderWithTooltip(<Composer {...createDefaultProps({ disabled: true })} />)

    const textarea = screen.getByLabelText('消息')
    expect(textarea).toBeDisabled()
  })

  it('does not render model controls when no session model info', () => {
    renderWithTooltip(
      <Composer {...createDefaultProps({ sessionModelInfo: null })} />,
    )

    // 发送按钮仍然存在且可用（因为 disabled=false 且有文本）
    expect(screen.getByRole('button', { name: /发送/ })).toBeInTheDocument()
    // 模型选择器（combobox）不应该渲染
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('disables send button when disabled prop is true', () => {
    renderWithTooltip(
      <Composer {...createDefaultProps({ disabled: true, value: '你好' })} />,
    )

    const textarea = screen.getByLabelText('消息')
    expect(textarea).toBeDisabled()
    expect(screen.getByRole('button', { name: /发送/ })).toBeDisabled()
  })

  // ===========================================================================
  // 模型选择控件
  // ===========================================================================

  it('renders the Pencil model pill selector', () => {
    renderWithTooltip(<Composer {...createDefaultProps()} />)

    const modelTrigger = screen.getByRole('combobox', { name: '模型' })
    expect(modelTrigger).toBeInTheDocument()
    expect(modelTrigger).toHaveTextContent('Claude Sonnet 4.5')
    expect(screen.queryByText('Anthropic')).not.toBeInTheDocument()
  })

  it('calls onModelChange when selecting a different model', async () => {
    const user = userEvent.setup()
    const onModelChange = vi.fn()
    renderWithTooltip(<Composer {...createDefaultProps({ onModelChange })} />)

    const modelTrigger = screen.getByRole('combobox', { name: '模型' })
    await user.click(modelTrigger)

    // 选择另一个模型（SelectContent portal 到 body，查找 option）
    const opusOption = screen.getByRole('option', { name: 'Claude Opus 4.5' })
    await user.click(opusOption)

    expect(onModelChange).toHaveBeenCalledWith('anthropic', 'claude-opus-4-5')
  })

  it('disables model selectors when isSwitchingModel is true', () => {
    renderWithTooltip(
      <Composer {...createDefaultProps({ isSwitchingModel: true })} />,
    )

    const triggerButtons = screen.getAllByRole('combobox')
    for (const button of triggerButtons) {
      expect(button).toBeDisabled()
    }
  })

  it('disables model selectors during running', () => {
    renderWithTooltip(<Composer {...createDefaultProps({ isRunning: true })} />)

    const triggerButtons = screen.getAllByRole('combobox')
    for (const button of triggerButtons) {
      expect(button).toBeDisabled()
    }
  })

  // ===========================================================================
  // 思考强度控件
  // ===========================================================================

  it('renders thinking level slider when model supports thinking', () => {
    renderWithTooltip(
      <Composer
        {...createDefaultProps({
          sessionModelInfo: createDefaultSessionModelInfo({
            supportsThinking: true,
            supportedThinkingLevels: ['off', 'low', 'medium', 'high'],
            thinkingLevel: 'off',
          }),
        })}
      />,
    )

    expect(screen.getByRole('combobox', { name: '模型' })).toBeInTheDocument()
    const slider = screen.getByRole('slider', { name: '思考强度' })
    expect(slider).toBeInTheDocument()
    expect(slider).toHaveAttribute('aria-valuenow', '0')
    expect(slider).toHaveAttribute('aria-valuetext', '关')
    expect(screen.getAllByRole('combobox')).toHaveLength(1)
  })

  it('does not render thinking level slider when model does not support thinking', () => {
    renderWithTooltip(
      <Composer
        {...createDefaultProps({
          sessionModelInfo: createDefaultSessionModelInfo({
            supportsThinking: false,
            supportedThinkingLevels: [],
          }),
        })}
      />,
    )

    // 思考滑块不应该渲染
    expect(
      screen.queryByRole('slider', { name: '思考强度' }),
    ).not.toBeInTheDocument()
  })

  it('does not render thinking level slider when supportedThinkingLevels is empty', () => {
    renderWithTooltip(
      <Composer
        {...createDefaultProps({
          sessionModelInfo: createDefaultSessionModelInfo({
            supportsThinking: true,
            supportedThinkingLevels: [],
          }),
        })}
      />,
    )

    // 思考滑块不应该渲染（即使 supportsThinking 为 true 但没有 levels）
    expect(
      screen.queryByRole('slider', { name: '思考强度' }),
    ).not.toBeInTheDocument()
  })

  it('does not render thinking level slider when only one level is supported', () => {
    renderWithTooltip(
      <Composer
        {...createDefaultProps({
          sessionModelInfo: createDefaultSessionModelInfo({
            supportsThinking: true,
            supportedThinkingLevels: ['medium'],
            thinkingLevel: 'medium',
          }),
        })}
      />,
    )

    // 单档位无法调节，滑块不渲染
    expect(
      screen.queryByRole('slider', { name: '思考强度' }),
    ).not.toBeInTheDocument()
  })

  it('calls onThinkingLevelChange when adjusting the slider with keyboard', async () => {
    const user = userEvent.setup()
    const onThinkingLevelChange = vi.fn()
    // 模拟 ChatPage 的受控循环：滑块回调 → 父组件更新 thinkingLevel → 重渲染
    function ThinkingLevelHarness({
      onChange,
    }: {
      onChange: (level: string) => void
    }) {
      const [level, setLevel] = useState('off')
      return (
        <Composer
          {...createDefaultProps({
            sessionModelInfo: createDefaultSessionModelInfo({
              supportsThinking: true,
              supportedThinkingLevels: ['off', 'low', 'medium', 'high'],
              thinkingLevel: level,
            }),
            onThinkingLevelChange: (next) => {
              setLevel(next)
              onChange(next)
            },
          })}
        />
      )
    }

    renderWithTooltip(<ThinkingLevelHarness onChange={onThinkingLevelChange} />)

    const slider = screen.getByRole('slider', { name: '思考强度' })
    slider.focus()

    // 每按一次方向键实时切换一档：off → low → medium → high
    await user.keyboard('{ArrowRight}')
    expect(onThinkingLevelChange).toHaveBeenLastCalledWith('low')
    await user.keyboard('{ArrowRight}')
    expect(onThinkingLevelChange).toHaveBeenLastCalledWith('medium')
    await user.keyboard('{ArrowRight}')
    expect(onThinkingLevelChange).toHaveBeenLastCalledWith('high')
  })

  it('calls onThinkingLevelChange when clicking the slider track', async () => {
    const onThinkingLevelChange = vi.fn()
    renderWithTooltip(
      <Composer
        {...createDefaultProps({
          sessionModelInfo: createDefaultSessionModelInfo({
            supportsThinking: true,
            supportedThinkingLevels: ['off', 'low', 'medium', 'high'],
            thinkingLevel: 'off',
          }),
          onThinkingLevelChange,
        })}
      />,
    )

    // jsdom 布局全为 0，轨道宽度 mock 为 1024；clientX=512 映射到中间档位（medium）
    const track = screen.getByTestId('slider-track')
    fireEvent.pointerDown(track, { clientX: 512, pointerId: 1 })
    fireEvent.pointerUp(track, { clientX: 512, pointerId: 1 })

    expect(onThinkingLevelChange).toHaveBeenCalledWith('medium')
  })

  // ===========================================================================
  // 附件占位
  // ===========================================================================

  it('renders disabled attachment placeholder button', () => {
    renderWithTooltip(<Composer {...createDefaultProps()} />)

    const attachmentButton = screen.getByLabelText('附件功能暂未开放')
    expect(attachmentButton).toBeInTheDocument()
    expect(attachmentButton).toBeDisabled()
    expect(attachmentButton.tagName).toBe('BUTTON')
  })

  it('attachment button has type button to prevent form submission', () => {
    renderWithTooltip(<Composer {...createDefaultProps()} />)

    const attachmentButton = screen.getByLabelText('附件功能暂未开放')
    expect(attachmentButton).toHaveAttribute('type', 'button')
  })

  // ===========================================================================
  // 加载状态
  // ===========================================================================

  it('shows loading text when model info is loading', () => {
    renderWithTooltip(
      <Composer {...createDefaultProps({ isLoadingModelInfo: true })} />,
    )

    expect(screen.getByText('加载中...')).toBeInTheDocument()
  })
})
