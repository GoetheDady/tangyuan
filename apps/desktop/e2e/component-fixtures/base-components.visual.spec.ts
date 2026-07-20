import { expect, test } from '@playwright/test'

const fixturePath = '/#/__fixtures__/base-components'

const visualSections = [
  { id: 'actions', snapshot: 'actions.png' },
  { id: 'forms', snapshot: 'forms.png' },
  { id: 'selects', snapshot: 'selects.png' },
  { id: 'feedback', snapshot: 'feedback.png' }
] as const

test.describe('基础组件视觉回归', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(fixturePath)
    await expect(page.locator('[data-fixture-marker="base-components-fixture-v1"]')).toBeVisible()
  })

  for (const section of visualSections) {
    test(`${section.id} 分区保持视觉基准`, async ({ page }) => {
      await expect(page.locator(`[data-fixture-section="${section.id}"]`)).toHaveScreenshot(
        section.snapshot,
        {
          animations: 'disabled',
          caret: 'hide',
          scale: 'css'
        }
      )
    })
  }
})
