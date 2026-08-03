import {
  YUANXIAO_DEFAULT_AGENT_ID,
  createAgentProfileStatus,
  createRuntimeSnapshot,
  type CancelConfigurationVerificationRequest,
  type DeleteProviderRequest,
  type ProviderAuthSnapshot,
  type ProviderConfiguration,
  type RuntimeConfiguration,
  type RuntimeSnapshot,
} from '@yuanxiao/contracts'
import type { AgentRegistry } from '../agent'
import type { ConfigStore } from '../core/config-store'
import {
  AgentRuntimeError,
  buildInternalConfigForProviderDelete,
  buildInternalConfigForProviderSave,
  buildInternalConfigForSave,
  extractAgentRuntimeConfig,
  isAbortError,
  normalizeRuntimeConfiguration,
  sanitizeErrorMessage,
} from '../core'
import type { PiSdkGateway } from '../driver/pi-sdk-driver-contracts'
import type { ProfileStore } from '../profile'
import type { RuntimeConfigurationModule } from './runtime-modules'

const CONFIGURATION_VERIFICATION_PROMPT = 'Reply with OK.'

export interface DefaultRuntimeConfigurationDependencies {
  agentHomePath: string
  agentRegistry: AgentRegistry
  configStore: ConfigStore
  gateway: PiSdkGateway
  now: () => string
  profileStore: ProfileStore
}

/**
 * Runtime 配置模块：集中管理 Provider 验证、配置持久化和资源快照。
 */
export class DefaultRuntimeConfiguration implements RuntimeConfigurationModule {
  private readonly agentHomePath: string
  private readonly agentRegistry: AgentRegistry
  private readonly configStore: ConfigStore
  private readonly gateway: PiSdkGateway
  private readonly now: () => string
  private readonly profileStore: ProfileStore
  private verificationController: AbortController | null = null

  constructor(dependencies: DefaultRuntimeConfigurationDependencies) {
    this.agentHomePath = dependencies.agentHomePath
    this.agentRegistry = dependencies.agentRegistry
    this.configStore = dependencies.configStore
    this.gateway = dependencies.gateway
    this.now = dependencies.now
    this.profileStore = dependencies.profileStore
  }

  async getSnapshot(): Promise<RuntimeSnapshot> {
    return this.readSnapshot()
  }

  async refresh(): Promise<RuntimeSnapshot> {
    return this.readSnapshot()
  }

  async saveConfiguration(
    configuration: RuntimeConfiguration,
  ): Promise<RuntimeSnapshot> {
    const normalized = normalizeRuntimeConfiguration(configuration)
    await this.verify(normalized)

    const readResult = await this.configStore.read()
    await this.configStore.write(
      buildInternalConfigForSave(readResult.config, normalized, this.now()),
    )
    return this.readSnapshot()
  }

  async cancelConfigurationVerification(
    request: CancelConfigurationVerificationRequest,
  ): Promise<RuntimeSnapshot> {
    void request
    this.verificationController?.abort()
    this.verificationController = null
    return this.readSnapshot()
  }

  async saveProvider(config: ProviderConfiguration): Promise<RuntimeSnapshot> {
    const providerId = config.providerId.trim()
    const apiKey = config.apiKey.trim()

    if (!providerId || !apiKey) {
      throw new AgentRuntimeError({
        code: 'configuration-missing',
        message: '请填写 Provider（模型服务）和 API Key（接口密钥）。',
        recoverable: true,
      })
    }

    const resources = await this.gateway.listProvidersAndModels()
    const firstModel = resources.models.find(
      (model) => model.providerId === providerId,
    )
    if (!firstModel) {
      throw new AgentRuntimeError({
        code: 'configuration-missing',
        message: `未找到 Provider "${providerId}" 的可用模型。`,
        recoverable: true,
      })
    }

    await this.verify({
      providerId,
      modelId: firstModel.modelId,
      apiKey,
    })

    const readResult = await this.configStore.read()
    await this.configStore.write(
      buildInternalConfigForProviderSave(
        readResult.config,
        providerId,
        apiKey,
        this.now(),
      ),
    )
    return this.readSnapshot()
  }

  async deleteProvider(
    request: DeleteProviderRequest,
  ): Promise<RuntimeSnapshot> {
    const readResult = await this.configStore.read()
    await this.configStore.write(
      buildInternalConfigForProviderDelete(
        readResult.config,
        request.providerId,
      ),
    )
    return this.readSnapshot()
  }

  async restoreFromBackup(): Promise<RuntimeSnapshot> {
    await this.configStore.restore()
    return this.readSnapshot()
  }

  async resetConfiguration(): Promise<void> {
    await this.configStore.reset()
  }

  static maskApiKey(apiKey: string): string {
    const trimmed = apiKey.trim()
    if (trimmed.length <= 8) return '•'.repeat(trimmed.length)
    return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`
  }

  private async readSnapshot(): Promise<RuntimeSnapshot> {
    const homeStatus = await this.profileStore.ensureDefaultAgentHome()
    const readResult = await this.configStore.read()
    const [resources, hasBackup] = await Promise.all([
      this.gateway.listProvidersAndModels(),
      this.configStore.hasBackup(),
    ])
    const runtimeConfig = readResult.config
      ? extractAgentRuntimeConfig(readResult.config, YUANXIAO_DEFAULT_AGENT_ID)
      : null
    const configuredProviders: Record<string, ProviderAuthSnapshot> = {}

    if (readResult.config) {
      for (const [providerId, credentials] of Object.entries(
        readResult.config.providers,
      )) {
        configuredProviders[providerId] = {
          configured: true,
          maskedValue: DefaultRuntimeConfiguration.maskApiKey(
            credentials.apiKey,
          ),
        }
      }
    }

    return createRuntimeSnapshot({
      activeAgent: {
        agentId: YUANXIAO_DEFAULT_AGENT_ID,
        displayName: '元宵',
        homePath: this.agentHomePath,
        profile: createAgentProfileStatus(homeStatus),
      },
      agents: await this.agentRegistry.buildAgentSummaries(readResult.config),
      providers: resources.providers,
      models: resources.models,
      settings: {
        selectedProviderId: runtimeConfig?.providerId ?? null,
        selectedModelId: runtimeConfig?.modelId ?? null,
      },
      configuredProviders,
      auth: {
        apiKey: {
          configured: Boolean(runtimeConfig?.apiKey),
          maskedValue: runtimeConfig?.apiKey
            ? DefaultRuntimeConfiguration.maskApiKey(runtimeConfig.apiKey)
            : null,
        },
      },
      configRecovery: {
        state: readResult.recoveryState,
        hasBackup,
      },
    })
  }

  private async verify(configuration: RuntimeConfiguration): Promise<void> {
    const controller = new AbortController()
    this.verificationController = controller

    try {
      await this.gateway.verifyConfiguration({
        ...configuration,
        prompt: CONFIGURATION_VERIFICATION_PROMPT,
        signal: controller.signal,
      })
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) {
        throw new AgentRuntimeError({
          code: 'run-cancelled',
          message: '已取消配置验证。',
          recoverable: true,
        })
      }
      throw new AgentRuntimeError({
        code: 'provider-verification-failed',
        message: `配置验证失败：${sanitizeErrorMessage(error, configuration.apiKey)}`,
        recoverable: true,
      })
    } finally {
      if (this.verificationController === controller) {
        this.verificationController = null
      }
    }
  }
}
