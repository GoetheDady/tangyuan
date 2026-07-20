import { CheckCircle2, CircleAlert, CircleX, Info, LoaderCircle, X } from 'lucide-react'
import { Toaster as SonnerToaster } from 'sonner'

const TOAST_DURATION_MS = 4000
const TOAST_GAP_PX = 8
const TOAST_VISIBLE_COUNT = 3

/**
 * 渲染 Renderer 唯一的 Sonner 通知队列，并应用黑芝麻汤圆主题默认值。
 *
 * 页面仍可直接调用 `toast`；该组件只统一队列展示，不维护第二套 Toast 状态。
 *
 * @returns 全局 Sonner Toaster。
 * @throws 此组件不会主动抛出错误。
 */
function Toaster(): React.JSX.Element {
  return (
    <SonnerToaster
      theme="light"
      position="bottom-right"
      duration={TOAST_DURATION_MS}
      gap={TOAST_GAP_PX}
      visibleToasts={TOAST_VISIBLE_COUNT}
      closeButton
      offset={24}
      mobileOffset={16}
      containerAriaLabel="通知"
      swipeDirections={['right', 'left']}
      icons={{
        info: <Info aria-hidden="true" className="text-info-foreground" />,
        success: <CheckCircle2 aria-hidden="true" className="text-success-foreground" />,
        warning: <CircleAlert aria-hidden="true" className="text-warning-foreground" />,
        error: <CircleX aria-hidden="true" className="text-destructive-soft-foreground" />,
        loading: <LoaderCircle aria-hidden="true" className="animate-spin text-info-foreground" />,
        close: <X aria-hidden="true" />
      }}
      toastOptions={{
        closeButtonAriaLabel: '关闭通知',
        classNames: {
          toast: 'tangyuan-toast',
          title: 'tangyuan-toast-title',
          description: 'tangyuan-toast-description',
          actionButton: 'tangyuan-toast-action',
          cancelButton: 'tangyuan-toast-cancel',
          closeButton: 'tangyuan-toast-close'
        }
      }}
    />
  )
}

export { Toaster }
