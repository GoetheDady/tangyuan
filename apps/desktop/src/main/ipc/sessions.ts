import {
  DESKTOP_IPC_CHANNELS,
  parseDesktopIpcRequest,
  parseDesktopIpcResponse,
} from '@yuanxiao/contracts'
import type { YuanxiaoRuntime } from '@yuanxiao/agent-runtime'
import type { IpcMainLike } from './types'

/**
 * 注册 Session 生命周期、执行、审批与澄清相关 IPC handler。
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
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.sessionsApproveBash,
    async (_event, payload) => {
      const request = parseDesktopIpcRequest(
        DESKTOP_IPC_CHANNELS.sessionsApproveBash,
        payload,
      )
      await runtime.approveBash(request)
      return parseDesktopIpcResponse(
        DESKTOP_IPC_CHANNELS.sessionsApproveBash,
        undefined,
      )
    },
  )
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.sessionsRejectBash,
    async (_event, payload) => {
      const { approvalId } = parseDesktopIpcRequest(
        DESKTOP_IPC_CHANNELS.sessionsRejectBash,
        payload,
      )
      await runtime.rejectBash(approvalId)
      return parseDesktopIpcResponse(
        DESKTOP_IPC_CHANNELS.sessionsRejectBash,
        undefined,
      )
    },
  )
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.sessionsGetPendingApprovals,
    async (_event, payload) => {
      parseDesktopIpcRequest(
        DESKTOP_IPC_CHANNELS.sessionsGetPendingApprovals,
        payload,
      )
      return parseDesktopIpcResponse(
        DESKTOP_IPC_CHANNELS.sessionsGetPendingApprovals,
        runtime.getPendingApprovals(),
      )
    },
  )
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.sessionsAnswerClarification,
    async (_event, payload) => {
      const { clarificationId, answer } = parseDesktopIpcRequest(
        DESKTOP_IPC_CHANNELS.sessionsAnswerClarification,
        payload,
      )
      await runtime.answerClarification(clarificationId, answer)
      return parseDesktopIpcResponse(
        DESKTOP_IPC_CHANNELS.sessionsAnswerClarification,
        undefined,
      )
    },
  )
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.sessionsCancelClarification,
    async (_event, payload) => {
      const { clarificationId } = parseDesktopIpcRequest(
        DESKTOP_IPC_CHANNELS.sessionsCancelClarification,
        payload,
      )
      await runtime.cancelClarification(clarificationId)
      return parseDesktopIpcResponse(
        DESKTOP_IPC_CHANNELS.sessionsCancelClarification,
        undefined,
      )
    },
  )
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.sessionsGetPendingClarifications,
    async (_event, payload) => {
      parseDesktopIpcRequest(
        DESKTOP_IPC_CHANNELS.sessionsGetPendingClarifications,
        payload,
      )
      return parseDesktopIpcResponse(
        DESKTOP_IPC_CHANNELS.sessionsGetPendingClarifications,
        runtime.getPendingClarifications(),
      )
    },
  )
}
