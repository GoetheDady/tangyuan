import { expect, test } from '@playwright/test'

const fixturePath = '/#/__fixtures__/base-components'

test.describe('基础组件验收夹具', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      let apiReadCount = 0

      Object.defineProperty(window, 'api', {
        configurable: true,
        get() {
          apiReadCount += 1
          throw new Error('组件验收夹具不应读取 Preload API')
        }
      })
      Object.defineProperty(window, '__fixtureApiReadCount', {
        configurable: true,
        get() {
          return apiReadCount
        }
      })
    })
  })

  test('直接打开内部路由并展示稳定的组件分区，且不读取 Preload API', async ({ page }) => {
    await page.goto(fixturePath)

    await expect(page.getByRole('heading', { name: '基础组件验收夹具', level: 1 })).toBeVisible()
    await expect(page.locator('[data-fixture-section]')).toHaveCount(3)
    await expect(page.locator('[data-fixture-section="actions"]')).toBeVisible()
    await expect(page.locator('[data-fixture-section="forms"]')).toBeVisible()
    await expect(page.locator('[data-fixture-section="feedback"]')).toBeVisible()
    await expect(page.locator('[data-fixture-marker="base-components-fixture-v1"]')).toBeVisible()

    const apiReadCount = await page.evaluate(
      () =>
        (window as typeof window & { __fixtureApiReadCount?: number }).__fixtureApiReadCount ?? -1
    )
    expect(apiReadCount).toBe(0)
  })

  test('键盘导航把焦点移动到首个主要操作', async ({ page }) => {
    await page.goto(fixturePath)

    const primaryAction = page.getByRole('button', { name: '主要操作' })
    await expect(primaryAction).toBeVisible()
    await page.locator('body').press('Tab')

    await expect(primaryAction).toBeFocused()
    await expect(primaryAction).toHaveCSS('outline-style', 'none')
    const boxShadow = await primaryAction.evaluate((element) => getComputedStyle(element).boxShadow)
    expect(boxShadow).not.toBe('none')
  })

  test('AlertDialog Portal 与 Toaster 可以在真实 Chromium 中交互', async ({ page }) => {
    await page.goto(fixturePath)

    await page.getByRole('button', { name: '打开确认对话框' }).click()
    const dialog = page.getByRole('alertdialog', { name: '确认验收动作' })
    await expect(dialog).toBeVisible()

    const dialogLivesOutsideFixture = await dialog.evaluate((element) => {
      const fixture = document.querySelector('[data-fixture-marker="base-components-fixture-v1"]')
      return fixture instanceof HTMLElement && !fixture.contains(element)
    })
    expect(dialogLivesOutsideFixture).toBe(true)

    await page.getByRole('button', { name: '取消' }).click()
    await expect(dialog).toBeHidden()

    await page.getByRole('button', { name: '显示验收通知' }).click()
    await expect(page.getByText('组件验收通知已显示')).toBeVisible()
  })
})
