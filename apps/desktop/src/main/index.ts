import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { PiSdkDriver } from '@tangyuan/agent-runtime'
import { DESKTOP_AGENT_EVENT_CHANNEL } from '@tangyuan/shared'
import icon from '../../resources/icon.png?asset'
import { createDesktopAppStore } from './DesktopAppStore'
import { registerDesktopAppIpc } from './ipc'

const piSdkDriver = new PiSdkDriver()
const desktopAppStore = createDesktopAppStore({
  runtimeDriver: piSdkDriver,
  sessionDriver: piSdkDriver
})
let isQuittingAfterCancellingRuns = false

/**
 * 创建并加载桌面主窗口。
 *
 * @returns 无返回值。
 * @throws 当 Electron 无法创建 BrowserWindow 或加载页面失败时可能抛出错误。
 */
function createWindow(): void {
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
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerDesktopAppIpc(ipcMain, desktopAppStore, (event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(DESKTOP_AGENT_EVENT_CHANNEL, event)
    }
  })

  createWindow()

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
  void desktopAppStore.cancelAllActiveRuns().finally(() => {
    app.quit()
  })
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
