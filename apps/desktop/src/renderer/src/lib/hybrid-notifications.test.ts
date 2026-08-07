import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { toast } from 'sonner'
import { createHybridNotifications } from './hybrid-notifications'
import type { DesktopPreloadApi } from '@yuanxiao/contracts'

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}))

describe('createHybridNotifications', () => {
  const sendNotification = vi.fn<DesktopPreloadApi['sendNotification']>()
  const api: Pick<DesktopPreloadApi, 'sendNotification'> = {
    sendNotification,
  }

  beforeEach(() => {
    sendNotification.mockReset().mockResolvedValue(undefined)
    vi.mocked(toast.success).mockClear()
    vi.mocked(toast.info).mockClear()
    vi.mocked(toast.error).mockClear()
  })

  describe('窗口在前台时（document.hasFocus() = true）', () => {
    beforeEach(() => {
      vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    })
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('success 调用 toast.success', () => {
      const n = createHybridNotifications(api)
      n.success('保存成功')
      expect(toast.success).toHaveBeenCalledWith('保存成功')
      expect(sendNotification).not.toHaveBeenCalled()
    })

    it('info 调用 toast.info', () => {
      const n = createHybridNotifications(api)
      n.info('会话已进入后台')
      expect(toast.info).toHaveBeenCalledWith('会话已进入后台')
      expect(sendNotification).not.toHaveBeenCalled()
    })

    it('error 调用 toast.error', () => {
      const n = createHybridNotifications(api)
      n.error('发生错误')
      expect(toast.error).toHaveBeenCalledWith('发生错误')
      expect(sendNotification).not.toHaveBeenCalled()
    })
  })

  describe('窗口失焦时（document.hasFocus() = false）', () => {
    beforeEach(() => {
      vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    })
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('success 调用系统通知，标题为「元宵」', () => {
      const n = createHybridNotifications(api)
      n.success('已归档 Agent')
      expect(sendNotification).toHaveBeenCalledWith({
        title: '元宵',
        body: '已归档 Agent',
      })
      expect(toast.success).not.toHaveBeenCalled()
    })

    it('info 调用系统通知，标题为「元宵」', () => {
      const n = createHybridNotifications(api)
      n.info('会话已进入后台')
      expect(sendNotification).toHaveBeenCalledWith({
        title: '元宵',
        body: '会话已进入后台',
      })
      expect(toast.info).not.toHaveBeenCalled()
    })

    it('error 调用系统通知，标题为「元宵 — 错误」', () => {
      const n = createHybridNotifications(api)
      n.error('执行失败')
      expect(sendNotification).toHaveBeenCalledWith({
        title: '元宵 — 错误',
        body: '执行失败',
      })
      expect(toast.error).not.toHaveBeenCalled()
    })

    it('系统通知失败时静默降级，不抛出', async () => {
      sendNotification.mockRejectedValueOnce(new Error('IPC 失败'))
      const n = createHybridNotifications(api)
      expect(() => n.info('通知内容')).not.toThrow()
      // 让 Promise rejection 处理完成
      await Promise.resolve()
    })
  })
})
