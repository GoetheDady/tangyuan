import type {
  AgentEvent,
  AgentId,
  ProfileUpdateResult,
  SoulContent,
  UserProfileContent,
} from '@yuanxiao/contracts'
import { YUANXIAO_DEFAULT_AGENT_ID } from '@yuanxiao/contracts'
import type { DirectoryLayout } from '../core'
import { getMtimeIso, sanitizeErrorMessage } from '../core'
import type { ProfileStore } from '../profile'
import type { ProfileModule } from './runtime-modules'

type ProfilePersistence = Pick<
  ProfileStore,
  'readSoul' | 'readUserProfile' | 'writeSoul' | 'writeUserProfile'
>

type ProfilePaths = Pick<DirectoryLayout, 'soul' | 'userProfile'>

export interface DefaultProfileModuleDependencies {
  emit: (event: AgentEvent) => void
  layout: ProfilePaths
  now: () => string
  profileStore: ProfilePersistence
  refreshAgentContext: (agentId: AgentId) => Promise<void>
  refreshAllContexts: () => Promise<void>
}

/**
 * Profile 模块：集中管理 soul/user profile 的持久化、事件广播和会话上下文刷新。
 */
export class DefaultProfileModule implements ProfileModule {
  private readonly emit: (event: AgentEvent) => void
  private readonly layout: ProfilePaths
  private readonly now: () => string
  private readonly profileStore: ProfilePersistence
  private refreshAgentContext: (agentId: AgentId) => Promise<void>
  private refreshAllContexts: () => Promise<void>

  constructor(dependencies: DefaultProfileModuleDependencies) {
    this.emit = dependencies.emit
    this.layout = dependencies.layout
    this.now = dependencies.now
    this.profileStore = dependencies.profileStore
    this.refreshAgentContext = dependencies.refreshAgentContext
    this.refreshAllContexts = dependencies.refreshAllContexts
  }

  /**
   * 绑定会话上下文刷新回调。
   *
   * Driver 在注入 Store 后调用，将 Profile 变更后的刷新动作接到
   * 自身持有的活跃 session handle 上；未绑定时保持无操作。
   */
  setRefreshContextHandlers(handlers: {
    refreshAgentContext: (agentId: AgentId) => Promise<void>
    refreshAllContexts: () => Promise<void>
  }): void {
    this.refreshAgentContext = handlers.refreshAgentContext
    this.refreshAllContexts = handlers.refreshAllContexts
  }

  async getSoul(agentId: AgentId): Promise<SoulContent> {
    return this.profileStore.readSoul(agentId)
  }

  async getUserProfile(): Promise<UserProfileContent> {
    return this.profileStore.readUserProfile()
  }

  async updateSoul(
    agentId: AgentId,
    content: string,
    expectedVersion: string,
  ): Promise<ProfileUpdateResult> {
    const outcome = await this.profileStore.writeSoul(
      agentId,
      content,
      expectedVersion,
    )

    if (outcome.written) {
      const updatedAt =
        (await getMtimeIso(this.layout.soul(agentId))) ?? this.now()
      this.emitProfileUpdated('soul', updatedAt, agentId)
      await this.refreshAgentContext(agentId).catch((error) => {
        this.emitProfileRefreshError(agentId, error)
      })
    }

    return outcome.result
  }

  async updateUserProfile(
    content: string,
    expectedVersion: string,
  ): Promise<ProfileUpdateResult> {
    const outcome = await this.profileStore.writeUserProfile(
      content,
      expectedVersion,
    )

    if (outcome.written) {
      const updatedAt =
        (await getMtimeIso(this.layout.userProfile())) ?? this.now()
      this.emitProfileUpdated('user', updatedAt)
      await this.refreshAllContexts().catch((error) => {
        this.emitProfileRefreshError(YUANXIAO_DEFAULT_AGENT_ID, error)
      })
    }

    return outcome.result
  }

  private emitProfileUpdated(
    target: 'soul' | 'user',
    updatedAt: string,
    agentId: AgentId = YUANXIAO_DEFAULT_AGENT_ID,
  ): void {
    this.emit({
      type: 'profile-updated',
      agentId,
      target,
      updatedAt,
      occurredAt: this.now(),
    })
  }

  private emitProfileRefreshError(agentId: AgentId, error: unknown): void {
    this.emit({
      type: 'runtime-error',
      agentId,
      error: {
        code: 'unknown',
        message: `刷新 Agent 身份上下文失败：${sanitizeErrorMessage(error)}`,
        recoverable: true,
      },
      occurredAt: this.now(),
    })
  }
}
