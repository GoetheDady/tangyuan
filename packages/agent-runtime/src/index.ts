import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  createYuanxiaoRuntimeForTesting,
  type YuanxiaoRuntime,
} from './runtime'
import { LastActiveSessionStore } from './session'
import { PiSdkDriver } from './driver'
import type { PiSdkDriverOptions } from './driver'
import { createDefaultStores } from './stores'

export {
  YUANXIAO_DEFAULT_AGENT_ID,
  applyTranscriptDelta,
  createAgentProfileStatus,
} from '@yuanxiao/contracts'
export type {
  AgentEvent,
  AgentEventListener,
  AgentEventSubscription,
  AgentId,
  AgentRuntimeErrorCode,
  AgentRuntimeErrorPayload,
  AgentRunState,
  AgentSessionSummary,
  AgentSummary,
  CancelConfigurationVerificationRequest,
  CancelRunRequest,
  CompactionEntry,
  ConfigEncryptionAdapter,
  CreateSessionRequest,
  ExecutionAttempt,
  GetSessionMessagesRequest,
  InternalRuntimeConfig,
  ListSessionsRequest,
  ModelDescriptor,
  ProviderDescriptor,
  RuntimeConfiguration,
  RuntimeSnapshot,
  SendMessageRequest,
  SkillSummary,
  TranscriptDelta,
  TranscriptEntry,
  TranscriptSnapshot,
  UserMessageEntry,
  AgentReplyEntry,
} from '@yuanxiao/contracts'
export { createYuanxiaoRuntimeForTesting } from './runtime'
export type { YuanxiaoRuntime } from './runtime'
export { PiSdkDriver } from './driver'

/**
 * 创建 Electron Main 使用的默认 YuanxiaoRuntime。
 *
 * 使用组合模式：创建独立 Store 模块和 PiSdkDriver，
 * 通过构造函数注入到 Runtime。
 *
 * @returns 由配置、Session、Agent、Profile、Skill 职责模块组合的运行时实例。
 * @throws 此方法不会主动抛出错误；具体初始化错误会由运行时异步方法返回。
 */
export function createYuanxiaoRuntime(
  options?: PiSdkDriverOptions,
): YuanxiaoRuntime {
  // 使用 createDefaultStores 创建所有 Store 模块
  // 使 Store 创建与 PiSdkDriver 解耦
  const fsRoot = options?.fsRoot ?? homedir()
  const now = options?.now ?? (() => new Date().toISOString())
  const stores = createDefaultStores({
    agentHomePath: options?.agentHomePath ?? '~/.yuanxiao/agents/yuanxiao',
    fsRoot,
    userDataPath: options?.userDataPath ?? join(fsRoot, '.yuanxiao'),
    now,
    ...(options?.gateway ? { gateway: options.gateway } : {}),
    ...(options?.encryptionAdapter !== undefined
      ? { encryptionAdapter: options.encryptionAdapter }
      : {}),
  })

  const driver = new PiSdkDriver(options, stores)
  // Store 由 createDefaultStores 统一创建并注入 Driver 与 Runtime，
  // 不再由 Driver 内部重复创建一套。
  const lastActiveSessionStore = new LastActiveSessionStore({
    layout: stores.layout,
    now: stores.now,
  })

  // Runtime 模块来自 createDefaultStores，而非 PiSdkDriver
  const runtime = createYuanxiaoRuntimeForTesting({
    configuration: stores.configurationModule,
    sessions: driver,
    agents: stores.agentRegistry,
    profiles: stores.profileModule,
    skills: stores.skillStore,
    lastActiveSessionStore,
  })

  return runtime
}

export * from './agent'
export * from './core'
export * from './driver'
export * from './profile'
export * from './runtime'
export * from './session'
export * from './skill'
