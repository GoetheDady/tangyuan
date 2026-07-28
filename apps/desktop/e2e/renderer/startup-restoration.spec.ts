import { expect, test } from '@playwright/test'
import type { AgentSessionSummary } from '@tangyuan/contracts'
import {
  createPreloadApiInitScript,
  createReadyRuntimeSnapshot
} from '../fixtures/preload-mock'

test('启动时恢复最后激活的自定义 Agent 分叉会话', async ({ page }) => {
  const runtime = createReadyRuntimeSnapshot()
  runtime.agents.push({
    agentId: 'agent-2',
    displayName: '研究助手',
    status: 'active',
    defaultProviderId: 'anthropic',
    defaultModelId: 'claude-sonnet-4-5',
    homePath: '~/.tangyuan/agents/agent-2',
    archivedAt: null,
    directoryStatus: 'healthy'
  })
  const sessions: AgentSessionSummary[] = [
    {
      agentId: 'tangyuan',
      sessionId: 'default-session',
      title: '默认会话',
      state: 'idle',
      updatedAt: '2026-07-28T12:00:00.000Z'
    },
    {
      agentId: 'agent-2',
      sessionId: 'parent-session',
      title: '研究主线',
      state: 'idle',
      updatedAt: '2026-07-28T08:00:00.000Z'
    },
    {
      agentId: 'agent-2',
      sessionId: 'fork-session',
      title: '研究分叉',
      state: 'idle',
      updatedAt: '2026-07-28T09:00:00.000Z',
      forkedFrom: { sessionId: 'parent-session', entryId: 'message-1' }
    }
  ]
  await page.addInitScript({
    content: createPreloadApiInitScript(runtime, sessions, [], {
      agentId: 'agent-2',
      sessionId: 'fork-session',
      updatedAt: '2026-07-28T10:00:00.000Z'
    })
  })

  await page.goto('/#/')

  await expect(page).toHaveURL(/#\/chat\/agent-2\/fork-session$/)
  await expect(page.getByRole('heading', { name: '研究分叉' })).toBeVisible()
  await expect(page.getByRole('button', { name: '切换到 Agent 研究助手' })).toHaveAttribute(
    'aria-current',
    'page'
  )
  await expect(page.getByRole('treeitem', { name: /研究主线/ })).toHaveAttribute('aria-level', '1')
  await expect(page.getByRole('treeitem', { name: /研究分叉/ })).toHaveAttribute('aria-level', '2')
  await expect(page.getByText('分叉自「研究主线」')).toBeVisible()
  await expect(page.getByRole('combobox', { name: '模型' })).toHaveText('Claude Sonnet 4.5')
})
