import {
  DESKTOP_IPC_CHANNELS,
  type DesktopIpcChannel,
  type DesktopIpcResponse
} from '@tangyuan/shared'
import { describe, expect, it } from 'vitest'
import { createTangyuanPreloadApi, type IpcInvoke } from './api'

describe('createTangyuanPreloadApi', () => {
  it('exposes a typed renderer API backed by the allowed IPC channels', async () => {
    const calls: Array<[DesktopIpcChannel, ...unknown[]]> = []
    const invoke: IpcInvoke = async (channel, ...payload) => {
      calls.push([channel, ...payload])

      return undefined as unknown as DesktopIpcResponse<typeof channel>
    }
    const api = createTangyuanPreloadApi(invoke)

    expect(Object.keys(api).sort()).toEqual([
      'createSession',
      'getRuntimeSnapshot',
      'listSessions',
      'refreshRuntime'
    ])

    await api.getRuntimeSnapshot()
    await api.refreshRuntime()
    await api.listSessions()
    await api.createSession({ agentId: 'tangyuan', title: '新会话' })

    expect(calls).toEqual([
      [DESKTOP_IPC_CHANNELS.runtimeGetSnapshot],
      [DESKTOP_IPC_CHANNELS.runtimeRefresh],
      [DESKTOP_IPC_CHANNELS.sessionsList],
      [
        DESKTOP_IPC_CHANNELS.sessionsCreate,
        {
          agentId: 'tangyuan',
          title: '新会话'
        }
      ]
    ])
  })
})
