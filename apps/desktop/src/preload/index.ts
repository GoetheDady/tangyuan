import { contextBridge, ipcRenderer } from 'electron'
import type { IpcInvoke } from './api'
import { createTangyuanPreloadApi } from './api'

const invoke: IpcInvoke = (channel, ...payload) => ipcRenderer.invoke(channel, ...payload)
const api = createTangyuanPreloadApi(invoke)

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
