import type { DesktopPreloadApi } from '@tangyuan/contracts'

declare global {
  interface Window {
    api: DesktopPreloadApi
  }
}
