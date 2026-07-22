import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { QuestionClarificationRequest } from '@tangyuan/contracts'
import { QuestionClarificationCard } from './QuestionClarificationCard'

function createClarification(
  overrides?: Partial<QuestionClarificationRequest>
): QuestionClarificationRequest {
  return {
    clarificationId: 'clarification-1',
    agentId: 'tangyuan',
    sessionId: 'session-1',
    runId: 'run-1',
    question: '你希望使用哪个数据库？',
    options: ['PostgreSQL', 'MySQL', 'SQLite'],
    allowCustomAnswer: true,
    status: 'pending',
    createdAt: '2026-07-22T00:00:00.000Z',
    ...overrides
  }
}

describe('QuestionClarificationCard', () => {
  it('renders question and options', () => {
    const clarification = createClarification()
    render(
      <QuestionClarificationCard
        clarification={clarification}
        onAnswer={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    expect(
      screen.getByText('你希望使用哪个数据库？')
    ).toBeInTheDocument()
    expect(screen.getByText('PostgreSQL')).toBeInTheDocument()
    expect(screen.getByText('MySQL')).toBeInTheDocument()
    expect(screen.getByText('SQLite')).toBeInTheDocument()
  })

  it('shows "待回答" badge in pending state', () => {
    const clarification = createClarification()
    render(
      <QuestionClarificationCard
        clarification={clarification}
        onAnswer={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByText('待回答')).toBeInTheDocument()
    expect(screen.getByText('Agent 需要更多信息')).toBeInTheDocument()
  })

  it('renders preset options as buttons', () => {
    const clarification = createClarification()
    render(
      <QuestionClarificationCard
        clarification={clarification}
        onAnswer={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    expect(
      screen.getByRole('radio', { name: '选择：PostgreSQL' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('radio', { name: '选择：MySQL' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('radio', { name: '选择：SQLite' })
    ).toBeInTheDocument()
  })

  it('calls onAnswer with preset option when clicked', async () => {
    const user = userEvent.setup()
    const onAnswer = vi.fn().mockResolvedValue(undefined)
    const clarification = createClarification()

    render(
      <QuestionClarificationCard
        clarification={clarification}
        onAnswer={onAnswer}
        onCancel={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('待回答')).toBeInTheDocument()
    })

    const option = screen.getByRole('radio', { name: '选择：PostgreSQL' })
    await user.click(option)

    await waitFor(() => {
      expect(onAnswer).toHaveBeenCalledWith('clarification-1', 'PostgreSQL')
    })
  })

  it('shows custom input when "其他" is clicked', async () => {
    const user = userEvent.setup()
    const clarification = createClarification({ allowCustomAnswer: true })

    render(
      <QuestionClarificationCard
        clarification={clarification}
        onAnswer={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('待回答')).toBeInTheDocument()
    })

    const customButton = screen.getByLabelText('输入自定义答案')
    await user.click(customButton)

    expect(
      screen.getByPlaceholderText('输入你的答案...')
    ).toBeInTheDocument()
  })

  it('submits custom answer when typed and submitted', async () => {
    const user = userEvent.setup()
    const onAnswer = vi.fn().mockResolvedValue(undefined)
    const clarification = createClarification({ allowCustomAnswer: true })

    render(
      <QuestionClarificationCard
        clarification={clarification}
        onAnswer={onAnswer}
        onCancel={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('待回答')).toBeInTheDocument()
    })

    // Click "其他" to show custom input
    await user.click(screen.getByLabelText('输入自定义答案'))

    // Type custom answer
    const input = screen.getByPlaceholderText('输入你的答案...')
    await user.type(input, 'MongoDB')

    // Click submit
    const submitButton = screen.getByLabelText('提交自定义答案')
    await user.click(submitButton)

    await waitFor(() => {
      expect(onAnswer).toHaveBeenCalledWith('clarification-1', 'MongoDB')
    })
  })

  it('does not submit empty custom answer', async () => {
    const user = userEvent.setup()
    const onAnswer = vi.fn()
    const clarification = createClarification({ allowCustomAnswer: true })

    render(
      <QuestionClarificationCard
        clarification={clarification}
        onAnswer={onAnswer}
        onCancel={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('待回答')).toBeInTheDocument()
    })

    await user.click(screen.getByLabelText('输入自定义答案'))

    // Submit button should be disabled without input
    const submitButton = screen.getByLabelText('提交自定义答案')
    expect(submitButton).toBeDisabled()
    expect(onAnswer).not.toHaveBeenCalled()
  })

  it('does not show custom input when allowCustomAnswer is false', () => {
    const clarification = createClarification({ allowCustomAnswer: false })
    render(
      <QuestionClarificationCard
        clarification={clarification}
        onAnswer={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    expect(
      screen.queryByLabelText('输入自定义答案')
    ).not.toBeInTheDocument()
  })

  it('calls onCancel when cancel button clicked', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn().mockResolvedValue(undefined)
    const clarification = createClarification()

    render(
      <QuestionClarificationCard
        clarification={clarification}
        onAnswer={vi.fn()}
        onCancel={onCancel}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('待回答')).toBeInTheDocument()
    })

    const cancelButton = screen.getByLabelText('取消澄清')
    await user.click(cancelButton)

    await waitFor(() => {
      expect(onCancel).toHaveBeenCalledWith('clarification-1')
    })
  })

  it('shows resolved state after successful answer', async () => {
    const user = userEvent.setup()
    const onAnswer = vi.fn().mockResolvedValue(undefined)
    const clarification = createClarification()

    render(
      <QuestionClarificationCard
        clarification={clarification}
        onAnswer={onAnswer}
        onCancel={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('待回答')).toBeInTheDocument()
    })

    const option = screen.getByRole('radio', { name: '选择：PostgreSQL' })
    await user.click(option)

    await waitFor(() => {
      expect(screen.getByText('已回答')).toBeInTheDocument()
    })

    // Buttons should be disabled in resolved state
    expect(option).toBeDisabled()
  })

  it('shows error message when action fails', async () => {
    const user = userEvent.setup()
    const onAnswer = vi
      .fn()
      .mockRejectedValue(new Error('网络错误，请重试'))
    const clarification = createClarification()

    render(
      <QuestionClarificationCard
        clarification={clarification}
        onAnswer={onAnswer}
        onCancel={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('待回答')).toBeInTheDocument()
    })

    const option = screen.getByRole('radio', { name: '选择：PostgreSQL' })
    await user.click(option)

    await waitFor(() => {
      expect(screen.getByText('网络错误，请重试')).toBeInTheDocument()
    })

    // Should return to pending state after error
    expect(screen.getByText('待回答')).toBeInTheDocument()
  })

  it('disables all inputs while submitting', async () => {
    const user = userEvent.setup()
    const onAnswer = vi
      .fn()
      .mockImplementation(() => new Promise<void>(() => undefined))
    const clarification = createClarification()

    render(
      <QuestionClarificationCard
        clarification={clarification}
        onAnswer={onAnswer}
        onCancel={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('待回答')).toBeInTheDocument()
    })

    const option = screen.getByRole('radio', { name: '选择：PostgreSQL' })
    await user.click(option)

    await waitFor(() => {
      expect(option).toBeDisabled()
    })
  })

  // ===========================================================================
  // 键盘导航与可访问性
  // ===========================================================================

  it('focuses first option on mount', async () => {
    const clarification = createClarification()
    render(
      <QuestionClarificationCard
        clarification={clarification}
        onAnswer={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('待回答')).toBeInTheDocument()
    })

    const firstOption = screen.getByRole('radio', {
      name: '选择：PostgreSQL'
    })
    expect(document.activeElement).toBe(firstOption)
  })

  it('handles Escape key to cancel', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn().mockResolvedValue(undefined)
    const clarification = createClarification()

    render(
      <QuestionClarificationCard
        clarification={clarification}
        onAnswer={vi.fn()}
        onCancel={onCancel}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('待回答')).toBeInTheDocument()
    })

    // Focus the card inner div (which has onKeyDown)
    const card = screen.getByRole('region', { name: '问题澄清' })
      .firstElementChild as HTMLElement
    card?.focus()
    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(onCancel).toHaveBeenCalledWith('clarification-1')
    })
  })

  it('has proper ARIA landmarks', () => {
    const clarification = createClarification()
    render(
      <QuestionClarificationCard
        clarification={clarification}
        onAnswer={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    expect(
      screen.getByRole('region', { name: '问题澄清' })
    ).toBeInTheDocument()

    expect(
      screen.getByRole('region', { name: '问题澄清' })
    ).toHaveAttribute('aria-live', 'polite')

    // radiogroup for preset options
    expect(
      screen.getByRole('radiogroup', { name: '回答选项' })
    ).toBeInTheDocument()
  })

  it('has accessible question label', () => {
    const clarification = createClarification()
    render(
      <QuestionClarificationCard
        clarification={clarification}
        onAnswer={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    expect(
      screen.getByLabelText('问题：你希望使用哪个数据库？')
    ).toBeInTheDocument()
  })

  // ===========================================================================
  // 不同问题
  // ===========================================================================

  it('renders different questions correctly', () => {
    const clarification = createClarification({
      question: '你希望将文件保存在哪个目录？',
      options: ['/tmp', '/home/user', '/opt']
    })

    render(
      <QuestionClarificationCard
        clarification={clarification}
        onAnswer={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    expect(
      screen.getByText('你希望将文件保存在哪个目录？')
    ).toBeInTheDocument()
    expect(screen.getByText('/tmp')).toBeInTheDocument()
    expect(screen.getByText('/home/user')).toBeInTheDocument()
    expect(screen.getByText('/opt')).toBeInTheDocument()
  })

  it('renders with 2 options (minimum)', () => {
    const clarification = createClarification({
      options: ['是', '否'],
      allowCustomAnswer: false
    })

    render(
      <QuestionClarificationCard
        clarification={clarification}
        onAnswer={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByText('是')).toBeInTheDocument()
    expect(screen.getByText('否')).toBeInTheDocument()
    expect(
      screen.queryByLabelText('输入自定义答案')
    ).not.toBeInTheDocument()
  })

  it('renders with 5 options (maximum)', () => {
    const clarification = createClarification({
      options: ['选项A', '选项B', '选项C', '选项D', '选项E']
    })

    render(
      <QuestionClarificationCard
        clarification={clarification}
        onAnswer={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByText('选项A')).toBeInTheDocument()
    expect(screen.getByText('选项E')).toBeInTheDocument()
  })

  // ===========================================================================
  // 连续多个单问题
  // ===========================================================================

  it('handles multiple sequential clarifications with different IDs', async () => {
    const user = userEvent.setup()
    const onAnswer1 = vi.fn().mockResolvedValue(undefined)
    const onAnswer2 = vi.fn().mockResolvedValue(undefined)

    const clarification1 = createClarification({
      clarificationId: 'cl-1',
      question: '第一个问题？',
      options: ['答A', '答B']
    })
    const clarification2 = createClarification({
      clarificationId: 'cl-2',
      question: '第二个问题？',
      options: ['答C', '答D']
    })

    const { rerender } = render(
      <QuestionClarificationCard
        clarification={clarification1}
        onAnswer={onAnswer1}
        onCancel={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('第一个问题？')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('radio', { name: '选择：答A' }))

    await waitFor(() => {
      expect(onAnswer1).toHaveBeenCalledWith('cl-1', '答A')
    })

    // Rerender with second clarification
    rerender(
      <QuestionClarificationCard
        clarification={clarification2}
        onAnswer={onAnswer2}
        onCancel={vi.fn()}
      />
    )

    // 等待新卡片的入场动画完成
    await waitFor(() => {
      expect(screen.getByText('第二个问题？')).toBeInTheDocument()
      expect(screen.getByText('待回答')).toBeInTheDocument()
    })

    const optionC = screen.getByRole('radio', { name: '选择：答C' })
    await user.click(optionC)

    await waitFor(() => {
      expect(onAnswer2).toHaveBeenCalledWith('cl-2', '答C')
    })
  })
})
