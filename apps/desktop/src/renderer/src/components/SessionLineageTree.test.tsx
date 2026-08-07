import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  createDefaultSessionSummary,
  type AgentSessionSummary,
} from '@yuanxiao/contracts'
import { describe, expect, it, vi } from 'vitest'
import { SessionLineageTree } from './SessionLineageTree'

/** 创建带分叉来源的会话摘要。 */
function createSession(
  sessionId: string,
  title: string,
  forkedFrom?: { sessionId: string; entryId: string },
  state?: AgentSessionSummary['state'],
): AgentSessionSummary {
  return {
    ...createDefaultSessionSummary({
      sessionId,
      title,
      updatedAt: '2026-07-28T00:00:00.000Z',
    }),
    ...(forkedFrom ? { forkedFrom } : {}),
    ...(state ? { state } : {}),
  }
}

const defaultProps = {
  onSelect: vi.fn(),
  onArchive: vi.fn(),
  onDelete: vi.fn(),
  onRename: vi.fn(),
}

describe('SessionLineageTree', () => {
  it('按任意深度展示父子会话谱系', () => {
    render(
      <SessionLineageTree
        sessions={[
          createSession('root', '根会话'),
          createSession('child', '子会话', {
            sessionId: 'root',
            entryId: 'e1',
          }),
          createSession('grandchild', '二级分叉', {
            sessionId: 'child',
            entryId: 'e2',
          }),
          createSession('great-grandchild', '三级分叉', {
            sessionId: 'grandchild',
            entryId: 'e3',
          }),
        ]}
        rootSessions={[createSession('root', '根会话')]}
        selectedSessionId={null}
        {...defaultProps}
      />,
    )

    expect(screen.getByRole('treeitem', { name: /根会话/ })).toHaveAttribute(
      'aria-level',
      '1',
    )
    expect(screen.getByRole('treeitem', { name: /子会话/ })).toHaveAttribute(
      'aria-level',
      '2',
    )
    expect(screen.getByRole('treeitem', { name: /二级分叉/ })).toHaveAttribute(
      'aria-level',
      '3',
    )
    expect(screen.getByRole('treeitem', { name: /三级分叉/ })).toHaveAttribute(
      'aria-level',
      '4',
    )
  })

  it('同源多个分叉并列展示，互不覆盖', () => {
    render(
      <SessionLineageTree
        sessions={[
          createSession('root', '根会话'),
          createSession('fork-a', '方案 A', {
            sessionId: 'root',
            entryId: 'e1',
          }),
          createSession('fork-b', '方案 B', {
            sessionId: 'root',
            entryId: 'e1',
          }),
        ]}
        rootSessions={[createSession('root', '根会话')]}
        selectedSessionId={null}
        {...defaultProps}
      />,
    )

    expect(screen.getByRole('treeitem', { name: /方案 A/ })).toHaveAttribute(
      'aria-level',
      '2',
    )
    expect(screen.getByRole('treeitem', { name: /方案 B/ })).toHaveAttribute(
      'aria-level',
      '2',
    )
  })

  it('点击任意深度的会话都会回调该会话', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const grandchild = createSession('grandchild', '孙会话', {
      sessionId: 'child',
      entryId: 'e2',
    })

    render(
      <SessionLineageTree
        sessions={[
          createSession('root', '根会话'),
          createSession('child', '子会话', {
            sessionId: 'root',
            entryId: 'e1',
          }),
          grandchild,
        ]}
        rootSessions={[createSession('root', '根会话')]}
        selectedSessionId={null}
        onSelect={onSelect}
        onArchive={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('treeitem', { name: /孙会话/ }))

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'grandchild' }),
    )
  })

  it('祖先形成环时不会无限递归', () => {
    render(
      <SessionLineageTree
        sessions={[
          createSession('a', '会话 A', { sessionId: 'b', entryId: 'e1' }),
          createSession('b', '会话 B', { sessionId: 'a', entryId: 'e2' }),
        ]}
        rootSessions={[
          createSession('a', '会话 A', { sessionId: 'b', entryId: 'e1' }),
        ]}
        selectedSessionId={null}
        {...defaultProps}
      />,
    )

    expect(screen.getByRole('treeitem', { name: /会话 A/ })).toHaveAttribute(
      'aria-level',
      '1',
    )
    expect(screen.getByRole('treeitem', { name: /会话 B/ })).toHaveAttribute(
      'aria-level',
      '2',
    )
  })

  it('标注运行中状态', () => {
    render(
      <SessionLineageTree
        sessions={[
          { ...createSession('root', '根会话'), state: 'running' },
          createSession('child', '子会话', {
            sessionId: 'root',
            entryId: 'e1',
          }),
        ]}
        rootSessions={[
          { ...createSession('root', '根会话'), state: 'running' },
        ]}
        selectedSessionId="child"
        {...defaultProps}
      />,
    )

    expect(
      screen.getByRole('treeitem', { name: /根会话.*运行中/ }),
    ).toBeInTheDocument()
    expect(screen.getByRole('treeitem', { name: /子会话/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  describe('⋯ 操作菜单', () => {
    it('hover 会话行时 ⋯ 按钮出现，点击触发归档回调', async () => {
      const user = userEvent.setup()
      const onArchive = vi.fn()
      const session = createSession('root', '根会话')

      render(
        <SessionLineageTree
          sessions={[session]}
          rootSessions={[session]}
          selectedSessionId={null}
          onSelect={vi.fn()}
          onArchive={onArchive}
          onDelete={vi.fn()}
          onRename={vi.fn()}
        />,
      )

      const item = screen.getByRole('treeitem', { name: /根会话/ })
      await user.hover(item)
      await user.click(screen.getByRole('button', { name: '根会话的操作菜单' }))
      await user.click(screen.getByRole('menuitem', { name: '归档' }))

      expect(onArchive).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'root' }),
      )
    })

    it('点击删除触发删除回调，不触发选中回调', async () => {
      const user = userEvent.setup()
      const onDelete = vi.fn()
      const onSelect = vi.fn()
      const session = createSession('root', '根会话')

      render(
        <SessionLineageTree
          sessions={[session]}
          rootSessions={[session]}
          selectedSessionId={null}
          onSelect={onSelect}
          onArchive={vi.fn()}
          onDelete={onDelete}
          onRename={vi.fn()}
        />,
      )

      const item = screen.getByRole('treeitem', { name: /根会话/ })
      await user.hover(item)
      await user.click(screen.getByRole('button', { name: '根会话的操作菜单' }))
      await user.click(screen.getByRole('menuitem', { name: '删除' }))

      expect(onDelete).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'root' }),
      )
      expect(onSelect).not.toHaveBeenCalled()
    })

    it('谱系有活动任务时归档与删除置灰，并展示提示文字', async () => {
      const user = userEvent.setup()
      const session = createSession('root', '根会话', undefined, 'running')

      render(
        <SessionLineageTree
          sessions={[session]}
          rootSessions={[session]}
          selectedSessionId={null}
          {...defaultProps}
        />,
      )

      const item = screen.getByRole('treeitem', { name: /根会话/ })
      await user.hover(item)
      await user.click(screen.getByRole('button', { name: '根会话的操作菜单' }))

      expect(screen.getByText('请先停止运行中的任务')).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: '归档' })).toHaveAttribute(
        'data-disabled',
        '',
      )
      expect(screen.getByRole('menuitem', { name: '删除' })).toHaveAttribute(
        'data-disabled',
        '',
      )
    })

    it('后代有活动任务时父会话菜单也置灰', async () => {
      const user = userEvent.setup()
      const parent = createSession('parent', '父会话')
      const child = createSession(
        'child',
        '子会话',
        { sessionId: 'parent', entryId: 'e1' },
        'running',
      )

      render(
        <SessionLineageTree
          sessions={[parent, child]}
          rootSessions={[parent]}
          selectedSessionId={null}
          {...defaultProps}
        />,
      )

      const item = screen.getByRole('treeitem', { name: /父会话/ })
      await user.hover(item)
      await user.click(screen.getByRole('button', { name: '父会话的操作菜单' }))

      expect(screen.getByText('请先停止运行中的任务')).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: '归档' })).toHaveAttribute(
        'data-disabled',
        '',
      )
    })
  })
})
