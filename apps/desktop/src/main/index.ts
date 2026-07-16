import { app, safeStorage, shell, BrowserWindow, ipcMain, session } from 'electron'
import { mkdir, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { createTangyuanRuntime } from '@tangyuan/agent-runtime'
import type { ConfigEncryptionAdapter } from '@tangyuan/agent-runtime'
import { DESKTOP_AGENT_EVENT_CHANNEL } from '@tangyuan/contracts'
import icon from '../../resources/icon.png?asset'
import { registerDesktopAppIpc } from './ipc'

const encryptionAdapter: ConfigEncryptionAdapter = {
  encrypt: async (plaintext: string): Promise<string> => {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('系统加密服务不可用')
    }
    return safeStorage.encryptString(plaintext).toString('base64')
  },
  decrypt: async (ciphertext: string): Promise<string> => {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('系统加密服务不可用')
    }
    return safeStorage.decryptString(Buffer.from(ciphertext, 'base64'))
  },
  isAvailable: (): boolean => safeStorage.isEncryptionAvailable(),
}

const tangyuanRuntime = createTangyuanRuntime({ encryptionAdapter })
const smokeTestResultPath = process.env['TANGYUAN_DESKTOP_SMOKE_TEST_RESULT_PATH']
let isQuittingAfterCancellingRuns = false

/**
 * 注册严格内容安全策略，禁止远程脚本和任意页面导航。
 *
 * 开发模式下允许 Vite HMR WebSocket 和 dev-server 连接。
 *
 * @returns 无返回值。
 * @throws 此方法不会主动抛出错误。
 */
function registerContentSecurityPolicy(): void {
  const isDevServer = is.dev && Boolean(process.env['ELECTRON_RENDERER_URL'])

  // In development the Vite dev server runs on localhost; we need to allow
  // WebSocket connections for HMR and inline style injection.
  const connectSrc = isDevServer
    ? `'self' ${new URL(process.env['ELECTRON_RENDERER_URL']!).origin} ws://localhost:*`
    : `'self'`

  const styleSrc = isDevServer ? `'self' 'unsafe-inline'` : `'self' 'unsafe-inline'`

  const csp = [
    "default-src 'self'",
    `script-src 'self'`,
    `style-src ${styleSrc}`,
    "img-src 'self' data:",
    "font-src 'self' data:",
    `connect-src ${connectSrc}`,
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    })
  })
}

/**
 * 校验 URL 协议，只允许 http/https，防止危险协议注入。
 *
 * @param url - 待校验的 URL 字符串。
 * @returns 通过校验的 URL；协议不允许时返回 null。
 * @throws 此方法不会主动抛出错误。
 */
function parseAndValidateUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return url
    }
    return null
  } catch {
    return null
  }
}

/**
 * 创建并加载桌面主窗口。
 *
 * @returns 创建后的 BrowserWindow。
 * @throws 当 Electron 无法创建 BrowserWindow 或加载页面失败时可能抛出错误。
 */
function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    const parsed = parseAndValidateUrl(details.url)
    if (parsed) {
      shell.openExternal(parsed)
    }
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

/**
 * 在打包冒烟测试模式下检查 Renderer 是否到达配置页或工作台。
 *
 * @param mainWindow - 已创建并开始加载的主窗口。
 * @returns 无返回值。
 * @throws 此方法内部会捕获错误并写入 smoke test 结果文件。
 */
async function runPackagedSmokeTest(mainWindow: BrowserWindow): Promise<void> {
  if (!smokeTestResultPath) {
    return
  }

  try {
    await writeSmokeTestResult({
      ok: false,
      phase: 'electron-ready',
      checkedAt: new Date().toISOString()
    })
    const runtimeSnapshot = await tangyuanRuntime.getRuntimeSnapshot()
    await writeSmokeTestResult({
      ok: false,
      phase: 'runtime-snapshot-loaded',
      runtimeStatus: runtimeSnapshot.status,
      agentHomePath: runtimeSnapshot.activeAgent.homePath,
      checkedAt: new Date().toISOString()
    })
    await waitForRendererLoad(mainWindow)
    const pageKind = await waitForSmokeTestPage(mainWindow)
    const result = {
      ok: pageKind !== 'unknown',
      phase: 'completed',
      pageKind,
      runtimeStatus: runtimeSnapshot.status,
      agentHomePath: runtimeSnapshot.activeAgent.homePath,
      bootstrapRequired: runtimeSnapshot.activeAgent.profile.bootstrapRequired,
      checkedAt: new Date().toISOString()
    }

    await writeSmokeTestResult(result)
    app.exit(result.ok ? 0 : 1)
  } catch (error) {
    await writeSmokeTestResult({
      ok: false,
      pageKind: 'unknown',
      error: error instanceof Error ? error.message : '打包冒烟测试失败',
      checkedAt: new Date().toISOString()
    })
    app.exit(1)
  }
}

