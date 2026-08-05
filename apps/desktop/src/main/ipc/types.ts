import type {
  AgentEvent,
  DesktopIpcChannel,
  DesktopIpcResponse,
} from '@yuanxiao/contracts'

/**
 * 描述 YuanxiaoRuntime IPC 注册所需的 Electron ipcMain 子集。
 */
export interface IpcMainLike {
  /**
   * 注册一个可被 Renderer invoke 的 IPC handler。
   *
   * @param channel - IPC channel 名称。
   * @param handler - 处理 Renderer 请求的异步方法。
   * @returns 无返回值。
   * @throws 当底层 Electron 注册失败时可能抛出错误。
   */
  handle<Channel extends DesktopIpcChannel>(
    channel: Channel,
    handler: (
      event: unknown,
      payload: unknown,
    ) => Promise<DesktopIpcResponse<Channel>>,
  ): void
}

/**
 * 描述 Main 侧把 Agent 事件推送到 Renderer 的广播方法。
 */
export type AgentEventBroadcaster = (event: AgentEvent) => void

/**
 * 描述 Main 侧安全打开外部链接的方法签名。
 */
export type OpenExternalLinkHandler = (url: string) => Promise<void>

/**
 * 描述 Main 侧将主窗口带到前台的方法签名。
 */
export type FocusWindowHandler = () => void
