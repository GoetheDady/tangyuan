import { toast } from 'sonner'
import type { DesktopPreloadApi } from '@yuanxiao/contracts'
import type { AgentEventNotifications } from './agent-event-bridge'

/**
 * 创建混合通知实现：窗口在前台时用 in-app toast，失焦时升级为 OS 系统通知。
 *
 * 系统通知通过 IPC 委托给 Main 进程，由 Electron Notification API 发出，
 * 点击通知会将主窗口带到前台。
 *
 * @param api - Preload 桥接 API，用于发送系统通知 IPC 请求。
 * @returns 实现 AgentEventNotifications 接口的混合通知对象。
 */
export function createHybridNotifications(
  api: Pick<DesktopPreloadApi, 'sendNotification'>,
): AgentEventNotifications {
  const sendSystemNotification = (title: string, body: string): void => {
    void api.sendNotification({ title, body }).catch(() => {
      // 系统通知失败时静默降级，不影响主流程
    })
  }

  const dispatch = (
    toastFn: (message: string) => void,
    title: string,
    message: string,
  ): void => {
    if (document.hasFocus()) {
      toastFn(message)
    } else {
      sendSystemNotification(title, message)
    }
  }

  return {
    success(message: string): void {
      dispatch(toast.success, '元宵', message)
    },
    info(message: string): void {
      dispatch(toast.info, '元宵', message)
    },
    error(message: string): void {
      dispatch(toast.error, '元宵 — 错误', message)
    },
  }
}
