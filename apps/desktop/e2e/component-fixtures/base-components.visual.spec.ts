import { expect, test, type Locator, type Page } from '@playwright/test'

import { focusInteractiveCard, pressInteractiveCard } from './card-fixture-helpers'

const fixturePath = '/#/__fixtures__/base-components'

const visualSections = [
  { id: 'actions', snapshot: 'actions.png' },
  { id: 'forms', snapshot: 'forms.png' },
  { id: 'selects', snapshot: 'selects.png' },
  { id: 'feedback', snapshot: 'feedback.png' },
  { id: 'cards', snapshot: 'cards.png' }
] as const

const screenshotOptions = {
  animations: 'disabled',
  caret: 'hide',
  scale: 'css'
} as const

test.describe('基础组件视觉回归', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(fixturePath)
    await expect(page.locator('[data-fixture-marker="base-components-fixture-v1"]')).toBeVisible()
  })

  for (const section of visualSections) {
    test(`${section.id} 分区保持视觉基准`, async ({ page }) => {
      await expect(page.locator(`[data-fixture-section="${section.id}"]`)).toHaveScreenshot(
        section.snapshot,
        screenshotOptions
      )
    })
  }

  test('Card hover 状态保持视觉基准', async ({ page }) => {
    const card = page.getByTestId('card-interactive-hover')
    const borderBefore = await card.evaluate((element) => getComputedStyle(element).borderColor)
    await card.hover()
    await expect
      .poll(() => card.evaluate((element) => getComputedStyle(element).borderColor))
      .not.toBe(borderBefore)

    await expectCardStateScreenshot(page, card, 'card-hover.png')
  })

  test('Card focus-visible 状态保持视觉基准', async ({ page }) => {
    const card = await focusInteractiveCard(page)
    await expect(card).toBeFocused()
    expect(await card.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe('none')

    await expectCardStateScreenshot(page, card, 'card-focus-visible.png')
  })

  test('Card active 状态保持视觉基准', async ({ page }) => {
    const cardBefore = page.getByTestId('card-interactive-active')
    const backgroundBefore = await cardBefore.evaluate(
      (element) => getComputedStyle(element).backgroundColor
    )
    const { card, release } = await pressInteractiveCard(page)

    try {
      expect(await card.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(
        backgroundBefore
      )
      await expectCardStateScreenshot(page, card, 'card-active.png')
    } finally {
      await release()
    }
  })
})

async function expectCardStateScreenshot(
  page: Page,
  card: Locator,
  snapshot: string
): Promise<void> {
  const box = await card.boundingBox()
  expect(box).not.toBeNull()

  const padding = 4
  const scroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))
  const session = await page.context().newCDPSession(page)

  try {
    const { data } = await session.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: true,
      clip: {
        x: box!.x + scroll.x - padding,
        y: box!.y + scroll.y - padding,
        width: box!.width + padding * 2,
        height: box!.height + padding * 2,
        scale: 1
      }
    })
    expect(Buffer.from(data, 'base64')).toMatchSnapshot(snapshot)
  } finally {
    await session.detach()
  }
}
