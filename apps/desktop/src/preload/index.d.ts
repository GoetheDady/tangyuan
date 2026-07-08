import type { DesktopPreloadApi } from '@tangyuan/shared'

declare global {
  interface Window {
    api: DesktopPreloadApi
  }
}
