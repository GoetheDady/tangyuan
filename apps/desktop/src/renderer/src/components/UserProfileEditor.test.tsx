import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { UserProfileEditor } from './UserProfileEditor'

describe('UserProfileEditor', () => {
  it('读取共享用户画像并携带观察版本保存', async () => {
    const getUserProfile = vi.fn().mockResolvedValue({
      content: '# 旧画像',
      updatedAt: '2026-07-25T00:00:00.000Z',
      version: 'sha256:old'
    })
    const updateUserProfile = vi.fn().mockResolvedValue({
      target: 'user',
      status: 'updated',
      version: 'sha256:new'
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { getUserProfile, updateUserProfile }
    })

    render(<UserProfileEditor editable />)

    const editor = await screen.findByLabelText('共享用户画像')
    expect(editor).toHaveValue('# 旧画像')
    fireEvent.change(editor, { target: { value: '# 新画像' } })
    fireEvent.click(screen.getByRole('button', { name: '保存用户画像' }))

    await waitFor(() => {
      expect(updateUserProfile).toHaveBeenCalledWith({
        content: '# 新画像',
        expectedVersion: 'sha256:old'
      })
    })
  })

  it('版本冲突时展示拒绝原因并重新读取最新画像', async () => {
    const getUserProfile = vi
      .fn()
      .mockResolvedValueOnce({
        content: '# 旧画像',
        updatedAt: '2026-07-25T00:00:00.000Z',
        version: 'sha256:old'
      })
      .mockResolvedValueOnce({
        content: '# 其他会话的新画像',
        updatedAt: '2026-07-25T00:01:00.000Z',
        version: 'sha256:current'
      })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        getUserProfile,
        updateUserProfile: vi.fn().mockResolvedValue({
          target: 'user',
          status: 'rejected',
          version: 'sha256:current',
          reason: {
            code: 'version-conflict',
            message: '资料已被其他会话更新，请读取最新内容后重试。'
          }
        })
      }
    })

    render(<UserProfileEditor editable />)

    fireEvent.change(await screen.findByLabelText('共享用户画像'), {
      target: { value: '# 冲突修改' }
    })
    fireEvent.click(screen.getByRole('button', { name: '保存用户画像' }))

    expect(
      await screen.findByText('资料已被其他会话更新，请读取最新内容后重试。')
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(getUserProfile).toHaveBeenCalledTimes(2)
      expect(screen.getByLabelText('共享用户画像')).toHaveValue('# 其他会话的新画像')
    })
  })
})
