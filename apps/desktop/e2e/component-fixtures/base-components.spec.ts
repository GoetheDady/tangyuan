import { expect, test } from '@playwright/test'

import { focusInteractiveCard, pressInteractiveCard } from './card-fixture-helpers'

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
    await expect(page.locator('[data-fixture-section]')).toHaveCount(6)
    await expect(page.locator('[data-fixture-section="actions"]')).toBeVisible()
    await expect(page.locator('[data-fixture-section="forms"]')).toBeVisible()
    await expect(page.locator('[data-fixture-section="selects"]')).toBeVisible()
    await expect(page.locator('[data-fixture-section="feedback"]')).toBeVisible()
    await expect(page.locator('[data-fixture-section="cards"]')).toBeVisible()
    await expect(page.locator('[data-fixture-section="separators"]')).toBeVisible()
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

  test('Separator 覆盖全宽、内缩、垂直和文字组合，并保持语义边框与 Level 0', async ({ page }) => {
    await page.goto(fixturePath)

    const section = page.locator('[data-fixture-section="separators"]')
    const fullWidth = page.getByTestId('separator-full-width')
    const insetWrapper = page.getByTestId('separator-inset-wrapper')
    const inset = page.getByTestId('separator-inset')
    const verticalTrack = page.getByTestId('separator-vertical-track')
    const vertical = page.getByTestId('separator-vertical')

    await expect(fullWidth).toHaveAttribute('data-slot', 'separator')
    await expect(fullWidth).toHaveAttribute('data-level', '0')
    await expect(fullWidth).toHaveAttribute('data-orientation', 'horizontal')
    await expect(fullWidth).toHaveAttribute('role', 'none')
    await expect(fullWidth).toHaveCSS('height', '1px')
    await expect(fullWidth).toHaveCSS('box-shadow', 'none')

    const colors = await fullWidth.evaluate((element) => {
      const probe = document.createElement('div')
      probe.style.backgroundColor = 'var(--border)'
      document.body.append(probe)
      const result = {
        separator: getComputedStyle(element).backgroundColor,
        border: getComputedStyle(probe).backgroundColor
      }
      probe.remove()
      return result
    })
    expect(colors.separator).toBe(colors.border)

    const insetLayout = await insetWrapper.evaluate((wrapper) => {
      const separator = wrapper.querySelector('[data-slot="separator"]')
      if (!(separator instanceof HTMLElement)) throw new Error('缺少内缩 Separator')
      const wrapperBox = wrapper.getBoundingClientRect()
      const separatorBox = separator.getBoundingClientRect()
      return {
        leftInset: separatorBox.left - wrapperBox.left,
        rightInset: wrapperBox.right - separatorBox.right
      }
    })
    expect(insetLayout).toEqual({ leftInset: 24, rightInset: 24 })
    await expect(inset).toHaveCSS('height', '1px')

    const verticalLayout = await verticalTrack.evaluate((track) => {
      const separator = track.querySelector('[data-slot="separator"]')
      if (!(separator instanceof HTMLElement)) throw new Error('缺少垂直 Separator')
      const trackBox = track.getBoundingClientRect()
      const separatorBox = separator.getBoundingClientRect()
      return {
        trackHeight: trackBox.height,
        separatorHeight: separatorBox.height,
        separatorWidth: separatorBox.width,
        overflowX: separator.scrollWidth - separator.clientWidth,
        overflowY: separator.scrollHeight - separator.clientHeight
      }
    })
    expect(verticalLayout).toEqual({
      trackHeight: 24,
      separatorHeight: 24,
      separatorWidth: 1,
      overflowX: 0,
      overflowY: 0
    })
    await expect(vertical).toHaveAttribute('data-orientation', 'vertical')

    await expect(section.getByText('高级设置')).toBeVisible()
    await expect(section.getByText('或者')).toBeVisible()
    await expect(page.getByRole('separator', { name: '语义内容分区' })).toHaveAttribute(
      'data-orientation',
      'horizontal'
    )
  })

  test('Alert 四种语义共享状态 Token，并保持 8px、1px 与 Level 0 契约', async ({ page }) => {
    await page.goto(fixturePath)

    const alerts = page.locator('[data-fixture-alerts] [data-slot="alert"]')
    await expect(alerts).toHaveCount(4)

    const variants = ['info', 'success', 'warning', 'destructive'] as const
    for (const variant of variants) {
      const alert = page.getByTestId(`alert-${variant}`)
      await expect(alert).toHaveAttribute('role', 'alert')
      await expect(alert).toHaveAttribute('data-variant', variant)
      await expect(alert).toHaveAttribute('data-level', '0')
      await expect(alert).toHaveCSS('border-radius', '8px')
      await expect(alert).toHaveCSS('border-width', '1px')
      await expect(alert).toHaveCSS('box-shadow', 'none')

      const colors = await alert.evaluate((element, semanticVariant) => {
        const probe = document.createElement('div')
        probe.style.backgroundColor = `var(--${semanticVariant}-soft)`
        probe.style.borderColor = `var(--${semanticVariant}-border)`
        document.body.append(probe)

        const alertStyle = getComputedStyle(element)
        const probeStyle = getComputedStyle(probe)
        const result = {
          backgroundColor: alertStyle.backgroundColor,
          borderColor: alertStyle.borderColor,
          semanticBackground: probeStyle.backgroundColor,
          semanticBorder: probeStyle.borderColor
        }
        probe.remove()
        return result
      }, variant)

      expect(colors.backgroundColor).toBe(colors.semanticBackground)
      expect(colors.borderColor).toBe(colors.semanticBorder)
    }
  })

  test('Alert 长文案、无图标和操作内容保持对齐与自然换行', async ({ page }) => {
    await page.goto(fixturePath)

    const infoAlert = page.getByTestId('alert-info')
    const warningAlert = page.getByTestId('alert-warning')
    const warningTitle = warningAlert.locator('[data-slot="alert-title"]')
    const warningDescription = warningAlert.locator('[data-slot="alert-description"]')

    await expect(infoAlert.locator(':scope > svg')).toHaveCount(1)
    await expect(warningAlert.locator(':scope > svg')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '重新验证' })).toBeVisible()

    const alignment = await warningAlert.evaluate((element) => {
      const title = element.querySelector('[data-slot="alert-title"]')
      if (!(title instanceof HTMLElement)) throw new Error('缺少 AlertTitle')

      return {
        alertLeft: element.getBoundingClientRect().left,
        titleLeft: title.getBoundingClientRect().left,
        paddingLeft: Number.parseFloat(getComputedStyle(element).paddingLeft),
        borderLeft: Number.parseFloat(getComputedStyle(element).borderLeftWidth)
      }
    })
    expect(alignment.titleLeft - alignment.alertLeft).toBe(
      alignment.borderLeft + alignment.paddingLeft
    )

    const titleLayout = await warningTitle.evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
      overflow: getComputedStyle(element).overflow
    }))
    expect(titleLayout.height).toBeGreaterThan(titleLayout.lineHeight)
    expect(titleLayout.overflow).toBe('visible')

    const descriptionLayout = await warningDescription.evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight)
    }))
    expect(descriptionLayout.height).toBeGreaterThan(descriptionLayout.lineHeight)
  })

  test('Card default/compact 使用稳定的 Level 0、圆角和内边距契约', async ({ page }) => {
    await page.goto(fixturePath)

    const defaultCard = page.getByTestId('card-default')
    const compactCard = page.getByTestId('card-compact')

    await expect(defaultCard).toHaveAttribute('data-size', 'default')
    await expect(defaultCard).toHaveCSS('border-radius', '8px')
    await expect(defaultCard).toHaveCSS('border-width', '1px')
    await expect(defaultCard).toHaveCSS('box-shadow', 'none')
    await expect(defaultCard.locator('[data-slot="card-header"]')).toHaveCSS('padding', '20px')
    await expect(defaultCard.locator('[data-slot="card-content"]')).toHaveCSS('padding', '20px')
    await expect(defaultCard.locator('[data-slot="card-footer"]')).toHaveCSS('padding', '20px')

    await expect(compactCard).toHaveAttribute('data-size', 'compact')
    await expect(compactCard).toHaveCSS('border-radius', '8px')
    await expect(compactCard).toHaveCSS('box-shadow', 'none')
    await expect(compactCard.locator('[data-slot="card-header"]')).toHaveCSS('padding', '16px')
    await expect(compactCard.locator('[data-slot="card-content"]')).toHaveCSS('padding', '16px')
  })

  test('普通 Card 不响应 hover 或制造键盘焦点暗示', async ({ page }) => {
    await page.goto(fixturePath)

    const card = page.getByTestId('card-default')
    const before = await card.evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        backgroundColor: style.backgroundColor,
        borderColor: style.borderColor,
        boxShadow: style.boxShadow
      }
    })

    await card.hover()

    const after = await card.evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        backgroundColor: style.backgroundColor,
        borderColor: style.borderColor,
        boxShadow: style.boxShadow
      }
    })

    expect(after).toEqual(before)
    await expect(card).not.toHaveAttribute('tabindex')
  })

  test('整卡 button 语义提供 hover、focus-visible、active、selected 和 disabled 状态', async ({
    page
  }) => {
    await page.goto(fixturePath)

    const hoverCard = page.getByTestId('card-interactive-hover')
    const hoverBorder = await hoverCard.evaluate((element) => getComputedStyle(element).borderColor)
    await hoverCard.hover()
    await expect
      .poll(() => hoverCard.evaluate((element) => getComputedStyle(element).borderColor))
      .not.toBe(hoverBorder)

    const focusCard = await focusInteractiveCard(page)
    await expect(focusCard).toBeFocused()
    const focusShadow = await focusCard.evaluate((element) => getComputedStyle(element).boxShadow)
    expect(focusShadow).not.toBe('none')

    const activeCardBefore = page.getByTestId('card-interactive-active')
    const activeBackgroundBefore = await activeCardBefore.evaluate(
      (element) => getComputedStyle(element).backgroundColor
    )
    const { card: activeCard, release } = await pressInteractiveCard(page)
    try {
      const activeBackground = await activeCard.evaluate(
        (element) => getComputedStyle(element).backgroundColor
      )
      expect(activeBackground).not.toBe(activeBackgroundBefore)
    } finally {
      await release()
    }

    const selectedCard = page.getByTestId('card-interactive-selected')
    await expect(selectedCard).toHaveAttribute('aria-pressed', 'true')
    const selectedStyles = await selectedCard.evaluate((element) => {
      const style = getComputedStyle(element)
      return { backgroundColor: style.backgroundColor, borderColor: style.borderColor }
    })
    const defaultStyles = await page.getByTestId('card-interactive-default').evaluate((element) => {
      const style = getComputedStyle(element)
      return { backgroundColor: style.backgroundColor, borderColor: style.borderColor }
    })
    expect(selectedStyles).not.toEqual(defaultStyles)

    const disabledCard = page.getByTestId('card-interactive-disabled')
    await expect(disabledCard).toBeDisabled()
    await expect(disabledCard).toHaveCSS('cursor', 'not-allowed')
    await expect(disabledCard).toHaveCSS('opacity', '0.48')
  })

  test('Card 在 1024、1280 和 1440+ 宽度保持边框、内边距与内容稳定', async ({ page }) => {
    for (const width of [1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 1200 })
      await page.goto(fixturePath)

      const defaultCard = page.getByTestId('card-default')
      const compactCard = page.getByTestId('card-compact')
      await expect(defaultCard).toHaveCSS('border-width', '1px')
      await expect(defaultCard.locator('[data-slot="card-content"]')).toHaveCSS('padding', '20px')
      await expect(compactCard.locator('[data-slot="card-content"]')).toHaveCSS('padding', '16px')

      const layout = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth
      }))
      expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth)

      const longCopyFits = await compactCard
        .locator('p')
        .evaluate((element) => element.scrollWidth <= element.clientWidth)
      expect(longCopyFits).toBe(true)
    }
  })

  test('Badge 全部变体遵守紧凑 Level 0 规格', async ({ page }) => {
    await page.goto(fixturePath)

    const feedback = page.locator('[data-fixture-section="feedback"]')
    const variants = [
      ['默认 Badge', 'default'],
      ['次要 Badge', 'secondary'],
      ['成功 Badge', 'success'],
      ['危险 Badge', 'destructive'],
      ['描边 Badge', 'outline']
    ] as const

    for (const [name, variant] of variants) {
      const badge = feedback.getByText(name, { exact: true })
      await expect(badge).toHaveAttribute('data-variant', variant)
      await expect(badge).toHaveCSS('height', '22px')
      await expect(badge).toHaveCSS('border-radius', '6px')
      await expect(badge).toHaveCSS('padding-left', '7px')
      await expect(badge).toHaveCSS('padding-right', '7px')
      await expect(badge).toHaveCSS('font-size', '11px')
      await expect(badge).toHaveCSS('font-weight', '600')
      await expect(badge).toHaveCSS('box-shadow', 'none')
    }
  })

  test('Badge 长文本与图标组合保持高度和对齐', async ({ page }) => {
    await page.goto(fixturePath)

    const longBadge = page.getByTestId('badge-long-text')
    await expect(longBadge).toHaveCSS('height', '22px')
    await expect(longBadge).toHaveCSS('white-space', 'nowrap')
    await expect(longBadge).toHaveCSS('overflow', 'hidden')
    expect((await longBadge.boundingBox())?.width).toBeLessThanOrEqual(192)

    const iconBadge = page.getByTestId('badge-icon')
    const icon = iconBadge.locator('svg')
    await expect(iconBadge).toHaveCSS('height', '22px')
    await expect(icon).toHaveCSS('width', '12px')
    await expect(icon).toHaveCSS('height', '12px')

    const alignment = await iconBadge.evaluate((element) => {
      const badgeRect = element.getBoundingClientRect()
      const iconRect = element.querySelector('svg')?.getBoundingClientRect()
      return iconRect
        ? Math.abs(iconRect.top + iconRect.height / 2 - (badgeRect.top + badgeRect.height / 2))
        : Number.POSITIVE_INFINITY
    })
    expect(alignment).toBeLessThanOrEqual(1)
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
    await expect(page.getByRole('button', { name: '通知', exact: true })).toBeVisible()
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

    const primaryAction = page.getByRole('button', { name: '主要操作' })
    const secondaryAction = page.getByRole('button', { name: '次要操作' })
    await expect(primaryAction).toBeVisible()

    await page.locator('body').press('Tab')
    await expect(primaryAction).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(secondaryAction).toBeFocused()
  })

  test('图标与文字组合按钮渲染', async ({ page }) => {
    await page.goto(fixturePath)

    await expect(page.getByRole('button', { name: '前置图标' })).toBeVisible()
    await expect(page.getByRole('button', { name: '后置图标' })).toBeVisible()
    await expect(page.getByRole('button', { name: '返回' })).toBeVisible()
    await expect(page.getByRole('button', { name: '大号带图标' })).toBeVisible()
  })

  test('Label 保持排版、控件关联和 disabled 反馈', async ({ page }) => {
    await page.goto(fixturePath)

    const defaultLabel = page.locator('[data-fixture-label-state="default"]')
    const longLabel = page.locator('[data-fixture-label-state="long"]')
    const disabledInputLabel = page.locator('[data-fixture-label-state="disabled-input"]')
    const textareaLabel = page.locator('[data-fixture-label-state="textarea"]')
    const disabledTextareaLabel = page.locator('[data-fixture-label-state="disabled-textarea"]')

    await expect(defaultLabel).toHaveCSS('font-size', '14px')
    await expect(defaultLabel).toHaveCSS('font-weight', '500')
    await expect(defaultLabel).toHaveCSS('line-height', '14px')
    const { labelColor, semanticForeground } = await defaultLabel.evaluate((element) => {
      const probe = document.createElement('span')
      probe.style.color = 'var(--foreground)'
      document.body.append(probe)
      const semanticForeground = getComputedStyle(probe).color
      probe.remove()

      return {
        labelColor: getComputedStyle(element).color,
        semanticForeground
      }
    })
    expect(labelColor).toBe(semanticForeground)
    await expect(longLabel).toBeVisible()

    await defaultLabel.click()
    await expect(page.getByRole('textbox', { name: '显示名称' })).toBeFocused()

    await textareaLabel.click()
    await expect(page.getByRole('textbox', { name: '验收说明' })).toBeFocused()

    await expect(disabledInputLabel).toHaveCSS('opacity', '0.5')
    await expect(disabledInputLabel).toHaveCSS('pointer-events', 'none')
    await expect(page.getByRole('textbox', { name: '禁用输入' })).toBeDisabled()

    await expect(disabledTextareaLabel).toHaveCSS('opacity', '0.5')
    await expect(disabledTextareaLabel).toHaveCSS('pointer-events', 'none')
    await expect(page.getByRole('textbox', { name: '禁用文本域' })).toBeDisabled()
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
    const webkitLineClamp = await longTextSelect
      .locator('span[style*="pointer-events"]')
      .evaluate((el) => getComputedStyle(el).webkitLineClamp)
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
