import { expect, test } from '@playwright/test'
import {
  createPreloadApiInitScript,
  createReadyRuntimeSnapshot,
  createTestSessions
} from '../fixtures/preload-mock'

test('普通生产构建不注册基础组件夹具路由', async ({ page }) => {
  const initScript = createPreloadApiInitScript(createReadyRuntimeSnapshot(), createTestSessions(1))

  await page.addInitScript({ content: initScript })
  await page.goto('/#/__fixtures__/base-components')

  await expect(page.getByRole('heading', { name: '基础组件验收夹具' })).toHaveCount(0)
  await expect(page).toHaveURL(/#\/chat\/tangyuan/)
})
