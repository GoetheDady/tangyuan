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

  test('六种 variant 全部渲染且可聚焦', async ({ page }) => {
    await page.goto(fixturePath)

    const variantNames = ['主要操作', '次要操作', '描边操作', '幽灵操作', '危险操作', '链接操作']
    for (const name of variantNames) {
      const button = page.getByRole('button', { name })
      await expect(button).toBeVisible()
      await button.focus()
      await expect(button).toBeFocused()
    }
  })

  test('四种尺寸全部渲染', async ({ page }) => {
    await page.goto(fixturePath)

    const sizeNames = ['超小', '小号', '默认', '大号']
    for (const name of sizeNames) {
      await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
    }
  })

  test('纯图标按钮具备可访问名称', async ({ page }) => {
    await page.goto(fixturePath)

    await expect(page.getByRole('button', { name: '搜索' })).toBeVisible()
    await expect(page.getByRole('button', { name: '设置' })).toBeVisible()
    await expect(page.getByRole('button', { name: '通知' })).toBeVisible()
    await expect(page.getByRole('button', { name: '通知说明' })).toBeVisible()
  })

  test('disabled 按钮无法通过点击触发交互', async ({ page }) => {
    await page.goto(fixturePath)

    const disabledButton = page.getByRole('button', { name: '禁用操作' })
    await expect(disabledButton).toBeDisabled()
  })

  test('aria-invalid 按钮渲染且可点击', async ({ page }) => {
    await page.goto(fixturePath)

    const invalidButton = page.getByRole('button', { name: '无效态' })
    await expect(invalidButton).toBeVisible()
    await expect(invalidButton).toHaveAttribute('aria-invalid', 'true')
    await invalidButton.click()
    // 无报错即通过
  })

  test('长文本按钮截断渲染', async ({ page }) => {
    await page.goto(fixturePath)

    const longTextButton = page.getByRole('button', {
      name: /这段文案会很长很长/
    })
    await expect(longTextButton).toBeVisible()
    // 验证截断样式存在（不检测具体值）
    const overflow = await longTextButton.evaluate((el) => getComputedStyle(el).textOverflow)
    expect(overflow).toBe('ellipsis')
  })

  test('键盘 Tab 可在按钮间连续导航', async ({ page }) => {
    await page.goto(fixturePath)

    // Tab 到 "主要操作"
    await page.locator('body').press('Tab')
    await expect(page.getByRole('button', { name: '主要操作' })).toBeFocused()

    // Tab 到下一个可聚焦的按钮
    await page.keyboard.press('Tab')
    const focusedElement = page.locator(':focus')
    await expect(focusedElement).not.toBeNull()
    const tagName = await focusedElement.evaluate((el) => el.tagName)
    expect(tagName).toBe('BUTTON')
  })

  test('图标与文字组合按钮渲染', async ({ page }) => {
    await page.goto(fixturePath)

    await expect(page.getByRole('button', { name: '前置图标' })).toBeVisible()
    await expect(page.getByRole('button', { name: '后置图标' })).toBeVisible()
    await expect(page.getByRole('button', { name: '返回' })).toBeVisible()
    await expect(page.getByRole('button', { name: '大号带图标' })).toBeVisible()
  })
})
