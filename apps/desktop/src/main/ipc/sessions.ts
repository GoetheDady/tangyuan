import {
  DESKTOP_IPC_CHANNELS,
  parseDesktopIpcRequest,
  parseDesktopIpcResponse,
} from '@yuanxiao/contracts'
import type { YuanxiaoRuntime } from '@yuanxiao/agent-runtime'
import type { IpcMainLike } from './types'

/**
 * 注册 Session 生命周期与执行相关 IPC handler。
 */
export function registerSessionsIpc(
  ipcMain: IpcMainLike,
  runtime: YuanxiaoRuntime,
): void {
  ipcMain.handle(DESKTOP_IPC_CHANNELS.sessionsList, async (_event, payload) => {
    const request = parseDesktopIpcRequest(
      DESKTOP_IPC_CHANNELS.sessionsList,
      payload,
    )
    return parseDesktopIpcResponse(
      DESKTOP_IPC_CHANNELS.sessionsList,
      await runtime.listSessions(request?.agentId, request?.includeArchived),
    )
  })
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.sessionsCreate,
    async (_event, payload) => {
      return parseDesktopIpcResponse(
        DESKTOP_IPC_CHANNELS.sessionsCreate,
        await runtime.createSession(
          parseDesktopIpcRequest(DESKTOP_IPC_CHANNELS.sessionsCreate, payload),
        ),
      )
    },
  )
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.sessionsGetTranscript,
    async (_event, payload) => {
      return parseDesktopIpcResponse(
        DESKTOP_IPC_CHANNELS.sessionsGetTranscript,
        await runtime.getTranscript(
          parseDesktopIpcRequest(
            DESKTOP_IPC_CHANNELS.sessionsGetTranscript,
            payload,
          ),
        ),
      )
    },
  )
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.sessionsSendMessage,
    async (_event, payload) => {
      return parseDesktopIpcResponse(
        DESKTOP_IPC_CHANNELS.sessionsSendMessage,
        await runtime.sendMessage(
          parseDesktopIpcRequest(
            DESKTOP_IPC_CHANNELS.sessionsSendMessage,
            payload,
          ),
        ),
      )
    },
  )
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.sessionsCancelRun,
    async (_event, payload) => {
      return parseDesktopIpcResponse(
        DESKTOP_IPC_CHANNELS.sessionsCancelRun,
        await runtime.cancelRun(
          parseDesktopIpcRequest(
            DESKTOP_IPC_CHANNELS.sessionsCancelRun,
            payload,
          ),
        ),
      )
    },
  )
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.sessionsRetryMessage,
    async (_event, payload) => {
      return parseDesktopIpcResponse(
        DESKTOP_IPC_CHANNELS.sessionsRetryMessage,
        await runtime.retryMessage(
          parseDesktopIpcRequest(
            DESKTOP_IPC_CHANNELS.sessionsRetryMessage,
            payload,
          ),
        ),
      )
    },
  )
  ipcMain.handle(DESKTOP_IPC_CHANNELS.sessionsFork, async (_event, payload) => {
    return parseDesktopIpcResponse(
      DESKTOP_IPC_CHANNELS.sessionsFork,
      await runtime.forkSession(
        parseDesktopIpcRequest(DESKTOP_IPC_CHANNELS.sessionsFork, payload),
      ),
    )
  })
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.sessionsArchive,
    async (_event, payload) => {
      return parseDesktopIpcResponse(
        DESKTOP_IPC_CHANNELS.sessionsArchive,
        await runtime.archiveSession(
          parseDesktopIpcRequest(DESKTOP_IPC_CHANNELS.sessionsArchive, payload),
        ),
      )
    },
  )
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.sessionsRecover,
    async (_event, payload) => {
      return parseDesktopIpcResponse(
        DESKTOP_IPC_CHANNELS.sessionsRecover,
        await runtime.recoverSession(
          parseDesktopIpcRequest(DESKTOP_IPC_CHANNELS.sessionsRecover, payload),
        ),
      )
    },
  )
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.sessionsDelete,
    async (_event, payload) => {
      return parseDesktopIpcResponse(
        DESKTOP_IPC_CHANNELS.sessionsDelete,
        await runtime.deleteSession(
          parseDesktopIpcRequest(DESKTOP_IPC_CHANNELS.sessionsDelete, payload),
        ),
      )
    },
  )
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.sessionsRename,
    async (_event, payload) => {
      return parseDesktopIpcResponse(
        DESKTOP_IPC_CHANNELS.sessionsRename,
        await runtime.renameSession(
          parseDesktopIpcRequest(DESKTOP_IPC_CHANNELS.sessionsRename, payload),
        ),
      )
    },
  )
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.sessionsResume,
    async (_event, payload) => {
      parseDesktopIpcRequest(DESKTOP_IPC_CHANNELS.sessionsResume, payload)
      return parseDesktopIpcResponse(
        DESKTOP_IPC_CHANNELS.sessionsResume,
        await runtime.resumeSession(),
      )
    },
  )
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.sessionsSetLastActive,
    async (_event, payload) => {
      return parseDesktopIpcResponse(
        DESKTOP_IPC_CHANNELS.sessionsSetLastActive,
        await runtime.setLastActiveSession(
          parseDesktopIpcRequest(
            DESKTOP_IPC_CHANNELS.sessionsSetLastActive,
            payload,
          ),
        ),
      )
    },
  )
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.sessionsGetModelInfo,
    async (_event, payload) => {
      return parseDesktopIpcResponse(
        DESKTOP_IPC_CHANNELS.sessionsGetModelInfo,
        await runtime.getSessionModelInfo(
          parseDesktopIpcRequest(
            DESKTOP_IPC_CHANNELS.sessionsGetModelInfo,
            payload,
          ),
        ),
      )
    },
  )
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.sessionsSetModel,
    async (_event, payload) => {
      return parseDesktopIpcResponse(
        DESKTOP_IPC_CHANNELS.sessionsSetModel,
        await runtime.setSessionModel(
          parseDesktopIpcRequest(
            DESKTOP_IPC_CHANNELS.sessionsSetModel,
            payload,
          ),
        ),
      )
    },
  )
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.sessionsSetThinkingLevel,
    async (_event, payload) => {
      return parseDesktopIpcResponse(
        DESKTOP_IPC_CHANNELS.sessionsSetThinkingLevel,
        await runtime.setSessionThinkingLevel(
          parseDesktopIpcRequest(
            DESKTOP_IPC_CHANNELS.sessionsSetThinkingLevel,
            payload,
          ),
        ),
      )
    },
  )
}
