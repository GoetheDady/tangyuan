import { expect, test } from '@playwright/test'
import type { AgentSessionSummary } from '@tangyuan/contracts'

import {
  createPreloadApiInitScript,
  createReadyRuntimeSnapshot,
} from '../fixtures/preload-mock'

test('预览活动会话后归档并恢复整棵会话谱系', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  const sessions: AgentSessionSummary[] = [
    {
      agentId: 'tangyuan',
      sessionId: 'parent-session',
      title: '父会话',
      state: 'running',
      updatedAt: '2026-07-29T08:00:00.000Z',
    },
    {
      agentId: 'tangyuan',
      sessionId: 'child-session',
      title: '子会话',
      state: 'queued',
      updatedAt: '2026-07-29T08:01:00.000Z',
      forkedFrom: { sessionId: 'parent-session', entryId: 'source-message' },
    },
    {
      agentId: 'tangyuan',
      sessionId: 'sibling-session',
      title: '兄弟会话',
      state: 'idle',
      updatedAt: '2026-07-29T07:00:00.000Z',
    },
  ]
  await page.addInitScript({
    content: createPreloadApiInitScript(
      createReadyRuntimeSnapshot(),
      sessions,
      [],
      {
        agentId: 'tangyuan',
        sessionId: 'parent-session',
        updatedAt: '2026-07-29T08:00:00.000Z',
      },
    ),
  })

  await page.goto('/#/chat/tangyuan/parent-session')
  await page.getByRole('button', { name: '归档当前会话谱系' }).click()

  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('父会话：运行中')
  await expect(dialog).toContainText('子会话：排队中')
  await dialog.getByRole('button', { name: '取消' }).click()
  await expect(page.getByRole('heading', { name: '父会话' })).toBeVisible()

  await page.getByRole('button', { name: '归档当前会话谱系' }).click()
  await dialog.getByRole('button', { name: '停止活动并归档' }).click()

  await expect(page).toHaveURL(/#\/chat\/tangyuan$/)
  await expect(page.getByRole('treeitem', { name: /兄弟会话/ })).toBeVisible()
  await expect(page.getByRole('treeitem', { name: /父会话/ })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '已归档' })).toBeVisible()

  await page.getByRole('button', { name: '恢复「父会话」会话谱系' }).click()
  await expect(page.getByRole('treeitem', { name: /父会话/ })).toHaveAttribute(
    'aria-level',
    '1',
  )
  await expect(page.getByRole('treeitem', { name: /子会话/ })).toHaveAttribute(
    'aria-level',
    '2',
  )
  expect(consoleErrors).toEqual([])
})
