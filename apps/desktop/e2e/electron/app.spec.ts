import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'

/**
 * 桌面端 Electron 窗口测试。
 *
 * 使用 Playwright 内置 electron.launch() 启动真实 Electron 应用，
 * 验证 Preload API、IPC 通信和渲染页面是否正常工作。
 * 所有测试使用临时 HOME 目录，不会读写真实 API Key 或配置。
 */
test.describe('Electron 窗口', () => {
  let electronApp: ElectronApplication
  let mainWindow: Page
  let tempHome: string

  test.beforeAll(async () => {
    // Playwright 从 playwright.config.ts 所在目录运行，process.cwd() 即 apps/desktop
    const mainEntry = join(process.cwd(), 'out/main/index.js')

    // 创建临时 HOME 目录，避免污染真实 ~/.tangyuan 配置
    tempHome = mkdtempSync(join(tmpdir(), 'tangyuan-e2e-electron-'))

    electronApp = await electron.launch({
      args: [mainEntry],
      env: {
        ...process.env,
        HOME: tempHome,
        // 确保不会触发打包 smoke test 模式
        TANGYUAN_DESKTOP_SMOKE_TEST_RESULT_PATH: ''
      }
    })

    // 等待第一个窗口加载完成
    mainWindow = await electronApp.firstWindow()
    await mainWindow.waitForLoadState('domcontentloaded')
  })

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close()
    }
    if (tempHome) {
      rmSync(tempHome, { recursive: true, force: true })
    }
  })

  test('应用启动后窗口打开', async () => {
    expect(mainWindow).toBeDefined()
    // 窗口应该有内容
    const title = await mainWindow.title()
    expect(title).toBeTruthy()
  })

  test('Preload API 在窗口中可用', async () => {
    // 验证 window.api 存在
    const apiExists = await mainWindow.evaluate(() => {
      return typeof window.api !== 'undefined'
    })
    expect(apiExists).toBe(true)
  })

  test('window.api 包含预期的方法', async () => {
    const apiKeys = await mainWindow.evaluate(() => {
      return Object.keys(window.api).sort()
    })

    // 验证所有 11 个 Preload API 方法都存在
    expect(apiKeys).toContain('getRuntimeSnapshot')
    expect(apiKeys).toContain('refreshRuntime')
    expect(apiKeys).toContain('saveRuntimeConfiguration')
    expect(apiKeys).toContain('cancelRuntimeConfigurationVerification')
    expect(apiKeys).toContain('listSessions')
    expect(apiKeys).toContain('createSession')
    expect(apiKeys).toContain('getMessages')
    expect(apiKeys).toContain('sendMessage')
    expect(apiKeys).toContain('cancelRun')
    expect(apiKeys).toContain('subscribeToAgentEvents')
    expect(apiKeys).toContain('openExternalLink')
  })

  test('页面渲染了配置页或聊天页之一', async () => {
    const bodyText = await mainWindow.evaluate(() => {
      return document.body.innerText
    })

    // 根据 smoke test 的分类逻辑：页面应显示 setup 或 chat
    const isSetupPage =
      bodyText.includes('配置模型服务') &&
      bodyText.includes('Provider') &&
      bodyText.includes('API Key')
    const isChatPage = bodyText.includes('大语言模型对话') && bodyText.includes('新会话')

    expect(isSetupPage || isChatPage).toBe(true)
  })

  test('HashRouter 正确导航', async () => {
    // 等待 React Router 完成启动时重定向（Navigate 组件在渲染后更新 hash）
    await mainWindow.waitForFunction(() => {
      return window.location.hash.length > 0
    })

    const currentUrl = await mainWindow.evaluate(() => {
      return window.location.hash
    })

    // URL 应该包含 /console/providers 或 /chat
    expect(currentUrl).toMatch(/\/(console\/providers|chat)/)
  })

  test('调用 getRuntimeSnapshot 返回有效数据', async () => {
    const snapshot = await mainWindow.evaluate(async () => {
      return await window.api.getRuntimeSnapshot()
    })

    expect(snapshot).toBeDefined()
    expect(snapshot.activeAgent).toBeDefined()
    expect(snapshot.activeAgent.agentId).toBe('tangyuan')
    expect(snapshot.providers).toBeInstanceOf(Array)
    expect(snapshot.status).toMatch(/^(missing-config|ready)$/)
  })

  test('调用 listSessions 返回会话列表', async () => {
    const sessions = await mainWindow.evaluate(async () => {
      return await window.api.listSessions()
    })

    expect(sessions).toBeInstanceOf(Array)
  })

  test('调用 openExternalLink 被拒绝当协议不是 http/https', async () => {
    const error = await mainWindow.evaluate(async () => {
      try {
        await window.api.openExternalLink({ url: 'file:///etc/passwd' })
        return null
      } catch (e) {
        return String(e)
      }
    })

    expect(error).toBeTruthy()
  })
})
