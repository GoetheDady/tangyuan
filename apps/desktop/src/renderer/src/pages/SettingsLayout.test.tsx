import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it } from 'vitest'
import { SettingsLayout } from './SettingsLayout'

describe('SettingsLayout', () => {
  it('切换设置子页面后仍保留首次进入时的聊天返回地址', async () => {
    const user = userEvent.setup()
    const router = createMemoryRouter(
      [
        {
          path: '/settings',
          element: <SettingsLayout />,
          children: [
            { path: 'providers', element: <div>模型服务设置</div> },
            { path: 'agents', element: <div>Agent 设置</div> },
          ],
        },
      ],
      {
        initialEntries: [
          '/settings/providers?redirect=%2Fchat%2Fagent-1%2Fsession-1',
        ],
      },
    )

    render(<RouterProvider router={router} />)

    expect(screen.getByText('元宵 0.1.0')).toBeInTheDocument()

    const backLink = screen.getByRole('link', { name: '返回聊天' })
    expect(backLink).toHaveAttribute('href', '/chat/agent-1/session-1')

    await user.click(screen.getByRole('link', { name: 'Agents' }))

    expect(await screen.findByText('Agent 设置')).toBeInTheDocument()
    expect(backLink).toHaveAttribute('href', '/chat/agent-1/session-1')
  })
})
