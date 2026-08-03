import type {
  CancelConfigurationVerificationRequest,
  DeleteProviderRequest,
  ProviderConfiguration,
  RuntimeConfiguration,
  RuntimeSnapshot,
} from '@yuanxiao/contracts'
import type { RuntimeConfigurationModule } from './runtime-modules'

/**
 * 创建 RuntimeSnapshotStore 所需的依赖。
 */
export interface RuntimeSnapshotStoreDependencies {
  configuration: RuntimeConfigurationModule
}

/**
 * 运行时快照存储：持有最近一次读取的 RuntimeSnapshot 缓存，
 * 承载「快照如何读取、刷新、随配置生命周期（保存/取消验证/恢复/重置）更新」
 * 这一条状态知识。所有会改变运行时资源的操作都在此刷新缓存，
 * 供 YuanxiaoRuntime 编排层与 Agent/soul/profile 操作在写后回填。
 */
export class RuntimeSnapshotStore {
  private readonly configuration: RuntimeConfigurationModule
  private snapshot: RuntimeSnapshot | null = null

  constructor(dependencies: RuntimeSnapshotStoreDependencies) {
    this.configuration = dependencies.configuration
  }

  /**
   * 返回已缓存的快照，若无缓存则从配置模块读取一次。
   *
   * @returns 当前 RuntimeSnapshot。
   */
  async getOrLoad(): Promise<RuntimeSnapshot> {
    return this.snapshot ?? (await this.reload())
  }

  /**
   * 读取当前运行时快照并写入缓存。
   *
   * @returns 当前 RuntimeSnapshot。
   * @throws 当配置模块读取失败时，Promise 会 reject。
   */
  async reload(): Promise<RuntimeSnapshot> {
    this.snapshot = await this.configuration.getSnapshot()
    return this.snapshot
  }

  /**
   * 刷新运行时资源（Provider/模型/认证状态）并写入缓存。
   *
   * @returns 刷新后的 RuntimeSnapshot。
   * @throws 当配置模块刷新失败时，Promise 会 reject。
   */
  async refresh(): Promise<RuntimeSnapshot> {
    this.snapshot = await this.configuration.refresh()
    return this.snapshot
  }

  /**
   * 验证并保存运行时配置，再写入缓存。
   *
   * @param configuration - Provider、模型和 API Key。
   * @returns 保存后的 RuntimeSnapshot。
   * @throws 当配置验证或保存失败时，Promise 会 reject。
   */
  async saveConfiguration(
    configuration: RuntimeConfiguration,
  ): Promise<RuntimeSnapshot> {
    this.snapshot = await this.configuration.saveConfiguration(configuration)
    return this.snapshot
  }

  /**
   * 取消正在进行的运行时配置验证，再刷新缓存。
   *
   * @param request - 需要取消的验证标识。
   * @returns 取消后的 RuntimeSnapshot。
   * @throws 当取消配置验证失败时，Promise 会 reject。
   */
  async cancelConfigurationVerification(
    request: CancelConfigurationVerificationRequest,
  ): Promise<RuntimeSnapshot> {
    this.snapshot =
      await this.configuration.cancelConfigurationVerification(request)
    return this.snapshot
  }

  /**
   * 从最近的备份恢复配置文件。
   *
   * @returns 恢复后的 RuntimeSnapshot。
   * @throws 当配置恢复失败时，Promise 会 reject。
   */
  async restoreFromBackup(): Promise<RuntimeSnapshot> {
    this.snapshot = await this.configuration.restoreFromBackup()
    return this.snapshot
  }

  /**
   * 删除配置文件和备份（不删除 Agent 数据、用户资料或 Pi session），再重载缓存。
   *
   * @returns 重置后的 RuntimeSnapshot。
   * @throws 当配置重置失败时，Promise 会 reject。
   */
  async resetConfiguration(): Promise<RuntimeSnapshot> {
    await this.configuration.resetConfiguration()
    return this.reload()
  }

  async saveProvider(config: ProviderConfiguration): Promise<RuntimeSnapshot> {
    this.snapshot = await this.configuration.saveProvider(config)
    return this.snapshot
  }

  async deleteProvider(
    request: DeleteProviderRequest,
  ): Promise<RuntimeSnapshot> {
    this.snapshot = await this.configuration.deleteProvider(request)
    return this.snapshot
  }
}
