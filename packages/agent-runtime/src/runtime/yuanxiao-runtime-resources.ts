import type {
  AgentSummary,
  GetSessionModelInfoRequest,
  ProfileUpdateResult,
  SessionModelInfo,
  SetSessionModelRequest,
  SetSessionThinkingLevelRequest,
  SkillSummary,
  SoulContent,
  UnclaimedDirectory,
  UpdateAgentConfigRequest,
  UserProfileContent,
} from '@yuanxiao/contracts'
import { YuanxiaoRuntimeScheduling } from './yuanxiao-runtime-scheduling'

/**
 * Runtime 的 Agent、模型、Skill 与 Profile 高层门面。
 */
export abstract class YuanxiaoRuntimeResources extends YuanxiaoRuntimeScheduling {
  async listAgents(): Promise<AgentSummary[]> {
    return this.agentManager.list()
  }

  async createAgent(displayName: string): Promise<AgentSummary> {
    return this.agentManager.create(displayName)
  }

  async updateAgentConfig(
    request: UpdateAgentConfigRequest,
  ): Promise<AgentSummary> {
    return this.agentManager.updateConfig(request)
  }

  async archiveAgent(agentId: string): Promise<AgentSummary> {
    return this.agentManager.archive(agentId)
  }

  async recoverAgent(agentId: string): Promise<AgentSummary> {
    return this.agentManager.recover(agentId)
  }

  async reconcileAgentDirectories(): Promise<{
    agents: AgentSummary[]
    unclaimedDirectories: UnclaimedDirectory[]
  }> {
    return this.agentManager.reconcileDirectories()
  }

  async claimAgentDirectory(
    agentId: string,
    displayName: string,
  ): Promise<AgentSummary> {
    return this.agentManager.claimDirectory(agentId, displayName)
  }

  async rebuildYuanxiaoHome(): Promise<AgentSummary> {
    return this.agentManager.rebuildYuanxiaoHome()
  }

  async getSessionModelInfo(
    request: GetSessionModelInfoRequest,
  ): Promise<SessionModelInfo> {
    return this.sessionModelService.getInfo(request)
  }

  async setSessionModel(
    request: SetSessionModelRequest,
  ): Promise<SessionModelInfo> {
    return this.sessionModelService.setModel(request)
  }

  async setSessionThinkingLevel(
    request: SetSessionThinkingLevelRequest,
  ): Promise<SessionModelInfo> {
    return this.sessionModelService.setThinkingLevel(request)
  }

  async listAgentSkills(agentId: string): Promise<SkillSummary[]> {
    return this.skillService.listAgentSkills(agentId)
  }

  async listSharedSkills(): Promise<SkillSummary[]> {
    return this.skillService.listSharedSkills()
  }

  async reloadAgentSessions(agentId: string): Promise<void> {
    return this.sessions.reloadAgentSessions(agentId)
  }

  async reloadAllSessions(): Promise<void> {
    return this.sessions.reloadAllSessions()
  }

  async getSoul(agentId: string): Promise<SoulContent> {
    return this.identityService.getSoul(agentId)
  }

  async getUserProfile(): Promise<UserProfileContent> {
    return this.identityService.getUserProfile()
  }

  async updateSoul(
    agentId: string,
    content: string,
    expectedVersion: string,
  ): Promise<ProfileUpdateResult> {
    return this.identityService.updateSoul(agentId, content, expectedVersion)
  }

  async updateUserProfile(
    content: string,
    expectedVersion: string,
  ): Promise<ProfileUpdateResult> {
    return this.identityService.updateUserProfile(content, expectedVersion)
  }
}
