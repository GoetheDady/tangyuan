import { expect, test } from '@playwright/test'

const screenshotOptions = {
  animations: 'disabled' as const,
  caret: 'hide' as const,
  scale: 'css' as const
}

test.describe('对话业务组件视觉基准', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#/__fixtures__/conversation-components')
    await expect(page.locator('[data-fixture="conversation-components-v1"]')).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
  })

  for (const section of [
    'integrated',
    'message-primitives',
    'assistant-states',
    'conversation-actions',
    'composer-states'
  ]) {
    test(`${section} 保持独立视觉基准`, async ({ page }) => {
      await expect(page.locator(`[data-fixture-section="${section}"]`)).toHaveScreenshot(
        `conversation-${section}.png`,
        screenshotOptions
      )
    })
  }

  test('Bash Approval 已确认状态保持视觉基准', async ({ page }) => {
    const approval = page.locator('[data-approval-scenario="once"]')
    await approval.getByRole('button', { name: '仅允许本次执行此命令' }).click()
    await expect(approval.getByText('已处理')).toBeVisible()
    await expect(approval).toHaveScreenshot('conversation-approval-resolved.png', screenshotOptions)
  })

  test('Question Clarification 已确认状态保持视觉基准', async ({ page }) => {
    const clarification = page.getByTestId('clarification-sequence')
    await clarification.getByRole('radio', { name: '选择：1280' }).click()
    await expect(clarification.getByRole('status')).toContainText('已确认：1280')
    await expect(clarification).toHaveScreenshot(
      'conversation-clarification-confirmed.png',
      screenshotOptions
    )
  })

  test('Composer focus-visible 保持视觉基准', async ({ page }) => {
    const integrated = page.getByTestId('integrated-chat')
    await integrated.getByLabel('消息').focus()
    await expect(integrated).toHaveScreenshot(
      'conversation-composer-focused.png',
      screenshotOptions
    )
  })

  test('完成历史手动展开保持视觉基准', async ({ page }) => {
    const completed = page.getByTestId('assistant-completed')
    await completed.getByRole('button', { name: '已完成执行过程' }).click()
    await expect(completed).toHaveScreenshot(
      'conversation-assistant-expanded.png',
      screenshotOptions
    )
  })
})
