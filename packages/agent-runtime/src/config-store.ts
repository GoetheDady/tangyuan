import { constants as fsConstants } from 'node:fs'
import { access, copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  migrateConfigV1ToV2,
  persistedConfigurationV2Schema,
  type ConfigEncryptionAdapter,
  type ConfigRecoveryState,
  type InternalProviderCredentials,
  type InternalRuntimeConfig,
  type PersistedConfigurationV1,
  type PersistedConfigurationV2,
  type ProviderCredentials,
  type RuntimeConfiguration,
  TANGYUAN_DEFAULT_AGENT_ID,
} from '@tangyuan/contracts'
import type { DirectoryLayout } from './directory-layout'
import { AgentRuntimeError } from './errors'
import {
  createDefaultInternalConfig,
  extractAgentRuntimeConfig,
} from './utils'

/**
 * 读取配置的结果，含内容、完整性状态和是否存在备份。
 */
export interface ConfigReadResult {
  config: InternalRuntimeConfig | null
  recoveryState: ConfigRecoveryState
  hasBackup: boolean
}

/**
 * 创建 ConfigStore 所需的依赖。
 */
export interface ConfigStoreDependencies {
  layout: DirectoryLayout
  encryptionAdapter: ConfigEncryptionAdapter | null
  now: () => string
}

/**
 * 配置的磁盘存取：读取、写入、迁移、加解密、备份判断、恢复与重置。
 * 集中承载「汤圆配置在磁盘上如何存取」这一条知识，不涉及会话簇或快照重建。
 */
export class ConfigStore {
  private readonly layout: DirectoryLayout
  private readonly encryptionAdapter: ConfigEncryptionAdapter | null
  private readonly now: () => string

  constructor(dependencies: ConfigStoreDependencies) {
    this.layout = dependencies.layout
    this.encryptionAdapter = dependencies.encryptionAdapter
    this.now = dependencies.now
  }

