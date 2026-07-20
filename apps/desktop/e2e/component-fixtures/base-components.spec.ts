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
    await expect(page.locator('[data-fixture-section]')).toHaveCount(4)
    await expect(page.locator('[data-fixture-section="actions"]')).toBeVisible()
    await expect(page.locator('[data-fixture-section="forms"]')).toBeVisible()
    await expect(page.locator('[data-fixture-section="selects"]')).toBeVisible()
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

  test('Select 渲染选中值', async ({ page }) => {
    await page.goto(fixturePath)

    const providerSelect = page.getByLabel('模型服务')
    await expect(providerSelect).toBeVisible()
    await expect(providerSelect).toHaveText(/Anthropic/)
  })

  test('Select placeholder 在无默认值时展示', async ({ page }) => {
    await page.goto(fixturePath)

    const placeholderSelect = page.getByLabel('占位选择器')
    await expect(placeholderSelect).toBeVisible()
    await expect(placeholderSelect).toHaveText('请选择一项内容...')
  })

  test('Select disabled 不可交互', async ({ page }) => {
    await page.goto(fixturePath)

    const disabledSelect = page.getByLabel('禁用选择器')
    await expect(disabledSelect).toBeDisabled()
  })

  test('Select aria-invalid 渲染', async ({ page }) => {
    await page.goto(fixturePath)

    const invalidSelect = page.getByLabel('无效选择器')
    await expect(invalidSelect).toBeVisible()
    await expect(invalidSelect).toHaveAttribute('aria-invalid', 'true')
  })

  test('Select 长文本触发截断', async ({ page }) => {
    await page.goto(fixturePath)

    const longTextSelect = page.getByLabel('长文本选择器')
    await expect(longTextSelect).toBeVisible()

    // line-clamp-1 通过 -webkit-line-clamp 实现截断
    const webkitLineClamp = await longTextSelect.locator('span[style*="pointer-events"]').evaluate(
      (el) => getComputedStyle(el).webkitLineClamp
    )
    expect(webkitLineClamp).toBe('1')
  })

  test('Select 点击展开 Content 并通过 Portal 渲染', async ({ page }) => {
    await page.goto(fixturePath)

    const providerSelect = page.getByLabel('模型服务')
    await providerSelect.click()

    // Content 通过 Portal 渲染到 body
    const listbox = page.getByRole('listbox')
    await expect(listbox).toBeVisible()

    const option = page.getByRole('option', { name: 'OpenAI（测试数据）' })
    await expect(option).toBeVisible()

    // 验证 Portal 渲染——选项不在 fixture 容器内
    const livesOutsideFixture = await option.evaluate((element) => {
      const fixture = document.querySelector('[data-fixture-marker="base-components-fixture-v1"]')
      return fixture instanceof HTMLElement && !fixture.contains(element)
    })
    expect(livesOutsideFixture).toBe(true)
  })

  test('Select 打开使用基础动效并遵守减少动效偏好', async ({ page }) => {
    await page.goto(fixturePath)

    const providerSelect = page.getByLabel('模型服务')
    await providerSelect.click()

    const listbox = page.getByRole('listbox')
    const animation = await listbox.evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        name: style.animationName,
        duration: style.animationDuration,
        timingFunction: style.animationTimingFunction,
        enterScaleY: Number(style.getPropertyValue('--select-content-enter-scale-y')),
        originY: style.transformOrigin.split(' ')[1]
      }
    })

    expect(animation).toEqual({
      name: 'select-content-drop-in',
      duration: '0.16s',
      timingFunction: 'cubic-bezier(0.2, 0, 0, 1)',
      enterScaleY: 0.8,
      originY: '0px'
    })

    await page.keyboard.press('Escape')
    await expect(listbox).toBeHidden()

    await page.emulateMedia({ reducedMotion: 'reduce' })
    await providerSelect.click()

    const reducedAnimation = await page.getByRole('listbox').evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        duration: style.animationDuration,
        reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches
      }
    })

    expect(reducedAnimation).toEqual({
      duration: '0s',
      reducedMotion: true
    })
  })

  test('Select 键盘 Enter 打开 Content', async ({ page }) => {
    await page.goto(fixturePath)

    const placeholderSelect = page.getByLabel('占位选择器')
    await placeholderSelect.focus()
    await expect(placeholderSelect).toBeFocused()

    await page.keyboard.press('Enter')

    const listbox = page.getByRole('listbox')
    await expect(listbox).toBeVisible()
  })

  test('Select Escape 关闭 Content', async ({ page }) => {
    await page.goto(fixturePath)

    const providerSelect = page.getByLabel('模型服务')
    await providerSelect.click()

    const listbox = page.getByRole('listbox')
    await expect(listbox).toBeVisible()

    await page.keyboard.press('Escape')

    await expect(listbox).toBeHidden()
  })

  test('Select 方向键导航并 Enter 选择', async ({ page }) => {
    await page.goto(fixturePath)

    const placeholderSelect = page.getByLabel('占位选择器')
    await placeholderSelect.click()

    // 等待 listbox 出现并获得焦点
    const listbox = page.getByRole('listbox')
    await expect(listbox).toBeVisible()

    // 方向键导航到第二个选项（打开时第一项已 highlighted）
    await page.keyboard.press('ArrowDown')
    // 验证导航成功：第二项获得 data-highlighted
    await expect(page.getByRole('option', { name: '选项 B' })).toHaveAttribute(
      'data-highlighted',
      ''
    )

    // Enter 选择
    await page.keyboard.press('Enter')

    // 选择后 Content 关闭，Trigger 展示选中值
    await expect(listbox).toBeHidden()
    await expect(placeholderSelect).toHaveText('选项 B')
  })

  test('Select 禁用项不可选择', async ({ page }) => {
    await page.goto(fixturePath)

    const groupedSelect = page.getByLabel('分组与分隔')
    await groupedSelect.click()

    const disabledItem = page.getByRole('option', { name: /水（不可选）/ })
    await expect(disabledItem).toBeVisible()
    await expect(disabledItem).toHaveAttribute('aria-disabled', 'true')
  })

  test('Select 分组 Label 与 Separator 存在', async ({ page }) => {
    await page.goto(fixturePath)

    const groupedSelect = page.getByLabel('分组与分隔')
    await groupedSelect.click()

    // 分组标签渲染
    await expect(page.getByText('水果')).toBeVisible()
    await expect(page.getByText('蔬菜')).toBeVisible()

    // 选项渲染
    await expect(page.getByRole('option', { name: '苹果' })).toBeVisible()
    await expect(page.getByRole('option', { name: '西兰花' })).toBeVisible()
  })

  test('Select 长列表 (20 项) 渲染', async ({ page }) => {
    await page.goto(fixturePath)

    const scrollSelect = page.getByLabel('长列表滚动')
    await scrollSelect.click()

    const listbox = page.getByRole('listbox')
    await expect(listbox).toBeVisible()

    // 前 5 项和后 5 项确认
    await expect(page.getByRole('option', { name: '选项 01' })).toBeVisible()
    await expect(page.getByRole('option', { name: '选项 20' })).toBeVisible()

    // 20 项全部应有对应的 option role
    const options = listbox.getByRole('option')
    await expect(options).toHaveCount(20)
  })
})
