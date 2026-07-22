import { expect, test } from '@playwright/test'

import { createPreloadApiInitScript, createReadyRuntimeSnapshot } from '../fixtures/preload-mock'

const screenshotOptions = {
  animations: 'disabled' as const,
  caret: 'hide' as const,
  scale: 'css' as const
}

test.describe('ChatPage Pencil 视觉基准', () => {
  test.use({ viewport: { width: 1168, height: 820 } })

  test('真实页面骨架与消息流保持 Pencil 基准', async ({ page }) => {
    const runtime = createReadyRuntimeSnapshot()
    const tangyuan = runtime.agents[0]!
    const today = new Date()
    today.setHours(14, 32, 0, 0)
    const earlier = new Date(today)
    earlier.setDate(earlier.getDate() - 3)

    const initScript = createPreloadApiInitScript(
      {
        ...runtime,
        agents: [
          tangyuan,
          { ...tangyuan, agentId: 'research', displayName: '研究' },
          { ...tangyuan, agentId: 'code', displayName: '代码' }
        ]
      },
      [
        {
          agentId: 'tangyuan',
          sessionId: 'session-1',
          title: '数据库迁移上线评估',
          state: 'running',
          updatedAt: today.toISOString()
        },
        {
          agentId: 'tangyuan',
          sessionId: 'session-2',
          title: '修复登录状态丢失',
          state: 'idle',
          updatedAt: today.toISOString()
        },
        {
          agentId: 'tangyuan',
          sessionId: 'session-3',
          title: '整理用户反馈',
          state: 'completed',
          updatedAt: earlier.toISOString()
        }
      ],
      [
        {
          messageId: 'user-message-1',
          agentId: 'tangyuan',
          sessionId: 'session-1',
          role: 'user',
          content: '这个项目的数据库迁移方案评估得怎么样了？我想了解一下目前的进度。',
          createdAt: today.toISOString()
        },
        {
          messageId: 'agent-message-1',
          agentId: 'tangyuan',
          sessionId: 'session-1',
          role: 'agent',
          content:
            '数据库迁移评估进展顺利。全部 12 张表的 schema 差异已经通过检查，回滚脚本也已就绪。建议周五凌晨执行迁移。',
          createdAt: new Date(today.getTime() + 12_000).toISOString()
        }
      ]
    )

    await page.addInitScript({ content: initScript })
    await page.goto('/#/chat/tangyuan/session-1')
    await expect(page.getByTestId('chat-sidebar')).toBeVisible()
    await expect(page.getByTestId('composer-card')).toBeVisible()
    await page.evaluate(() => document.fonts.ready)

    await expect(page).toHaveScreenshot('chat-page-pencil.png', screenshotOptions)
  })
})
