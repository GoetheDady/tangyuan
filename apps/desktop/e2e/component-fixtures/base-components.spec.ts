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

  test('文本框默认值和长值渲染', async ({ page }) => {
    await page.goto(fixturePath)

    const nameInput = page.getByLabel('显示名称')
    await expect(nameInput).toBeVisible()
    await expect(nameInput).toHaveValue('汤圆')

    const longValueInput = page.getByLabel('长值输入')
    await expect(longValueInput).toBeVisible()
    await expect(longValueInput).toHaveValue(/这段文案会很长/)
  })

  test('password 类型输入渲染并遮盖值', async ({ page }) => {
    await page.goto(fixturePath)

    const passwordInput = page.getByLabel('API Key')
    await expect(passwordInput).toBeVisible()
    await expect(passwordInput).toHaveAttribute('type', 'password')
  })

  test('placeholder 输入渲染', async ({ page }) => {
    await page.goto(fixturePath)

    const placeholderInput = page.getByPlaceholder('请输入内容...')
    await expect(placeholderInput).toBeVisible()
    await expect(placeholderInput).toHaveValue('')
  })

  test('disabled 输入不可编辑', async ({ page }) => {
    await page.goto(fixturePath)

    const disabledInput = page.getByLabel('禁用输入')
    await expect(disabledInput).toBeDisabled()
  })

  test('read-only 输入渲染且可聚焦', async ({ page }) => {
    await page.goto(fixturePath)

    const readonlyInput = page.getByLabel('只读输入')
    await expect(readonlyInput).toBeVisible()
    await expect(readonlyInput).toHaveValue('只读内容')
    await readonlyInput.focus()
    await expect(readonlyInput).toBeFocused()
  })

  test('aria-invalid 输入渲染且可交互', async ({ page }) => {
    await page.goto(fixturePath)

    const invalidInput = page.getByLabel('无效输入')
    await expect(invalidInput).toBeVisible()
    await expect(invalidInput).toHaveAttribute('aria-invalid', 'true')
    await invalidInput.click()
    // 无报错即通过
  })

  test('required 输入渲染', async ({ page }) => {
    await page.goto(fixturePath)

    const requiredInput = page.getByLabel('必填输入')
    await expect(requiredInput).toBeVisible()
    // HTML required 属性由浏览器处理
  })

  test('file 类型输入渲染', async ({ page }) => {
    await page.goto(fixturePath)

    const fileInput = page.getByLabel('文件上传')
    await expect(fileInput).toBeVisible()
    await expect(fileInput).toHaveAttribute('type', 'file')
  })

  test('键盘 Tab 可在输入框间连续导航', async ({ page }) => {
    await page.goto(fixturePath)

    // 先用多次 Tab 跳过按钮区域，定位到第一个 Input
    // 通过点击 Label 直接聚焦确保导航正确
    await page.getByLabel('显示名称').focus()
    await expect(page.getByLabel('显示名称')).toBeFocused()

    // Tab 到下一个输入框
    await page.keyboard.press('Tab')
    const focusedAfterTab = page.locator(':focus')
    await expect(focusedAfterTab).not.toBeNull()
    const tagName = await focusedAfterTab.evaluate((el) => el.tagName)
    expect(tagName).toBe('INPUT')
  })

  test('Textarea 默认值和占位渲染', async ({ page }) => {
    await page.goto(fixturePath)

    const notesTextarea = page.getByLabel('验收说明')
    await expect(notesTextarea).toBeVisible()
    await expect(notesTextarea).toHaveValue('固定测试数据，不包含真实 API Key。')

    const emptyTextarea = page.getByLabel('空文本域')
    await expect(emptyTextarea).toBeVisible()
    await expect(emptyTextarea).toHaveAttribute('placeholder', '请输入多行内容...')
    await expect(emptyTextarea).toHaveValue('')
  })

  test('Textarea 多行内容渲染', async ({ page }) => {
    await page.goto(fixturePath)

    const multilineTextarea = page.getByLabel('多行内容')
    await expect(multilineTextarea).toBeVisible()
    await expect(multilineTextarea).toHaveValue(/第一行内容/)
  })

  test('Textarea 超长行不溢出父布局', async ({ page }) => {
    await page.goto(fixturePath)

    const longLineTextarea = page.getByLabel('超长行内容')
    await expect(longLineTextarea).toBeVisible()

    // 验证文本域自身不会比父容器宽
    const parentWidth = await longLineTextarea.evaluate((el) => {
      const parent = el.closest('[class*="field"]')
      return parent instanceof HTMLElement ? parent.offsetWidth : null
    })
    const textareaWidth = await longLineTextarea.evaluate((el) => el.offsetWidth)
    if (parentWidth !== null) {
      expect(textareaWidth).toBeLessThanOrEqual(parentWidth)
    }
  })

  test('Textarea rows 属性控制初始高度', async ({ page }) => {
    await page.goto(fixturePath)

    const tallTextarea = page.getByLabel('指定高度')
    await expect(tallTextarea).toBeVisible()
    await expect(tallTextarea).toHaveAttribute('rows', '8')
  })

  test('Textarea 可拖拽调整大小', async ({ page }) => {
    await page.goto(fixturePath)

    const resizableTextarea = page.getByLabel('可拖拽调整大小')
    await expect(resizableTextarea).toBeVisible()

    const resize = await resizableTextarea.evaluate((el) => getComputedStyle(el).resize)
    // 默认 resize-vertical，若 className 覆盖为 resize 则应为 both 或 horizontal
    expect(['vertical', 'both', 'horizontal']).toContain(resize)
  })

  test('Textarea disabled 不可编辑', async ({ page }) => {
    await page.goto(fixturePath)

    const disabledTextarea = page.getByLabel('禁用文本域')
    await expect(disabledTextarea).toBeDisabled()
  })

  test('Textarea aria-invalid 渲染且可交互', async ({ page }) => {
    await page.goto(fixturePath)

    const invalidTextarea = page.getByLabel('无效文本域')
    await expect(invalidTextarea).toBeVisible()
    await expect(invalidTextarea).toHaveAttribute('aria-invalid', 'true')
    await invalidTextarea.click()
    // 无报错即通过
  })

  test('Textarea required 渲染', async ({ page }) => {
    await page.goto(fixturePath)

    const requiredTextarea = page.getByLabel('必填文本域')
    await expect(requiredTextarea).toBeVisible()
  })

  test('键盘 Tab 可聚焦到 Textarea', async ({ page }) => {
    await page.goto(fixturePath)

    // 直接聚焦验证真实键盘焦点
    await page.getByLabel('验收说明').focus()
    await expect(page.getByLabel('验收说明')).toBeFocused()

    // Tab 导航到下一个 Textarea
    await page.keyboard.press('Tab')
    const focusedElement = page.locator(':focus')
    await expect(focusedElement).not.toBeNull()
    const tagName = await focusedElement.evaluate((el) => el.tagName)
    expect(tagName).toBe('TEXTAREA')
  })
})
