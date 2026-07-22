import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { BashApprovalRequest } from '@tangyuan/contracts'
import { BashApprovalCard } from './BashApprovalCard'

function createApproval(overrides?: Partial<BashApprovalRequest>): BashApprovalRequest {
  return {
    approvalId: 'approval-1',
    agentId: 'tangyuan',
    sessionId: 'session-1',
    runId: 'run-1',
    command: 'npm install lodash',
    cwd: '/Users/test/project',
    riskDescription: '此命令将安装第三方软件包 lodash，可能引入未知依赖。',
    status: 'pending',
    createdAt: '2026-07-21T00:00:00.000Z',
    ...overrides
  }
}

describe('BashApprovalCard', () => {
  it('renders command, cwd, and risk description', () => {
    const approval = createApproval()
    render(
      <BashApprovalCard
        approval={approval}
        onApproveOnce={vi.fn()}
        onApproveAlways={vi.fn()}
        onReject={vi.fn()}
      />
    )

    expect(screen.getByText('npm install lodash')).toBeInTheDocument()
    expect(screen.getByText('/Users/test/project')).toBeInTheDocument()
    expect(
      screen.getByText(/此命令将安装第三方软件包/)
    ).toBeInTheDocument()
  })

  it('shows "待审批" badge in pending state', () => {
    const approval = createApproval()
    render(
      <BashApprovalCard
        approval={approval}
        onApproveOnce={vi.fn()}
        onApproveAlways={vi.fn()}
        onReject={vi.fn()}
      />
    )

    expect(screen.getByText('待审批')).toBeInTheDocument()
    expect(screen.getByText('Bash 命令执行审批')).toBeInTheDocument()
  })

  it('renders three action buttons', () => {
    const approval = createApproval()
    render(
      <BashApprovalCard
        approval={approval}
        onApproveOnce={vi.fn()}
        onApproveAlways={vi.fn()}
        onReject={vi.fn()}
      />
    )

    expect(
      screen.getByRole('button', { name: '拒绝此命令执行' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: '始终允许此命令（当前会话中同命令免审）' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: '仅允许本次执行此命令' })
    ).toBeInTheDocument()
  })

  it('calls onApproveOnce when "允许本次" is clicked', async () => {
    const user = userEvent.setup()
    const onApproveOnce = vi.fn().mockResolvedValue(undefined)
    const approval = createApproval()

    render(
      <BashApprovalCard
        approval={approval}
        onApproveOnce={onApproveOnce}
        onApproveAlways={vi.fn()}
        onReject={vi.fn()}
      />
    )

    // Wait for phase transition from entering to pending
    await waitFor(() => {
      expect(screen.getByText('待审批')).toBeInTheDocument()
    })

    const approveButton = screen.getByRole('button', {
      name: '仅允许本次执行此命令'
    })
    await user.click(approveButton)

    await waitFor(() => {
      expect(onApproveOnce).toHaveBeenCalledWith('approval-1')
    })
  })

  it('calls onApproveAlways when "始终允许" is clicked', async () => {
    const user = userEvent.setup()
    const onApproveAlways = vi.fn().mockResolvedValue(undefined)
    const approval = createApproval()

    render(
      <BashApprovalCard
        approval={approval}
        onApproveOnce={vi.fn()}
        onApproveAlways={onApproveAlways}
        onReject={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('待审批')).toBeInTheDocument()
    })

    const alwaysButton = screen.getByRole('button', {
      name: '始终允许此命令（当前会话中同命令免审）'
    })
    await user.click(alwaysButton)

    await waitFor(() => {
      expect(onApproveAlways).toHaveBeenCalledWith('approval-1')
    })
  })

  it('calls onReject when "拒绝" is clicked', async () => {
    const user = userEvent.setup()
    const onReject = vi.fn().mockResolvedValue(undefined)
    const approval = createApproval()

    render(
      <BashApprovalCard
        approval={approval}
        onApproveOnce={vi.fn()}
        onApproveAlways={vi.fn()}
        onReject={onReject}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('待审批')).toBeInTheDocument()
    })

    const rejectButton = screen.getByRole('button', {
      name: '拒绝此命令执行'
    })
    await user.click(rejectButton)

    await waitFor(() => {
      expect(onReject).toHaveBeenCalledWith('approval-1')
    })
  })

  it('shows loading state on the clicked button', async () => {
    const user = userEvent.setup()
    // Return a promise that never resolves to keep loading state
    const onApproveOnce = vi
      .fn()
      .mockImplementation(
        () => new Promise<void>(() => undefined)
      )
    const approval = createApproval()

    render(
      <BashApprovalCard
        approval={approval}
        onApproveOnce={onApproveOnce}
        onApproveAlways={vi.fn()}
        onReject={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('待审批')).toBeInTheDocument()
    })

    const approveButton = screen.getByRole('button', {
      name: '仅允许本次执行此命令'
    })
    await user.click(approveButton)

    // Wait for the loading state to appear
    await waitFor(() => {
      // Check button is disabled during loading
      expect(approveButton).toBeDisabled()
    })
  })

  it('disables all buttons while submitting', async () => {
    const user = userEvent.setup()
    const onApproveOnce = vi
      .fn()
      .mockImplementation(
        () => new Promise<void>(() => undefined)
      )
    const approval = createApproval()

    render(
      <BashApprovalCard
        approval={approval}
        onApproveOnce={onApproveOnce}
        onApproveAlways={vi.fn()}
        onReject={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('待审批')).toBeInTheDocument()
    })

    const approveButton = screen.getByRole('button', {
      name: '仅允许本次执行此命令'
    })
    await user.click(approveButton)

    const rejectButton = screen.getByRole('button', {
      name: '拒绝此命令执行'
    })
    const alwaysButton = screen.getByRole('button', {
      name: '始终允许此命令（当前会话中同命令免审）'
    })

    await waitFor(() => {
      expect(approveButton).toBeDisabled()
      expect(rejectButton).toBeDisabled()
      expect(alwaysButton).toBeDisabled()
    })
  })

  it('shows resolved state after successful action', async () => {
    const user = userEvent.setup()
    const onApproveOnce = vi.fn().mockResolvedValue(undefined)
    const approval = createApproval()

    render(
      <BashApprovalCard
        approval={approval}
        onApproveOnce={onApproveOnce}
        onApproveAlways={vi.fn()}
        onReject={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('待审批')).toBeInTheDocument()
    })

    const approveButton = screen.getByRole('button', {
      name: '仅允许本次执行此命令'
    })
    await user.click(approveButton)

    await waitFor(() => {
      expect(screen.getByText('已处理')).toBeInTheDocument()
    })

    // Buttons should be disabled in resolved state
    expect(approveButton).toBeDisabled()
  })

  it('shows error message when action fails', async () => {
    const user = userEvent.setup()
    const onApproveOnce = vi.fn().mockRejectedValue(new Error('网络错误，请重试'))
    const approval = createApproval()

    render(
      <BashApprovalCard
        approval={approval}
        onApproveOnce={onApproveOnce}
        onApproveAlways={vi.fn()}
        onReject={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('待审批')).toBeInTheDocument()
    })

    const approveButton = screen.getByRole('button', {
      name: '仅允许本次执行此命令'
    })
    await user.click(approveButton)

    await waitFor(() => {
      expect(screen.getByText('网络错误，请重试')).toBeInTheDocument()
    })

    // Should return to pending state after error, buttons re-enabled
    expect(approveButton).not.toBeDisabled()
    expect(screen.getByText('待审批')).toBeInTheDocument()
  })

  // ===========================================================================
  // 键盘导航与可访问性
  // ===========================================================================

  it('moves focus to first button on mount via auto-focus', async () => {
    const approval = createApproval()
    render(
      <BashApprovalCard
        approval={approval}
        onApproveOnce={vi.fn()}
        onApproveAlways={vi.fn()}
        onReject={vi.fn()}
      />
    )

    // Focus should be on the first button ("拒绝") after entering phase completes
    await waitFor(() => {
      expect(screen.getByText('待审批')).toBeInTheDocument()
    })

    // The first button ref is set on the reject button
    const rejectButton = screen.getByRole('button', {
      name: '拒绝此命令执行'
    })
    expect(document.activeElement).toBe(rejectButton)
  })

  it('handles Escape key to reject', async () => {
    const user = userEvent.setup()
    const onReject = vi.fn().mockResolvedValue(undefined)
    const approval = createApproval()

    render(
      <BashApprovalCard
        approval={approval}
        onApproveOnce={vi.fn()}
        onApproveAlways={vi.fn()}
        onReject={onReject}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('待审批')).toBeInTheDocument()
    })

    // Focus the card inner div (which has tabIndex and the onKeyDown handler)
    const card = screen.getByRole('region', { name: 'Bash 命令执行审批' })
      .firstElementChild as HTMLElement
    card?.focus()
    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(onReject).toHaveBeenCalledWith('approval-1')
    })
  })

  it('renders with proper ARIA landmarks', () => {
    const approval = createApproval()
    render(
      <BashApprovalCard
        approval={approval}
        onApproveOnce={vi.fn()}
        onApproveAlways={vi.fn()}
        onReject={vi.fn()}
      />
    )

    // region role for the card
    expect(
      screen.getByRole('region', { name: 'Bash 命令执行审批' })
    ).toBeInTheDocument()

    // aria-live for dynamic updates
    expect(
      screen.getByRole('region', { name: 'Bash 命令执行审批' })
    ).toHaveAttribute('aria-live', 'polite')

    // alert role for risk description
    const alerts = screen.getAllByRole('alert')
    expect(alerts.length).toBeGreaterThanOrEqual(2) // risk + security warning
  })

  it('has accessible command label', () => {
    const approval = createApproval()
    render(
      <BashApprovalCard
        approval={approval}
        onApproveOnce={vi.fn()}
        onApproveAlways={vi.fn()}
        onReject={vi.fn()}
      />
    )

    const codeBlock = screen.getByLabelText('命令：npm install lodash')
    expect(codeBlock).toBeInTheDocument()
    expect(codeBlock.tagName).toBe('PRE')
  })

  it('prevents double-clicks during submission', async () => {
    const user = userEvent.setup()
    // eslint-disable-next-line prefer-const
    let resolvePromise: () => void
    const onApproveOnce = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvePromise = resolve
        })
    )
    const approval = createApproval()

    render(
      <BashApprovalCard
        approval={approval}
        onApproveOnce={onApproveOnce}
        onApproveAlways={vi.fn()}
        onReject={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('待审批')).toBeInTheDocument()
    })

    const approveButton = screen.getByRole('button', {
      name: '仅允许本次执行此命令'
    })

    // Click twice rapidly
    await user.click(approveButton)
    await user.click(approveButton)

    // Should only be called once
    expect(onApproveOnce).toHaveBeenCalledTimes(1)

    // Resolve the promise to clean up
    resolvePromise!()
  })

  // ===========================================================================
  // 不同命令
  // ===========================================================================

  it('renders different commands correctly', () => {
    const approval = createApproval({
      command: 'rm -rf /tmp/test',
      riskDescription: '此命令将删除临时文件。'
    })

    render(
      <BashApprovalCard
        approval={approval}
        onApproveOnce={vi.fn()}
        onApproveAlways={vi.fn()}
        onReject={vi.fn()}
      />
    )

    expect(screen.getByText('rm -rf /tmp/test')).toBeInTheDocument()
    expect(screen.getByText('此命令将删除临时文件。')).toBeInTheDocument()
  })

  // ===========================================================================
  // 安全警告
  // ===========================================================================

  it('always shows macOS security warning', () => {
    const approval = createApproval()
    render(
      <BashApprovalCard
        approval={approval}
        onApproveOnce={vi.fn()}
        onApproveAlways={vi.fn()}
        onReject={vi.fn()}
      />
    )

    expect(
      screen.getByText(/此命令将以当前 macOS 用户权限执行/)
    ).toBeInTheDocument()
  })
})
