import { expect, test, type Locator, type Page } from '@playwright/test'

import { focusInteractiveCard, pressInteractiveCard } from './card-fixture-helpers'

const fixturePath = '/#/__fixtures__/base-components'

const visualSections = [
  { id: 'actions', snapshot: 'actions.png' },
  { id: 'separators', snapshot: 'separators.png' },
  { id: 'forms', snapshot: 'forms.png' },
  { id: 'selects', snapshot: 'selects.png' },
  { id: 'dropdown-menus', snapshot: 'dropdown-menus.png' },
  { id: 'feedback', snapshot: 'feedback.png' },
  { id: 'alert-dialogs', snapshot: 'alert-dialogs.png' },
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

  const alertDialogScenarios = [
    {
      trigger: '打开 default 对话框',
      title: '确认验收动作',
      snapshot: 'alert-dialog-default-open.png'
    },
    {
      trigger: '打开 sm 对话框',
      title: '切换默认模型？',
      snapshot: 'alert-dialog-sm-open.png'
    },
    {
      trigger: '打开危险确认',
      title: '确认归档这个 Agent？',
      snapshot: 'alert-dialog-destructive-open.png'
    },
    {
      trigger: '打开长内容对话框',
      title: '确认将“研究资料整理与长期知识维护 Agent”归档？',
      snapshot: 'alert-dialog-long-content-open.png'
    }
  ] as const

  for (const scenario of alertDialogScenarios) {
    test(`AlertDialog ${scenario.title} 保持打开状态视觉基准`, async ({ page }) => {
      await page.getByRole('button', { name: scenario.trigger }).click()
      await expect(page.getByRole('alertdialog', { name: scenario.title })).toBeVisible()
      await expect(page).toHaveScreenshot(scenario.snapshot, screenshotOptions)
    })
  }

  test('DropdownMenu 普通操作保持打开状态视觉基准', async ({ page }) => {
    await page.getByRole('button', { name: '菜单：普通操作' }).click()
    const content = page.getByTestId('dropdown-menu-actions-content')
    await expect(content).toBeVisible()
    await expect(content).toHaveScreenshot('dropdown-menu-actions-open.png', screenshotOptions)
  })

  test('DropdownMenu Checkbox 与 Radio 已选状态保持视觉基准', async ({ page }) => {
    await page.getByRole('button', { name: '菜单：Checkbox' }).click()
    const checkboxContent = page.getByTestId('dropdown-menu-checkbox-content')
    await expect(checkboxContent).toBeVisible()
    await expect(checkboxContent).toHaveScreenshot(
      'dropdown-menu-checkbox-open.png',
      screenshotOptions
    )

    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '菜单：Radio' }).click()
    const radioContent = page.getByTestId('dropdown-menu-radio-content')
    await expect(radioContent).toBeVisible()
    await expect(radioContent).toHaveScreenshot('dropdown-menu-radio-open.png', screenshotOptions)
  })

  test('DropdownMenu 嵌套菜单保持打开状态视觉基准', async ({ page }) => {
    const sample = page.getByTestId('dropdown-menu-submenu-sample')
    await sample.scrollIntoViewIfNeeded()

    const trigger = page.getByRole('button', { name: '菜单：受控子菜单' })
    await trigger.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('dropdown-menu-controlled-root-content')).toBeVisible()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('menuitem', { name: '共享到' })).toHaveAttribute(
      'data-highlighted',
      ''
    )
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('dropdown-menu-controlled-sub-content')).toBeVisible()

    await expect(page).toHaveScreenshot('dropdown-menu-submenu-open.png', screenshotOptions)
  })

  test('Alert 语义与内容组合保持分区视觉基准', async ({ page }) => {
    await expect(page.locator('[data-fixture-alerts]')).toHaveScreenshot(
      'alerts.png',
      screenshotOptions
    )
  })

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
