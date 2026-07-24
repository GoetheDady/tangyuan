import type {
  ProfileMaintenanceResult,
  SoulContent,
  UserProfileContent,
} from '@tangyuan/contracts'
import type { AgentSessionDriver } from './index'
import type { RuntimeSnapshotStore } from './runtime-snapshot-store'

/**
 * 创建 IdentityService 所需的依赖。
 */
export interface IdentityServiceDependencies {
  sessionDriver: AgentSessionDriver
  snapshotStore: RuntimeSnapshotStore
}

/**
 * 身份与资料服务：承载「Agent soul 与共享 user profile 如何读取、更新」
 * 这一族操作。更新成功后刷新运行时快照缓存以获取最新的 profile 时间戳；
 * soul 更新以当前 activeAgent 作为请求发起方进行权限校验。
 */
export class IdentityService {
  private readonly sessionDriver: AgentSessionDriver
  private readonly snapshotStore: RuntimeSnapshotStore

  constructor(dependencies: IdentityServiceDependencies) {
    this.sessionDriver = dependencies.sessionDriver
    this.snapshotStore = dependencies.snapshotStore
  }

  /**
   * 读取指定 Agent 的 soul 内容。
   *
   * @param agentId - Agent 标识。
   * @returns Agent 的 soul 内容和更新时间。
   * @throws 当 Driver 不支持或读取失败时，Promise 会 reject。
   */
  async getSoul(agentId: string): Promise<SoulContent> {
    if (!this.sessionDriver.getSoul) {
      throw new Error('当前运行时不支持读取 Agent soul。')
    }
    return this.sessionDriver.getSoul(agentId)
  }

  /**
   * 读取共享 user profile 内容。
   *
   * @returns 共享 user profile 内容和更新时间。
   * @throws 当 Driver 不支持或读取失败时，Promise 会 reject。
   */
  async getUserProfile(): Promise<UserProfileContent> {
    if (!this.sessionDriver.getUserProfile) {
      throw new Error('当前运行时不支持读取 user profile。')
    }
    return this.sessionDriver.getUserProfile()
  }

  /**
   * 更新指定 Agent 的 soul 内容，成功后刷新快照缓存。
   *
   * @param agentId - 目标 Agent 标识。
   * @param content - 新 soul 内容。
   * @returns profile 维护结果。
   * @throws 当 Driver 不支持或操作失败时，Promise 会 reject。
   */
  async updateSoul(
    agentId: string,
    content: string,
  ): Promise<ProfileMaintenanceResult> {
    if (!this.sessionDriver.updateSoul) {
      throw new Error('当前运行时不支持更新 Agent soul。')
    }

    // 使用 activeAgent 作为请求发起方进行权限校验
    const snapshot = await this.snapshotStore.getOrLoad()
    const result = await this.sessionDriver.updateSoul(
      agentId,
      content,
      snapshot.activeAgent.agentId,
    )

    if (result.success) {
      await this.snapshotStore.reload()
    }

    return result
  }

  /**
   * 更新共享 user profile 内容，成功后刷新快照缓存。
   *
   * @param content - 新 user profile 内容。
   * @returns profile 维护结果。
   * @throws 当 Driver 不支持或操作失败时，Promise 会 reject。
   */
  async updateUserProfile(content: string): Promise<ProfileMaintenanceResult> {
    if (!this.sessionDriver.updateUserProfile) {
      throw new Error('当前运行时不支持更新 user profile。')
    }

    const result = await this.sessionDriver.updateUserProfile(content)

    if (result.success) {
      await this.snapshotStore.reload()
    }

    return result
  }
}
