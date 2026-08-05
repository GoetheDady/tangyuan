import { describe, it, expect, vi } from 'vitest'
import { registerNotificationIpc } from './notification'
import { DESKTOP_IPC_CHANNELS } from '@yuanxiao/contracts'

const { mockOn, mockShow, MockNotification } = vi.hoisted(() => {
  const mockOn = vi.fn()
  const mockShow = vi.fn()
  const MockNotification = vi.fn(function (this: { on: typeof mockOn; show: typeof mockShow }) {
    this.on = mockOn
    this.show = mockShow
  })
  return { mockOn, mockShow, MockNotification }
})

vi.mock('electron', () => ({ Notification: MockNotification }))

describe('registerNotificationIpc', () => {
  it('注册 notificationSend IPC handler', () => {
    const handle = vi.fn()
    registerNotificationIpc({ handle } as any, vi.fn())
    expect(handle).toHaveBeenCalledWith(
      DESKTOP_IPC_CHANNELS.notificationSend,
      expect.any(Function),
    )
  })

  it('点击通知时调用 focusWindow', async () => {
    mockOn.mockClear()
    mockShow.mockClear()

    const focusWindow = vi.fn()
    let handler: Function | undefined
    registerNotificationIpc(
      { handle: vi.fn((_ch: string, h: Function) => { handler = h }) } as any,
      focusWindow,
    )

    await handler!({}, { title: '元宵', body: '测试消息' })

    expect(MockNotification).toHaveBeenCalledWith({ title: '元宵', body: '测试消息' })
    expect(mockShow).toHaveBeenCalledOnce()

    const clickCb = mockOn.mock.calls.find(([e]) => e === 'click')?.[1]
    expect(clickCb).toBeDefined()
    clickCb()
    expect(focusWindow).toHaveBeenCalledOnce()
  })
})
