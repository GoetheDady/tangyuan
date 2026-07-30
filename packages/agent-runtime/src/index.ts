import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  createTangyuanRuntimeForTesting,
  type TangyuanRuntime,
} from './tangyuan-runtime'
import { DirectoryLayout } from './core'
import { LastActiveSessionStore } from './session/last-active-session-store'
import { PiSdkDriver } from './pi-sdk-driver'
import type {
  PiSdkDriverOptions,
  ToolApprovalGateway,
} from './pi-sdk-driver-contracts'

export {
  TANGYUAN_DEFAULT_AGENT_ID,
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
} from '@tangyuan/contracts'
export { createTangyuanRuntimeForTesting } from './tangyuan-runtime'
export type { TangyuanRuntime } from './tangyuan-runtime'
export { PiSdkDriver } from './pi-sdk-driver'

/**
 * 创建 Electron Main 使用的默认 TangyuanRuntime。
 *
 * @returns 内部使用同一个 Pi SDK Driver 管理资源与会话的运行时实例。
 * @throws 此方法不会主动抛出错误；具体初始化错误会由运行时异步方法返回。
 */
export function createTangyuanRuntime(
  options?: PiSdkDriverOptions,
): TangyuanRuntime {
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
    agentHomePath: options?.agentHomePath ?? '~/.tangyuan/agents/tangyuan',
    fsRoot,
    userDataPath: options?.userDataPath ?? join(fsRoot, '.tangyuan'),
  })
  const lastActiveSessionStore = new LastActiveSessionStore({ layout, now })

  const runtime = createTangyuanRuntimeForTesting({
    runtimeDriver: driver,
    sessionDriver: driver,
    lastActiveSessionStore,
  })

  gatewayInstance = runtime.createToolApprovalGateway()

  return runtime
}

export * from './pi-sdk-driver-contracts'
export * from './gateway'
export * from './core'
export * from './session/run-turn-assembly'
