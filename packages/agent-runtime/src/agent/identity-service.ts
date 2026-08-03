import type {
  ProfileUpdateResult,
  SoulContent,
  UserProfileContent,
} from '@yuanxiao/contracts'
import type { RuntimeSnapshotStore } from '../runtime/runtime-snapshot-store'
import type { ProfileModule } from '../runtime/runtime-modules'

/**
 * 创建 IdentityService 所需的依赖。
 */
export interface IdentityServiceDependencies {
  profiles: ProfileModule
  snapshotStore: RuntimeSnapshotStore
}

/**
 * 身份与资料服务：承载「Agent soul 与共享 user profile 如何读取、更新」
 * 这一族操作。内容实际更新后刷新运行时快照缓存以获取最新的 profile 时间戳。
 */
export class IdentityService {
  private readonly profiles: ProfileModule
  private readonly snapshotStore: RuntimeSnapshotStore

  constructor(dependencies: IdentityServiceDependencies) {
    this.profiles = dependencies.profiles
    this.snapshotStore = dependencies.snapshotStore
  }

  /**
   * 读取指定 Agent 的 soul 内容。
   *
   * @param agentId - Agent 标识。
   * @returns Agent 的 soul 内容和更新时间。
   * @throws 当 Profile 模块读取失败时，Promise 会 reject。
   */
  async getSoul(agentId: string): Promise<SoulContent> {
    return this.profiles.getSoul(agentId)
  }

  /**
   * 读取共享 user profile 内容。
   *
   * @returns 共享 user profile 内容和更新时间。
   * @throws 当 Profile 模块读取失败时，Promise 会 reject。
   */
  async getUserProfile(): Promise<UserProfileContent> {
    return this.profiles.getUserProfile()
  }

  /**
   * 更新指定 Agent 的 soul 内容，成功后刷新快照缓存。
   *
   * @param agentId - 目标 Agent 标识。
   * @param content - 新 soul 内容。
   * @param expectedVersion - 调用方最后观察到的内容版本。
   * @returns profile 维护结果。
   * @throws 当 Profile 模块更新失败时，Promise 会 reject。
   */
  async updateSoul(
    agentId: string,
    content: string,
    expectedVersion: string,
  ): Promise<ProfileUpdateResult> {
    const result = await this.profiles.updateSoul(
      agentId,
      content,
      expectedVersion,
    )

    if (result.status === 'updated') {
      await this.snapshotStore.reload().catch(() => undefined)
    }

    return result
  }

  /**
   * 更新共享 user profile 内容，成功后刷新快照缓存。
   *
   * @param content - 新 user profile 内容。
   * @param expectedVersion - 调用方最后观察到的内容版本。
   * @returns profile 维护结果。
   * @throws 当 Profile 模块更新失败时，Promise 会 reject。
   */
  async updateUserProfile(
    content: string,
    expectedVersion: string,
  ): Promise<ProfileUpdateResult> {
    const result = await this.profiles.updateUserProfile(
      content,
      expectedVersion,
    )

    if (result.status === 'updated') {
      await this.snapshotStore.reload().catch(() => undefined)
    }

    return result
  }
}