/**
 * 等待主窗口 Renderer 完成主 frame 加载。
 *
 * @param mainWindow - 需要等待加载完成的主窗口。
 * @returns 无返回值。
 * @throws 当 Renderer 加载失败时，Promise 会 reject。
 */
async function waitForRendererLoad(mainWindow: BrowserWindow): Promise<void> {
  if (!mainWindow.webContents.isLoadingMainFrame()) {
    return
  }

  await new Promise<void>((resolve, reject) => {
    mainWindow.webContents.once('did-finish-load', () => {
      resolve()
    })
    mainWindow.webContents.once('did-fail-load', (_event, errorCode, errorDescription) => {
      reject(new Error(`Renderer 加载失败：${errorCode} ${errorDescription}`))
    })
  })
}

/**
 * 等待 Renderer 页面完成渲染，并识别当前显示的是配置页、工作台还是未知页面。
 *
 * @param mainWindow - 需要检查 DOM 文本的主窗口。
 * @returns 页面类型；configuration 表示配置页，workbench 表示工作台，unknown 表示未识别。
 * @throws 当 Renderer 执行脚本失败时，Promise 会 reject。
 */
async function waitForSmokeTestPage(
  mainWindow: BrowserWindow
): Promise<'configuration' | 'workbench' | 'unknown'> {
  const deadline = Date.now() + 15_000

  while (Date.now() < deadline) {
    const pageText = String(
      await mainWindow.webContents.executeJavaScript('document.body.innerText', true)
    )
    const pageKind = classifySmokeTestPage(pageText)

    if (pageKind !== 'unknown') {
      return pageKind
    }

    await sleep(250)
  }

  return 'unknown'
}

/**
 * 根据 Renderer 文本判断当前页面是否已进入配置页或工作台。
 *
 * @param pageText - Renderer DOM 中的可见文本。
 * @returns 页面类型；configuration 表示配置页，workbench 表示工作台，unknown 表示未识别。
 * @throws 此方法不会主动抛出错误。
 */
function classifySmokeTestPage(pageText: string): 'configuration' | 'workbench' | 'unknown' {
  if (
    pageText.includes('配置模型服务') &&
    pageText.includes('Provider') &&
    pageText.includes('API Key')
  ) {
    return 'configuration'
  }

  if (pageText.includes('大语言模型对话') && pageText.includes('新会话')) {
    return 'workbench'
  }

  return 'unknown'
}

/**
 * 写入打包冒烟测试结果 JSON。
 *
 * @param result - 可被脚本读取的冒烟测试结果。
 * @returns 无返回值。
 * @throws 当结果文件目录创建或文件写入失败时，Promise 会 reject。
 */
async function writeSmokeTestResult(result: Record<string, unknown>): Promise<void> {
  if (!smokeTestResultPath) {
    return
  }

  await mkdir(dirname(smokeTestResultPath), { recursive: true })
  await writeFile(smokeTestResultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
}

/**
 * 等待指定毫秒数。
 *
 * @param milliseconds - 需要等待的毫秒数。
 * @returns 等待完成后的 Promise。
 * @throws 此方法不会主动抛出错误。
 */
async function sleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}

if (smokeTestResultPath) {
  void writeSmokeTestResult({
    ok: false,
    phase: 'main-loaded',
    checkedAt: new Date().toISOString()
  })
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Enforce strict Content-Security-Policy: no remote scripts, no arbitrary navigation.
  // In development the Vite dev-server connect-src is opened via the CSP frame-src
  // and connect-src exceptions derived from ELECTRON_RENDERER_URL.
  registerContentSecurityPolicy()

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerDesktopAppIpc(
    ipcMain,
    tangyuanRuntime,
    (event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(DESKTOP_AGENT_EVENT_CHANNEL, event)
      }
    },
    async (url) => {
      const validated = parseAndValidateUrl(url)
      if (!validated) {
        throw new Error(`不允许打开非 http/https 链接。`)
      }
      await shell.openExternal(validated)
    }
  )

  const mainWindow = createWindow()
  void runPackagedSmokeTest(mainWindow)

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', (event) => {
  if (isQuittingAfterCancellingRuns) {
    return
  }

  event.preventDefault()
  isQuittingAfterCancellingRuns = true
  void tangyuanRuntime.cancelAllActiveRuns().finally(() => {
    app.quit()
  })
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