  /**
   * 读取并解密磁盘上的配置；不存在时返回默认配置，损坏时标记恢复状态。
   *
   * @returns 配置读取结果。
   * @throws 此方法不会主动抛出错误（错误以 recoveryState 表达）。
   */
  async read(): Promise<ConfigReadResult> {
    const configPath = this.layout.config()

    try {
      const rawConfig = await readFile(configPath, 'utf8')
      const parsedConfig = JSON.parse(rawConfig) as Record<string, unknown>

      // 检测是否为 v1 格式（无 schemaVersion）
      if (typeof parsedConfig.schemaVersion !== 'number') {
        return this.migrateAndRead(
          parsedConfig as unknown as PersistedConfigurationV1,
        )
      }

      // v2 格式：校验 schema
      const parseResult = persistedConfigurationV2Schema.safeParse(parsedConfig)
      if (!parseResult.success) {
        return {
          config: null,
          recoveryState: 'corrupted',
          hasBackup: await this.hasBackup(),
        }
      }

      // 解密
      let config: InternalRuntimeConfig
      try {
        config = await this.decrypt(parseResult.data)
      } catch {
        return {
          config: null,
          recoveryState: 'corrupted',
          hasBackup: await this.hasBackup(),
        }
      }

      return {
        config,
        recoveryState: 'ok',
        hasBackup: await this.hasBackup(),
      }
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        return {
          config: createDefaultInternalConfig(),
          recoveryState: 'ok',
          hasBackup: false,
        }
      }

      return {
        config: null,
        recoveryState: 'corrupted',
        hasBackup: await this.hasBackup(),
      }
    }
  }

  /**
   * 读取指定 Agent 的运行时配置，配置缺失或损坏时抛错。
   *
   * @param agentId - Agent 标识，缺省为默认汤圆。
   * @returns 运行时配置。
   * @throws 当配置损坏或该 Agent 未配置 Provider/Model 时抛出 configuration-missing。
   */
  async readRequired(
    agentId: string = TANGYUAN_DEFAULT_AGENT_ID,
  ): Promise<RuntimeConfiguration> {
    const readResult = await this.read()

    if (readResult.recoveryState !== 'ok') {
      throw new AgentRuntimeError({
        code: 'configuration-missing',
        message: '配置文件已损坏，请先恢复或重置配置。',
        recoverable: true,
      })
    }

    if (!readResult.config) {
      throw new AgentRuntimeError({
        code: 'configuration-missing',
        message:
          '创建会话前，请先配置 Provider（模型服务）、Model（模型）和 API Key（接口密钥）。',
        recoverable: true,
      })
    }

    const runtimeConfig = extractAgentRuntimeConfig(readResult.config, agentId)

    if (!runtimeConfig) {
      throw new AgentRuntimeError({
        code: 'configuration-missing',
        message: `Agent「${agentId}」尚未配置 Provider 和 Model，请先在控制台中为该 Agent 设置默认模型。`,
        recoverable: true,
      })
    }

    return runtimeConfig
  }

  /**
   * 读取指定 Provider 的明文 API Key。
   *
   * @param providerId - Provider 标识。
   * @returns 明文 API Key；未配置时返回 undefined。
   * @throws 此方法不会主动抛出错误。
   */
  async readProviderApiKey(providerId: string): Promise<string | undefined> {
    const readResult = await this.read()
    const provider = readResult.config?.providers[providerId]
    return provider?.apiKey
  }

  /**
   * 加密并原子写入配置到磁盘，写入前备份当前配置。
   *
   * @param config - 待写入的内部配置。
   * @returns 无返回值。
   * @throws 当加密服务不可用或写入失败时抛出错误。
   */
  async write(config: InternalRuntimeConfig): Promise<void> {
    const configPath = this.layout.config()
    const backupPath = this.layout.configBackup()
    const tmpPath = `${configPath}.tmp`

    await mkdir(dirname(configPath), { recursive: true })

    // 加密
    const persisted = await this.encrypt(config)
    const serialized = `${JSON.stringify(persisted, null, 2)}\n`

    // 备份当前配置
    try {
      await copyFile(configPath, backupPath)
    } catch {
      // 当前配置文件不存在则不备份
    }

    // 原子写入
    await writeFile(tmpPath, serialized, 'utf8')
    await rename(tmpPath, configPath)
  }

  /**
   * 从备份恢复配置：校验备份格式与可解密性后原子写回。
   *
   * @returns 无返回值。
   * @throws 当无备份、备份损坏或格式不兼容时抛出 configuration-missing。
   */
  async restore(): Promise<void> {
    const backupPath = this.layout.configBackup()
    const configPath = this.layout.config()

    try {
      await access(backupPath, fsConstants.F_OK)
    } catch {
      throw new AgentRuntimeError({
        code: 'configuration-missing',
        message: '没有可用的配置备份。',
        recoverable: true,
      })
    }

    // 校验备份文件格式
    const rawBackup = await readFile(backupPath, 'utf8')
    let parsedBackup: unknown
    try {
      parsedBackup = JSON.parse(rawBackup)
    } catch {
      throw new AgentRuntimeError({
        code: 'configuration-missing',
        message: '备份文件已损坏，无法恢复。',
        recoverable: true,
      })
    }

    const parseResult = persistedConfigurationV2Schema.safeParse(parsedBackup)
    if (!parseResult.success) {
      throw new AgentRuntimeError({
        code: 'configuration-missing',
        message: '备份文件格式不兼容，无法恢复。',
        recoverable: true,
      })
    }

    // 校验能解密
    await this.decrypt(parseResult.data)

    // 写回备份内容
    await mkdir(dirname(configPath), { recursive: true })
    await writeFile(`${configPath}.tmp`, rawBackup, 'utf8')
    await rename(`${configPath}.tmp`, configPath)
  }

  /**
   * 删除配置文件、备份和临时文件（不删除 Agent 数据、用户资料或 Pi session）。
   *
   * @returns 无返回值。
   * @throws 当文件删除失败时，Promise 会 reject。
   */
  async reset(): Promise<void> {
    const configPath = this.layout.config()
    const backupPath = this.layout.configBackup()

    await Promise.all([
      rm(configPath, { force: true }),
      rm(backupPath, { force: true }),
      rm(`${configPath}.tmp`, { force: true }),
    ])
  }

  /**
   * 判断配置备份文件是否存在。
   *
   * @returns 备份存在时返回 true。
   * @throws 此方法不会主动抛出错误。
   */
  async hasBackup(): Promise<boolean> {
    try {
      await access(this.layout.configBackup(), fsConstants.F_OK)
      return true
    } catch {
      return false
    }
  }

  /**
   * 迁移 v1 配置到 v2 并写回磁盘。
   *
   * @param v1 - v1 格式的持久化配置。
   * @returns 迁移结果；迁移失败时标记 migration-failed。
   */
  private async migrateAndRead(
    v1: PersistedConfigurationV1,
  ): Promise<ConfigReadResult> {
    try {
      const internalConfig = migrateConfigV1ToV2(v1, this.now())
      await this.write(internalConfig)
      return {
        config: internalConfig,
        recoveryState: 'ok',
        hasBackup: false,
      }
    } catch {
      return {
        config: null,
        recoveryState: 'migration-failed',
        hasBackup: await this.hasBackup(),
      }
    }
  }

  /**
   * 加密内部配置中的 Provider 凭据，供写入磁盘。
   *
   * @param config - 明文内部配置。
   * @returns 加密后的持久化配置。
   * @throws 当加密服务不可用时抛出 driver-unavailable。
   */
  private async encrypt(
    config: InternalRuntimeConfig,
  ): Promise<PersistedConfigurationV2> {
    const adapter = this.requireEncryptionAdapter()
    const providers: Record<string, ProviderCredentials> = {}
    for (const [providerId, creds] of Object.entries(config.providers)) {
      providers[providerId] = {
        encryptedApiKey: await adapter.encrypt(creds.apiKey),
        updatedAt: creds.updatedAt,
      }
    }
    return {
      schemaVersion: 2,
      providers,
      agents: config.agents,
    }
  }

  /**
   * 解密磁盘配置中的 Provider 凭据。
   *
   * @param persisted - 加密的持久化配置。
   * @returns 明文内部配置。
   * @throws 当加密服务不可用或解密失败时抛出错误。
   */
  private async decrypt(
    persisted: PersistedConfigurationV2,
  ): Promise<InternalRuntimeConfig> {
    const adapter = this.requireEncryptionAdapter()
    const providers: Record<string, InternalProviderCredentials> = {}
    for (const [providerId, creds] of Object.entries(persisted.providers)) {
      try {
        providers[providerId] = {
          apiKey: await adapter.decrypt(creds.encryptedApiKey),
          updatedAt: creds.updatedAt,
        }
      } catch {
        throw new AgentRuntimeError({
          code: 'configuration-missing',
          message: '无法解密配置凭据，操作系统加密服务可能已变更。',
          recoverable: true,
        })
      }
    }
    return {
      schemaVersion: persisted.schemaVersion,
      providers,
      agents: persisted.agents,
    }
  }

  /**
   * 获取可用的加密适配器，不可用时抛错。
   *
   * @returns 加密适配器。
   * @throws 当加密服务不可用时抛出 driver-unavailable。
   */
  private requireEncryptionAdapter(): ConfigEncryptionAdapter {
    if (!this.encryptionAdapter || !this.encryptionAdapter.isAvailable()) {
      throw new AgentRuntimeError({
        code: 'driver-unavailable',
        message: '加密服务不可用，无法保存或读取配置。',
        recoverable: false,
      })
    }
    return this.encryptionAdapter
  }
}
