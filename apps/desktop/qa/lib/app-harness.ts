import { _electron as electron } from '@playwright/test'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'

/**
 * 真实 Electron 应用测试夹具。
 *
 * 与 e2e/electron/app.spec.ts 的关键区别：QA 使用**真实 HOME**（默认 ~/.tangyuan），
 * 以便主进程通过 safeStorage（macOS 钥匙串）解密真实 Provider API Key，
 * 从而进行真实的大模型对话。因此本夹具只应用于本地手动/定时 QA，
 * 绝不能进 CI（CI 无钥匙串、无真实 key）。
 */
export interface AppHarness {
  app: ElectronApplication
  window: Page
  /** 运行期捕获的渲染进程控制台错误。 */
  consoleErrors: string[]
  /** 运行期捕获的页面未捕获异常。 */
  pageErrors: string[]
  close: () => Promise<void>
}

/**
 * 启动真实 Electron 应用并挂上错误捕获。
 *
 * @returns 应用夹具，含窗口句柄与错误收集数组。
 * @throws 当构建产物缺失或应用启动失败时，Promise 会 reject。
 */
export async function launchApp(): Promise<AppHarness> {
  const mainEntry = join(process.cwd(), 'out/main/index.js')

  const app = await electron.launch({
    args: [mainEntry],
    env: {
      ...process.env,
      // 显式不进入打包 smoke test 模式
      TANGYUAN_DESKTOP_SMOKE_TEST_RESULT_PATH: ''
    }
  })

  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')

  const consoleErrors: string[] = []
  const pageErrors: string[] = []

  window.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text())
    }
  })
  window.on('pageerror', (error) => {
    pageErrors.push(String(error))
  })

  return {
    app,
    window,
    consoleErrors,
    pageErrors,
    close: async () => {
      await app.close()
    }
  }
}

/**
 * QA 模式下用环境变量注入的测试凭据配置运行时。
 *
 * 依赖 main 进程的 QA 明文适配器（TANGYUAN_QA_API_KEY 存在时启用），
 * 通过 saveRuntimeConfiguration 写入并**真实验证**测试 key（会真调一次模型）。
 * 成功后运行时进入 ready，方可进行真实对话测试。
 *
 * @param harness - 应用夹具。
 * @returns 配置是否成功（key 无效或验证失败时返回 false 及原因）。
 */
export async function configureForQa(
  harness: AppHarness
): Promise<{ ok: boolean; reason?: string }> {
  const apiKey = process.env.TANGYUAN_QA_API_KEY
  if (!apiKey) {
    return { ok: false, reason: '未设置 TANGYUAN_QA_API_KEY 环境变量' }
  }
  const providerId = process.env.TANGYUAN_QA_PROVIDER ?? 'deepseek'
  const modelId = process.env.TANGYUAN_QA_MODEL ?? 'deepseek-v4-flash'

  return await harness.window.evaluate(
    async ({ providerId, modelId, apiKey }) => {
      const api = (
        window as unknown as {
          api: {
            saveRuntimeConfiguration: (c: {
              providerId: string
              modelId: string
              apiKey: string
            }) => Promise<unknown>
          }
        }
      ).api
      try {
        await api.saveRuntimeConfiguration({ providerId, modelId, apiKey })
        return { ok: true }
      } catch (e) {
        return { ok: false, reason: String(e) }
      }
    },
    { providerId, modelId, apiKey }
  )
}
