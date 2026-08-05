import { agentEventSchema } from '@yuanxiao/contracts'
import type { YuanxiaoRuntime } from '@yuanxiao/agent-runtime'
import { registerRuntimeIpc } from './ipc/runtime'
import { registerSessionsIpc } from './ipc/sessions'
import { registerAgentsIpc } from './ipc/agents'
import { registerProfileIpc } from './ipc/profile'
import { registerSkillsIpc } from './ipc/skills'
import { registerNotificationIpc } from './ipc/notification'
import type {
  IpcMainLike,
  AgentEventBroadcaster,
  OpenExternalLinkHandler,
  FocusWindowHandler,
} from './ipc/types'

export type { IpcMainLike, AgentEventBroadcaster, OpenExternalLinkHandler, FocusWindowHandler }

/**
 * 把允许的 IPC channel 连接到 YuanxiaoRuntime。
 *
 * @param ipcMain - Electron ipcMain 或测试替身。
 * @param runtime - Main 侧唯一运行时入口。
 * @param broadcastAgentEvent - 可选事件广播方法，用于推送 Agent 标准事件。
 * @param openExternalLink - 可选外部链接处理方法，用于安全打开系统浏览器。
 * @param focusWindow - 可选窗口前台方法，用于系统通知点击时聚焦主窗口。
 * @returns 无返回值。
 * @throws 当 ipcMain.handle 注册失败时可能抛出错误。
 */
export function registerDesktopAppIpc(
  ipcMain: IpcMainLike,
  runtime: YuanxiaoRuntime,
  broadcastAgentEvent?: AgentEventBroadcaster,
  openExternalLink?: OpenExternalLinkHandler,
  focusWindow?: FocusWindowHandler,
): void {
  if (broadcastAgentEvent) {
    runtime.subscribe((event) => {
      broadcastAgentEvent(agentEventSchema.parse(event))
    })
  }

  registerRuntimeIpc(ipcMain, runtime)
  registerSessionsIpc(ipcMain, runtime)
  registerAgentsIpc(ipcMain, runtime)
  registerProfileIpc(ipcMain, runtime)
  registerSkillsIpc(ipcMain, runtime, openExternalLink)
  registerNotificationIpc(ipcMain, focusWindow ?? (() => undefined))
}
