import type { ToolApprovalGateway } from '../driver'
import { createToolApprovalGateway } from '../approval'
import type {
  BashApprovalRequest,
  QuestionClarificationRequest,
  SkillApprovalRequest,
  SkillInstallRecord,
  SkillOperationParams,
  SkillSummary,
} from '@yuanxiao/contracts'
import { YuanxiaoRuntimeOrchestrator } from './yuanxiao-runtime-orchestrator'

/** Runtime 的 Bash、澄清和 Skill 审批门面。 */
export abstract class YuanxiaoRuntimeApprovals extends YuanxiaoRuntimeOrchestrator {
  async approveBash(approvalId: string): Promise<void> {
    this.bashApprovals.approve(approvalId)
  }

  async rejectBash(approvalId: string): Promise<void> {
    this.bashApprovals.reject(approvalId)
  }

  getPendingApprovals(): BashApprovalRequest[] {
    return this.bashApprovals.list()
  }

  async answerClarification(
    clarificationId: string,
    answer: string,
  ): Promise<void> {
    this.clarifications.answer(clarificationId, answer)
  }

  async cancelClarification(clarificationId: string): Promise<void> {
    this.clarifications.cancel(clarificationId)
  }

  getPendingClarifications(): QuestionClarificationRequest[] {
    return this.clarifications.list()
  }

  async installSkill(params: SkillOperationParams): Promise<SkillSummary[]> {
    return this.skillService.install(params)
  }

  async deleteSkill(params: SkillOperationParams): Promise<SkillSummary[]> {
    return this.skillService.delete(params)
  }

  async approveSkillOperation(approvalId: string): Promise<void> {
    this.skillService.approveOperation(approvalId)
  }

  async rejectSkillOperation(approvalId: string): Promise<void> {
    this.skillService.rejectOperation(approvalId)
  }

  getPendingSkillApprovals(): SkillApprovalRequest[] {
    return this.skillService.getPendingApprovals()
  }

  async getSkillInstallRecords(): Promise<SkillInstallRecord[]> {
    return this.skillService.getInstallRecords()
  }

  createToolApprovalGateway(): ToolApprovalGateway {
    return createToolApprovalGateway({
      bashApprovals: this.bashApprovals,
      clarifications: this.clarifications,
      resolveRunId: (sessionId) => this.activeRunIds.get(sessionId) || '',
      now: () => new Date().toISOString(),
    })
  }
}
