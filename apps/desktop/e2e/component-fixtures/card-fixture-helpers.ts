import type { Locator, Page } from '@playwright/test'

export async function focusInteractiveCard(page: Page): Promise<Locator> {
  const previousCard = page.getByTestId('card-interactive-hover')
  const card = page.getByTestId('card-interactive-focus')
  await previousCard.focus()
  await page.keyboard.press('Tab')
  return card
}

export async function pressInteractiveCard(
  page: Page
): Promise<{ card: Locator; release: () => Promise<void> }> {
  const card = page.getByTestId('card-interactive-active')
  await card.scrollIntoViewIfNeeded()
  const box = await card.boundingBox()

  if (!box) {
    throw new Error('无法获取 active Card 的边界')
  }

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()

  return {
    card,
    release: () => page.mouse.up()
  }
}
