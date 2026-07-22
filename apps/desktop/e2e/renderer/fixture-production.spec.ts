import { expect, test } from '@playwright/test'
import {
  createPreloadApiInitScript,
  createReadyRuntimeSnapshot,
  createTestSessions
} from '../fixtures/preload-mock'

for (const fixture of [
  { path: 'base-components', heading: '基础组件验收夹具' },
  { path: 'conversation-components', heading: '对话业务组件跨组件验收' }
]) {
  test(`普通生产构建不注册 ${fixture.path} 夹具路由`, async ({ page }) => {
    const initScript = createPreloadApiInitScript(
      createReadyRuntimeSnapshot(),
      createTestSessions(1)
    )

    await page.addInitScript({ content: initScript })
    await page.goto(`/#/__fixtures__/${fixture.path}`)

    await expect(page.getByRole('heading', { name: fixture.heading })).toHaveCount(0)
    await expect(page).toHaveURL(/#\/chat\/tangyuan/)
  })
}
