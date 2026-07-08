import { contextBridge, ipcRenderer } from 'electron'
import type { IpcInvoke, IpcSubscribe } from './api'
import { createTangyuanPreloadApi } from './api'

const invoke: IpcInvoke = (channel, ...payload) => ipcRenderer.invoke(channel, ...payload)
const subscribe: IpcSubscribe = (channel, listener) => {
  const handler = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
    listener(payload as Parameters<typeof listener>[0])
  }
  ipcRenderer.on(channel, handler)

  return () => {
    ipcRenderer.off(channel, handler)
  }
}
const api = createTangyuanPreloadApi(invoke, subscribe)

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-expect-error preload global is defined for the renderer process.
  window.api = api
}
