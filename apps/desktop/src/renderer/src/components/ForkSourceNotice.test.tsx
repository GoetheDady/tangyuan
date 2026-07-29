import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ForkSourceNotice } from './ForkSourceNotice'

describe('ForkSourceNotice', () => {
  it('展示来源会话标题并可跳回来源消息', async () => {
    const user = userEvent.setup()
    const onViewSource = vi.fn()

    render(
      <ForkSourceNotice
        parentSessionTitle="父会话"
        isParentAvailable
        onViewSource={onViewSource}
      />,
    )

    expect(screen.getByText(/分叉自/)).toHaveTextContent('分叉自「父会话」')
    await user.click(screen.getByRole('button', { name: '查看来源消息' }))

    expect(onViewSource).toHaveBeenCalledTimes(1)
  })

  it('来源会话不可用时提示且不提供跳转', () => {
    render(
      <ForkSourceNotice
        parentSessionTitle={null}
        isParentAvailable={false}
        onViewSource={vi.fn()}
      />,
    )

    expect(screen.getByText('分叉自已不可用的会话')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '查看来源消息' }),
    ).not.toBeInTheDocument()
  })
})
