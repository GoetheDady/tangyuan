import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Toaster } from '@/components/ui/sonner'

describe('Toaster', () => {
  afterEach(() => {
    act(() => {
      toast.dismiss()
    })
    cleanup()
    vi.useRealTimers()
  })

  it('keeps direct Sonner calls in the themed bottom-right queue', async () => {
    render(<Toaster />)

    act(() => {
      toast.success('Agent 配置已保存')
    })

    const message = await screen.findByText('Agent 配置已保存')
    const item = message.closest('[data-sonner-toast]')
    const toaster = item?.closest('[data-sonner-toaster]')

    expect(item).toHaveAttribute('data-type', 'success')
    expect(item?.querySelector('[data-icon] svg')).toHaveClass('text-success-foreground')
    expect(toaster).toHaveAttribute('data-y-position', 'bottom')
    expect(toaster).toHaveAttribute('data-x-position', 'right')
    expect(toaster).toHaveStyle({ '--gap': '8px' })
    expect(screen.getByRole('button', { name: '关闭通知' })).toBeInTheDocument()
  })

  it.each([
    ['info', () => toast.info('需要审批'), 'text-info-foreground'],
    ['success', () => toast.success('操作成功'), 'text-success-foreground'],
    ['warning', () => toast.warning('需要注意'), 'text-warning-foreground'],
    ['error', () => toast.error('操作失败'), 'text-destructive-soft-foreground'],
    ['loading', () => toast.loading('正在保存'), 'text-info-foreground']
  ] as const)('uses shared semantic tokens for %s feedback', async (type, showToast, iconClass) => {
    render(<Toaster />)

    act(() => {
      showToast()
    })

    const item = (await screen.findByText(/需要审批|操作成功|需要注意|操作失败|正在保存/)).closest(
      '[data-sonner-toast]'
    )

    expect(item).toHaveAttribute('data-type', type)
    expect(item?.querySelector('[data-icon] svg')).toHaveClass(iconClass)
  })

  it('supports description, action, cancel and accessible close behavior', async () => {
    const onAction = vi.fn()
    const onCancel = vi.fn()
    render(<Toaster />)

    act(() => {
      toast.error('操作失败', {
        description: '请检查网络连接后重试。',
        action: { label: '重试', onClick: onAction },
        cancel: { label: '取消', onClick: onCancel }
      })
    })

    expect(await screen.findByText('操作失败')).toBeInTheDocument()
    expect(screen.getByText('请检查网络连接后重试。')).toBeInTheDocument()

    screen.getByRole('button', { name: '重试' }).click()
    screen.getByRole('button', { name: '取消' }).click()

    expect(onAction).toHaveBeenCalledOnce()
    expect(onCancel).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: '关闭通知' })).toBeInTheDocument()
  })

  it('dismisses a notification from the accessible close button', async () => {
    render(<Toaster />)

    act(() => {
      toast.success('可手动关闭通知')
    })

    const item = (await screen.findByText('可手动关闭通知')).closest('[data-sonner-toast]')
    act(() => {
      screen.getByRole('button', { name: '关闭通知' }).click()
    })

    await waitFor(() => {
      expect(item).toHaveAttribute('data-removed', 'true')
    })
  })

  it('updates a loading toast in the same queue item', async () => {
    render(<Toaster />)

    act(() => {
      toast.loading('正在保存 Agent 配置', { id: 'save-agent' })
    })

    const loadingItem = (await screen.findByText('正在保存 Agent 配置')).closest(
      '[data-sonner-toast]'
    )
    expect(loadingItem).toHaveAttribute('data-type', 'loading')

    act(() => {
      toast.success('Agent 配置已保存', { id: 'save-agent' })
    })

    expect(await screen.findByText('Agent 配置已保存')).toBeInTheDocument()
    expect(screen.queryByText('正在保存 Agent 配置')).not.toBeInTheDocument()
    expect(document.querySelectorAll('[data-sonner-toast]')).toHaveLength(1)
    expect(document.querySelector('[data-sonner-toast]')).toHaveAttribute('data-type', 'success')
  })

  it('automatically dismisses notifications after the 4000ms default', async () => {
    vi.useFakeTimers()
    render(<Toaster />)

    act(() => {
      toast.info('自动消失通知')
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('自动消失通知')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3999)
    })
    expect(screen.getByText('自动消失通知')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(screen.getByText('自动消失通知').closest('[data-sonner-toast]')).toHaveAttribute(
      'data-removed',
      'true'
    )
  })

  it('shows at most three consecutive notifications at once', async () => {
    render(<Toaster />)

    act(() => {
      for (const index of [1, 2, 3, 4]) {
        toast.info(`队列通知 ${index}`, { duration: Number.POSITIVE_INFINITY })
      }
    })

    await screen.findByText('队列通知 4')
    const visibleItems = Array.from(document.querySelectorAll('[data-sonner-toast]')).filter(
      (item) => item.getAttribute('data-visible') === 'true'
    )

    expect(visibleItems).toHaveLength(3)
  })
})
