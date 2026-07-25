import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { AgentSoulEditor } from './AgentSoulEditor'

describe('AgentSoulEditor', () => {
  it('读取 Agent 灵魂并携带观察版本保存', async () => {
    const getSoul = vi.fn().mockResolvedValue({
      agentId: 'agent-a',
      content: '# 旧灵魂',
      updatedAt: '2026-07-25T00:00:00.000Z',
      version: 'sha256:old'
    })
    const updateSoul = vi.fn().mockResolvedValue({
      target: 'soul',
      status: 'updated',
      version: 'sha256:new'
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { getSoul, updateSoul }
    })

    render(<AgentSoulEditor agentId="agent-a" editable />)

    const editor = await screen.findByLabelText('Agent 灵魂')
    expect(editor).toHaveValue('# 旧灵魂')
    fireEvent.change(editor, { target: { value: '# 新灵魂' } })
    fireEvent.click(screen.getByRole('button', { name: '保存 Agent 灵魂' }))

    await waitFor(() => {
      expect(updateSoul).toHaveBeenCalledWith({
        agentId: 'agent-a',
        content: '# 新灵魂',
        expectedVersion: 'sha256:old'
      })
    })
  })

  it('展示受控写入的拒绝原因', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        getSoul: vi.fn().mockResolvedValue({
          agentId: 'agent-a',
          content: '# 旧灵魂',
          updatedAt: '2026-07-25T00:00:00.000Z',
          version: 'sha256:old'
        }),
        updateSoul: vi.fn().mockResolvedValue({
          target: 'soul',
          status: 'rejected',
          version: 'sha256:current',
          reason: {
            code: 'version-conflict',
            message: '资料已被其他会话更新，请读取最新内容后重试。'
          }
        })
      }
    })

    render(<AgentSoulEditor agentId="agent-a" editable />)

    fireEvent.change(await screen.findByLabelText('Agent 灵魂'), {
      target: { value: '# 冲突修改' }
    })
    fireEvent.click(screen.getByRole('button', { name: '保存 Agent 灵魂' }))

    expect(
      await screen.findByText('资料已被其他会话更新，请读取最新内容后重试。')
    ).toBeInTheDocument()
  })
})
