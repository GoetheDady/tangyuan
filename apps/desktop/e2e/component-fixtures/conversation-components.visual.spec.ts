import { expect, test } from '@playwright/test'

const screenshotOptions = {
  animations: 'disabled' as const,
  caret: 'hide' as const,
  scale: 'css' as const,
}

test.describe('对话业务组件视觉基准', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#/__fixtures__/conversation-components')
    await expect(
      page.locator('[data-fixture="conversation-components-v1"]'),
    ).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
  })

  for (const section of [
    'integrated',
    'message-primitives',
    'assistant-states',
    'conversation-actions',
    'composer-states',
  ]) {
    test(`${section} 保持独立视觉基准`, async ({ page }) => {
      await expect(
        page.locator(`[data-fixture-section="${section}"]`),
      ).toHaveScreenshot(`conversation-${section}.png`, screenshotOptions)
    })
  }

  test('Composer focus-visible 保持视觉基准', async ({ page }) => {
    const integrated = page.getByTestId('integrated-chat')
    await integrated.getByLabel('消息').focus()
    await expect(integrated).toHaveScreenshot(
      'conversation-composer-focused.png',
      screenshotOptions,
    )
  })

  test('完成历史手动展开保持视觉基准', async ({ page }) => {
    const completed = page.getByTestId('assistant-completed')
    await completed.getByRole('button', { name: '已完成执行过程' }).click()
    await expect(completed).toHaveScreenshot(
      'conversation-assistant-expanded.png',
      screenshotOptions,
    )
  })
})
