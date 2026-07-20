import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'

type RenderAlertDialogOptions = {
  size?: 'default' | 'sm'
  contentClassName?: string
  contentRef?: React.Ref<HTMLDivElement>
  actionVariant?: React.ComponentProps<typeof AlertDialogAction>['variant']
  actionSize?: React.ComponentProps<typeof AlertDialogAction>['size']
  actionClassName?: string
  actionDisabled?: boolean
  onActionClick?: () => void
}

function renderAlertDialog({
  size = 'default',
  contentClassName,
  contentRef,
  actionVariant,
  actionSize,
  actionClassName,
  actionDisabled,
  onActionClick
}: RenderAlertDialogOptions = {}) {
  return render(
    <AlertDialog defaultOpen>
      <AlertDialogContent ref={contentRef} size={size} className={contentClassName}>
        <AlertDialogHeader>
          <AlertDialogTitle>确认归档 Agent</AlertDialogTitle>
          <AlertDialogDescription>
            归档后 Agent 将从日常使用列表中移除，但仍可恢复。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            variant={actionVariant}
            size={actionSize}
            className={actionClassName}
            disabled={actionDisabled}
            onClick={onActionClick}
          >
            确认归档
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

describe('AlertDialog', () => {
  it('uses the Pencil default size, safe viewport margin, and Level 3 elevation', () => {
    renderAlertDialog()

    const dialog = screen.getByRole('alertdialog', { name: '确认归档 Agent' })
    expect(dialog).toHaveAttribute('data-slot', 'alert-dialog-content')
    expect(dialog).toHaveAttribute('data-size', 'default')
    expect(dialog.className).toContain('w-[calc(100%-2rem)]')
    expect(dialog.className).toContain('data-[size=default]:max-w-lg')
    expect(dialog.className).toContain('rounded-lg')
    expect(dialog.className).toContain('p-6')
    expect(dialog.className).toContain('shadow-level-3')
    expect(dialog.className).not.toContain('shadow-lg')
  })

  it('supports the Pencil small size without removing the viewport margin', () => {
    renderAlertDialog({ size: 'sm' })

    const dialog = screen.getByRole('alertdialog', { name: '确认归档 Agent' })
    expect(dialog).toHaveAttribute('data-size', 'sm')
    expect(dialog.className).toContain('data-[size=sm]:max-w-xs')
    expect(dialog.className).toContain('w-[calc(100%-2rem)]')
  })

  it('uses Title and Description as the accessible name and description', () => {
    renderAlertDialog()

    const dialog = screen.getByRole('alertdialog', { name: '确认归档 Agent' })
    expect(dialog).toHaveAccessibleDescription('归档后 Agent 将从日常使用列表中移除，但仍可恢复。')
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认归档' })).toBeInTheDocument()
  })

  it('composes Action and Cancel from Button variants and sizes', () => {
    renderAlertDialog({
      actionVariant: 'destructive',
      actionSize: 'sm',
      actionClassName: 'custom-action'
    })

    const action = screen.getByRole('button', { name: '确认归档' })
    const cancel = screen.getByRole('button', { name: '取消' })
    expect(action).toHaveAttribute('data-slot', 'alert-dialog-action')
    expect(action).toHaveAttribute('data-variant', 'destructive')
    expect(action).toHaveAttribute('data-size', 'sm')
    expect(action.className).toContain('bg-destructive')
    expect(action.className).toContain('h-8')
    expect(action.className).toContain('custom-action')
    expect(cancel).toHaveAttribute('data-slot', 'alert-dialog-cancel')
    expect(cancel).toHaveAttribute('data-variant', 'outline')
    expect(cancel).toHaveAttribute('data-size', 'default')
  })

  it('forwards Content ref and merges className', () => {
    const ref = createRef<HTMLDivElement>()
    renderAlertDialog({ contentRef: ref, contentClassName: 'custom-content' })

    expect(ref.current).toBeInstanceOf(HTMLDivElement)
    expect(ref.current).toHaveClass('custom-content')
  })

  it('passes native action props through the Button composition', async () => {
    const user = userEvent.setup()
    const onActionClick = vi.fn()
    renderAlertDialog({ actionDisabled: true, onActionClick })

    const action = screen.getByRole('button', { name: '确认归档' })
    expect(action).toBeDisabled()
    await user.click(action)
    expect(onActionClick).not.toHaveBeenCalled()
  })
})
