import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  createYuanxiaoRuntimeForTesting,
  type YuanxiaoRuntime,
} from './runtime'
import { DirectoryLayout } from './core'
import { LastActiveSessionStore } from './session'
import { PiSdkDriver } from './driver'
import type { PiSdkDriverOptions, ToolApprovalGateway } from './driver'

export {
  YUANXIAO_DEFAULT_AGENT_ID,
  applyTranscriptDelta,
  createAgentProfileStatus,
  type AgentEvent,
  type AgentEventListener,
  type AgentEventSubscription,
  type AgentId,
  type AgentRuntimeErrorCode,
  type AgentRuntimeErrorPayload,
  type AgentRunState,
  type AgentSessionSummary,
  type AgentSummary,
  type CancelConfigurationVerificationRequest,
  type CancelRunRequest,
  type CompactionEntry,
  type ConfigEncryptionAdapter,
  type CreateSessionRequest,
  type ExecutionAttempt,
  type GetSessionMessagesRequest,
  type InternalRuntimeConfig,
  type ListSessionsRequest,
  type ModelDescriptor,
  type ProviderDescriptor,
  type RuntimeConfiguration,
  type RuntimeSnapshot,
  type SendMessageRequest,
  type SkillSummary,
  type TranscriptDelta,
  type TranscriptEntry,
  type TranscriptSnapshot,
  type UserMessageEntry,
  type AgentReplyEntry,
} from '@yuanxiao/contracts'
export { createYuanxiaoRuntimeForTesting } from './runtime'
export type { YuanxiaoRuntime } from './runtime'
export { PiSdkDriver } from './driver'

/**
 * 创建 Electron Main 使用的默认 YuanxiaoRuntime。
 *
 * @returns 内部使用同一个 Pi SDK Driver 管理资源与会话的运行时实例。
 * @throws 此方法不会主动抛出错误；具体初始化错误会由运行时异步方法返回。
 */
export function createYuanxiaoRuntime(
  options?: PiSdkDriverOptions,
): YuanxiaoRuntime {
  // eslint-disable-next-line prefer-const -- assigned after driver/runtime creation
  let gatewayInstance: ToolApprovalGateway | undefined

  const driver = new PiSdkDriver({
    ...options,
    toolApprovalGateway: {
      requestBashApproval: (params) => {
        if (!gatewayInstance) {
          return Promise.resolve({ approved: false })
        }
        return gatewayInstance.requestBashApproval(params)
      },
      validateFilePath: (params) => {
        if (!gatewayInstance) {
          return { allowed: false, reason: '审批网关未初始化。' }
        }
        return gatewayInstance.validateFilePath(params)
      },
      requestClarification: (params) => {
        if (!gatewayInstance) {
          return Promise.resolve({ answer: '' })
        }
        return gatewayInstance.requestClarification(params)
      },
    },
  })
  const fsRoot = options?.fsRoot ?? homedir()
  const now = options?.now ?? (() => new Date().toISOString())
  const layout = new DirectoryLayout({
    agentHomePath: options?.agentHomePath ?? '~/.yuanxiao/agents/yuanxiao',
    fsRoot,
    userDataPath: options?.userDataPath ?? join(fsRoot, '.yuanxiao'),
  })
  const lastActiveSessionStore = new LastActiveSessionStore({ layout, now })

  const runtime = createYuanxiaoRuntimeForTesting({
    runtimeDriver: driver,
    sessionDriver: driver,
    lastActiveSessionStore,
  })

  gatewayInstance = runtime.createToolApprovalGateway()

  return runtime
}

export * from './agent'
export * from './approval'
export * from './core'
export * from './driver'
export * from './profile'
export * from './runtime'
export * from './session'
export * from './skill'
