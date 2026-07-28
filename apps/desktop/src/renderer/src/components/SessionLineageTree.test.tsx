import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createDefaultSessionSummary, type AgentSessionSummary } from '@tangyuan/contracts'
import { describe, expect, it, vi } from 'vitest'
import { SessionLineageTree } from './SessionLineageTree'

/** 创建带分叉来源的会话摘要。 */
function createSession(
  sessionId: string,
  title: string,
  forkedFrom?: { sessionId: string; entryId: string }
): AgentSessionSummary {
  return {
    ...createDefaultSessionSummary({
      sessionId,
      title,
      updatedAt: '2026-07-28T00:00:00.000Z'
    }),
    ...(forkedFrom ? { forkedFrom } : {})
  }
}

describe('SessionLineageTree', () => {
  it('按任意深度展示父子会话谱系', () => {
    render(
      <SessionLineageTree
        sessions={[
          createSession('root', '根会话'),
          createSession('child', '子会话', { sessionId: 'root', entryId: 'e1' }),
          createSession('grandchild', '二级分叉', { sessionId: 'child', entryId: 'e2' }),
          createSession('great-grandchild', '三级分叉', {
            sessionId: 'grandchild',
            entryId: 'e3'
          })
        ]}
        rootSessions={[createSession('root', '根会话')]}
        selectedSessionId={null}
        pendingApprovalSessionIds={[]}
        onSelect={vi.fn()}
      />
    )

    expect(screen.getByRole('treeitem', { name: /根会话/ })).toHaveAttribute('aria-level', '1')
    expect(screen.getByRole('treeitem', { name: /子会话/ })).toHaveAttribute('aria-level', '2')
    expect(screen.getByRole('treeitem', { name: /二级分叉/ })).toHaveAttribute('aria-level', '3')
    expect(screen.getByRole('treeitem', { name: /三级分叉/ })).toHaveAttribute('aria-level', '4')
  })

  it('同源多个分叉并列展示，互不覆盖', () => {
    render(
      <SessionLineageTree
        sessions={[
          createSession('root', '根会话'),
          createSession('fork-a', '方案 A', { sessionId: 'root', entryId: 'e1' }),
          createSession('fork-b', '方案 B', { sessionId: 'root', entryId: 'e1' })
        ]}
        rootSessions={[createSession('root', '根会话')]}
        selectedSessionId={null}
        pendingApprovalSessionIds={[]}
        onSelect={vi.fn()}
      />
    )

    expect(screen.getByRole('treeitem', { name: /方案 A/ })).toHaveAttribute('aria-level', '2')
    expect(screen.getByRole('treeitem', { name: /方案 B/ })).toHaveAttribute('aria-level', '2')
  })

  it('点击任意深度的会话都会回调该会话', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const grandchild = createSession('grandchild', '孙会话', {
      sessionId: 'child',
      entryId: 'e2'
    })

    render(
      <SessionLineageTree
        sessions={[
          createSession('root', '根会话'),
          createSession('child', '子会话', { sessionId: 'root', entryId: 'e1' }),
          grandchild
        ]}
        rootSessions={[createSession('root', '根会话')]}
        selectedSessionId={null}
        pendingApprovalSessionIds={[]}
        onSelect={onSelect}
      />
    )

    await user.click(screen.getByRole('treeitem', { name: /孙会话/ }))

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'grandchild' }))
  })

  it('祖先形成环时不会无限递归', () => {
    render(
      <SessionLineageTree
        sessions={[
          createSession('a', '会话 A', { sessionId: 'b', entryId: 'e1' }),
          createSession('b', '会话 B', { sessionId: 'a', entryId: 'e2' })
        ]}
        rootSessions={[createSession('a', '会话 A', { sessionId: 'b', entryId: 'e1' })]}
        selectedSessionId={null}
        pendingApprovalSessionIds={[]}
        onSelect={vi.fn()}
      />
    )

    expect(screen.getByRole('treeitem', { name: /会话 A/ })).toHaveAttribute('aria-level', '1')
    expect(screen.getByRole('treeitem', { name: /会话 B/ })).toHaveAttribute('aria-level', '2')
  })

  it('标注运行中与待审批状态', () => {
    render(
      <SessionLineageTree
        sessions={[
          { ...createSession('root', '根会话'), state: 'running' },
          createSession('child', '子会话', { sessionId: 'root', entryId: 'e1' })
        ]}
        rootSessions={[{ ...createSession('root', '根会话'), state: 'running' }]}
        selectedSessionId="child"
        pendingApprovalSessionIds={['child']}
        onSelect={vi.fn()}
      />
    )

    expect(screen.getByRole('treeitem', { name: /根会话.*运行中/ })).toBeInTheDocument()
    expect(screen.getByRole('treeitem', { name: /子会话.*待审批/ })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  })
})
