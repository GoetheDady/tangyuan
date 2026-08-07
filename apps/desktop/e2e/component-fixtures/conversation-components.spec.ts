import { expect, test, type Locator, type Page } from '@playwright/test'

const fixtureUrl = '/#/__fixtures__/conversation-components'

test.describe('对话业务组件验收夹具', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(fixtureUrl)
    await expect(
      page.locator('[data-fixture="conversation-components-v1"]'),
    ).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
  })

  test('完整展示 Composer、消息流、执行历史与压缩', async ({
    page,
  }) => {
    await expect(
      page.getByRole('heading', { name: '对话业务组件跨组件验收' }),
    ).toBeVisible()
    for (const title of [
      '完整消息流',
      '消息原语',
      'AssistantMessage 状态矩阵',
      'Composer 状态矩阵',
      '长内容与虚拟列表',
    ]) {
      await expect(page.getByRole('heading', { name: title })).toBeVisible()
    }

    await expect(
      page.getByText('请对完整对话体验做一次跨组件验收。'),
    ).toBeVisible()
    await expect(page.getByText('自动压缩').first()).toBeVisible()
    await expect(page.getByTestId('assistant-tool-loop')).toBeVisible()
    await expect(page.getByTestId('assistant-candidate')).toBeVisible()
    await expect(page.getByTestId('assistant-failed')).toBeVisible()
    await expect(page.getByTestId('assistant-cancelled')).toBeVisible()
  })

  test('用户消息 hover 时才在气泡下方同一行显示时间和单个分叉图标', async ({
    page,
  }) => {
    const integrated = page.getByTestId('integrated-chat')
    const article = integrated
      .locator('article')
      .filter({ hasText: '请对完整对话体验做一次跨组件验收。' })
    const message = article.getByText('请对完整对话体验做一次跨组件验收。', {
      exact: true,
    })
    const footer = article.locator('footer')
    const time = footer.locator('time')
    const forkButton = article.getByRole('button', { name: '从此处分叉' })

    await expect(article).toHaveCount(1)
    await expect(forkButton).toHaveCount(1)
    const articleBox = await article.boundingBox()
    const bubbleBox = await message.locator('..').boundingBox()
    expect(articleBox).not.toBeNull()
    expect(bubbleBox).not.toBeNull()

    await page.mouse.move(
      articleBox!.x + 1,
      bubbleBox!.y + bubbleBox!.height / 2,
    )
    await expect(footer).toHaveCSS('opacity', '0')
    await message.locator('..').hover()
    await expect(footer).toHaveCSS('opacity', '1')
    await expect(forkButton).toHaveText('')
    await expect(forkButton.locator('svg')).toHaveCount(1)

    const footerBox = await footer.boundingBox()
    const timeBox = await time.boundingBox()
    const buttonBox = await forkButton.boundingBox()
    expect(footerBox).not.toBeNull()
    expect(timeBox).not.toBeNull()
    expect(buttonBox).not.toBeNull()
    expect(footerBox!.y).toBeGreaterThanOrEqual(
      bubbleBox!.y + bubbleBox!.height,
    )
    expect(
      Math.abs(
        timeBox!.y +
          timeBox!.height / 2 -
          (buttonBox!.y + buttonBox!.height / 2),
      ),
    ).toBeLessThanOrEqual(2)

    await forkButton.hover()
    await expect(footer).toHaveCSS('opacity', '1')
  })

  test('附件入口保持禁用占位且不出现文件选择器或附件预览', async ({ page }) => {
    const attachmentButtons = page.getByRole('button', {
      name: '附件功能暂未开放',
    })
    expect(await attachmentButtons.count()).toBeGreaterThanOrEqual(3)
    for (const button of await attachmentButtons.all()) {
      await expect(button).toBeDisabled()
    }
    await expect(page.locator('input[type="file"]')).toHaveCount(0)
    await expect(page.getByText(/附件预览|已添加附件/)).toHaveCount(0)
  })

  test('Composer 覆盖发送、换行、IME、停止、模型与思考强度', async ({
    page,
  }) => {
    const integrated = page.getByTestId('integrated-chat')
    const composer = integrated.getByLabel('消息')
    const result = integrated.getByTestId('composer-result')

    await composer.fill('发送验收')
    await composer.press('Enter')
    await expect(result).toContainText('提交 1 次')

    await composer.fill('第一行')
    await composer.press('Shift+Enter')
    await composer.type('第二行')
    await expect(composer).toHaveValue('第一行\n第二行')

    await composer.fill('输入法确认')
    await composer.dispatchEvent('compositionstart')
    await composer.press('Enter')
    await composer.dispatchEvent('compositionend')
    await expect(result).toContainText('提交 1 次')

    await integrated.getByRole('combobox', { name: '模型' }).click()
    await page.getByRole('option', { name: 'Claude Opus 4.1' }).click()
    await expect(result).toContainText('模型 claude-opus-4-1')

    const thinkingSlider = integrated.getByRole('slider', {
      name: '思考强度',
    })
    await thinkingSlider.click()
    await thinkingSlider.press('End')
    await expect(result).toContainText('思考 high')

    const running = page.getByTestId('composer-running')
    await running.getByRole('button', { name: '停止' }).click()
    await expect(result).toContainText('停止 1 次')
  })

  test('disclosure、失败重试和焦点恢复保持可操作', async ({ page }) => {
    const completed = page.getByTestId('assistant-completed')
    const disclosure = completed.getByRole('button', { name: '已完成执行过程' })
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false')
    await disclosure.click()
    await expect(disclosure).toBeFocused()
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true')
    await expect(
      completed.getByText('读取 4 个组件文件并核对布局约束'),
    ).toBeVisible()

    const failed = page.getByTestId('assistant-failed')
    await failed.getByRole('button', { name: '重试' }).click()
    await expect(failed.getByTestId('retry-result')).toContainText(
      '已重试 1 次',
    )
  })

  test('ARIA 覆盖 expanded、disabled、busy、status、alert 与装饰图标', async ({
    page,
  }) => {
    await expect(
      page
        .getByTestId('assistant-completed')
        .getByRole('button', { name: '已完成执行过程' }),
    ).toHaveAttribute('aria-expanded', 'false')
    await expect(
      page.getByTestId('composer-running').locator('textarea'),
    ).toBeEnabled()
    await expect(
      page
        .getByTestId('composer-running')
        .getByRole('button', { name: '附件功能暂未开放' }),
    ).toHaveAttribute('disabled', '')
    expect(await page.getByRole('status').count()).toBeGreaterThan(0)
    expect(await page.getByRole('alert').count()).toBeGreaterThan(0)
    await expect(
      page.getByTestId('assistant-tool-loop').locator('article'),
    ).toHaveAttribute('aria-busy', 'true')
    await expect(
      page.getByTestId('assistant-failed').getByRole('alert'),
    ).toContainText('连接在读取响应时中断。')
    await expect(
      page.getByTestId('assistant-cancelled').getByRole('status'),
    ).toContainText('用户中断')
    await expect(
      page
        .getByTestId('composer-idle')
        .getByRole('button', { name: '发送' })
        .locator('svg'),
    ).toHaveAttribute('aria-hidden', 'true')
  })

  for (const width of [1024, 1280, 1536]) {
    test(`${width}px 桌面宽度无水平溢出、裁切或 Composer 遮挡`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.reload()
      await expect(
        page.locator('[data-fixture="conversation-components-v1"]'),
      ).toBeVisible()

      const geometry = await page.evaluate(() => ({
        documentOverflow:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
        bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
      }))
      expect(geometry).toEqual({ documentOverflow: 0, bodyOverflow: 0 })

      await expectInsideViewport(page, page.getByTestId('integrated-chat'))
      await expectInsideViewport(page, page.getByTestId('composer-running'))
    })
  }

  test('长历史保持虚拟化、滚动和 Composer 可见', async ({ page }) => {
    const longHistory = page.getByTestId('long-history')
    const scrollArea = longHistory.getByTestId('message-scroll-area')
    await expect(scrollArea).toBeVisible()
    const metrics = await scrollArea.evaluate((element) => ({
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      rendered: element.querySelectorAll('[data-index]').length,
    }))
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight)
    expect(metrics.rendered).toBeGreaterThan(0)
    expect(metrics.rendered).toBeLessThan(48)
    await expect(
      page.getByTestId('integrated-chat').getByLabel('消息'),
    ).toBeVisible()
  })
})

/** 断言元素的水平边界完全落在当前 viewport 内。
 *
 * @param page - 当前 Playwright 页面。
 * @param locator - 需要检查的元素。
 * @returns 断言完成后的 Promise。
 * @throws 元素缺失或超出 viewport 时由 Playwright 断言抛出。
 */
async function expectInsideViewport(
  page: Page,
  locator: Locator,
): Promise<void> {
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  const viewport = page.viewportSize()
  expect(viewport).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width)
}
