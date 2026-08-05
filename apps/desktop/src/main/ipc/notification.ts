import { Notification } from 'electron'
import {
  DESKTOP_IPC_CHANNELS,
  parseDesktopIpcRequest,
  parseDesktopIpcResponse,
} from '@yuanxiao/contracts'
import type { IpcMainLike, FocusWindowHandler } from './types'

/**
 * 注册系统通知相关 IPC handler。
 *
 * @param ipcMain - Electron ipcMain 或测试替身。
 * @param focusWindow - 点击通知时将主窗口带到前台的回调。
 * @returns 无返回值。
 * @throws 当 ipcMain.handle 注册失败时可能抛出错误。
 */
export function registerNotificationIpc(
  ipcMain: IpcMainLike,
  focusWindow: FocusWindowHandler,
): void {
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.notificationSend,
    async (_event, payload) => {
      const request = parseDesktopIpcRequest(
        DESKTOP_IPC_CHANNELS.notificationSend,
        payload,
      )

      const notification = new Notification({
        title: request.title,
        body: request.body,
      })

      notification.on('click', () => {
        focusWindow()
      })

      notification.show()

      return parseDesktopIpcResponse(
        DESKTOP_IPC_CHANNELS.notificationSend,
        undefined,
      )
    },
  )
}
