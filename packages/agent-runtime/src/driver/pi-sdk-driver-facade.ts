import type {
  AgentConfig,
  AgentId,
  AgentSummary,
  CancelConfigurationVerificationRequest,
  DeleteProviderRequest,
  ProfileUpdateResult,
  ProviderConfiguration,
  RuntimeConfiguration,
  RuntimeSnapshot,
  SkillInstallRecord,
  SkillOperationParams,
  SkillSummary,
  SoulContent,
  UnclaimedDirectory,
  UserProfileContent,
} from '@yuanxiao/contracts'
import type {
  AgentLifecycleModule,
  ProfileModule,
  RuntimeConfigurationModule,
  SkillModule,
} from '../runtime/runtime-modules'
import { DefaultRuntimeConfiguration } from '../runtime/runtime-configuration'
import { PiSdkDriverResources } from './pi-sdk-driver-resources'

/**
 * PiSdkDriver 的旧公开兼容门面；生产 Runtime 直接注入对应职责模块。
 */
export abstract class PiSdkDriverFacade
  extends PiSdkDriverResources
  implements
    RuntimeConfigurationModule,
    AgentLifecycleModule,
    ProfileModule,
    SkillModule
{
  static maskApiKey(apiKey: string): string {
    return DefaultRuntimeConfiguration.maskApiKey(apiKey)
  }

  async getSnapshot(): Promise<RuntimeSnapshot> {
    return this.configurationModule.getSnapshot()
  }

  async refresh(): Promise<RuntimeSnapshot> {
    return this.configurationModule.refresh()
  }

  async saveConfiguration(
    configuration: RuntimeConfiguration,
  ): Promise<RuntimeSnapshot> {
    return this.configurationModule.saveConfiguration(configuration)
  }

  async cancelConfigurationVerification(
    request: CancelConfigurationVerificationRequest,
  ): Promise<RuntimeSnapshot> {
    return this.configurationModule.cancelConfigurationVerification(request)
  }

  async saveProvider(config: ProviderConfiguration): Promise<RuntimeSnapshot> {
    return this.configurationModule.saveProvider(config)
  }

  async deleteProvider(
    request: DeleteProviderRequest,
  ): Promise<RuntimeSnapshot> {
    return this.configurationModule.deleteProvider(request)
  }

  async restoreFromBackup(): Promise<RuntimeSnapshot> {
    return this.configurationModule.restoreFromBackup()
  }

  async resetConfiguration(): Promise<void> {
    return this.configurationModule.resetConfiguration()
  }

  async getSoul(agentId: AgentId): Promise<SoulContent> {
    return this.profileModule.getSoul(agentId)
  }

  async getUserProfile(): Promise<UserProfileContent> {
    return this.profileModule.getUserProfile()
  }

  async updateSoul(
    agentId: AgentId,
    content: string,
    expectedVersion: string,
  ): Promise<ProfileUpdateResult> {
    return this.profileModule.updateSoul(agentId, content, expectedVersion)
  }

  async updateUserProfile(
    content: string,
    expectedVersion: string,
  ): Promise<ProfileUpdateResult> {
    return this.profileModule.updateUserProfile(content, expectedVersion)
  }

  async listAgents(): Promise<AgentSummary[]> {
    return this.agentRegistry.listAgents()
  }

  async createAgent(displayName: string): Promise<AgentSummary> {
    return this.agentRegistry.createAgent(displayName)
  }

  async updateAgentConfig(
    agentId: AgentId,
    patch: Partial<Pick<AgentConfig, 'defaultProviderId' | 'defaultModelId'>>,
  ): Promise<AgentSummary> {
    return this.agentRegistry.updateAgentConfig(agentId, patch)
  }

  async archiveAgent(agentId: AgentId): Promise<AgentSummary> {
    return this.agentRegistry.archiveAgent(agentId)
  }

  async recoverAgent(agentId: AgentId): Promise<AgentSummary> {
    return this.agentRegistry.recoverAgent(agentId)
  }

  async reconcileAgentDirectories(): Promise<{
    agents: AgentSummary[]
    unclaimedDirectories: UnclaimedDirectory[]
  }> {
    return this.agentRegistry.reconcileAgentDirectories()
  }

  async claimAgentDirectory(
    agentId: string,
    displayName: string,
  ): Promise<AgentSummary> {
    return this.agentRegistry.claimAgentDirectory(agentId, displayName)
  }

  async rebuildYuanxiaoHome(): Promise<AgentSummary> {
    return this.agentRegistry.rebuildYuanxiaoHome()
  }

  async listAgentSkills(agentId: AgentId): Promise<SkillSummary[]> {
    return this.skillStore.listAgentSkills(agentId)
  }

  async listSharedSkills(): Promise<SkillSummary[]> {
    return this.skillStore.listSharedSkills()
  }

  async installSkill(params: SkillOperationParams): Promise<SkillSummary[]> {
    return this.skillStore.installSkill(params)
  }

  async deleteSkill(params: SkillOperationParams): Promise<SkillSummary[]> {
    return this.skillStore.deleteSkill(params)
  }

  async getSkillInstallRecords(): Promise<SkillInstallRecord[]> {
    return this.skillStore.getSkillInstallRecords()
  }
}
