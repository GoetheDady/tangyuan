import type { DesktopPreloadApi } from '@yuanxiao/contracts'

declare global {
  interface Window {
    api: DesktopPreloadApi
  }
}
