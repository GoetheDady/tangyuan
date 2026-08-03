import type { AgentEvent } from '../driver'
import { TranscriptEmitter } from '../session/transcript-emitter'
import { BashApprovalRegistry, ClarificationRegistry } from '../approval'
import { RuntimeSnapshotStore } from './runtime-snapshot-store'
import { AgentManager, IdentityService } from '../agent'
import { SkillService } from '../skill'
import { SessionModelService } from '../session/session-model-service'
import { YUANXIAO_DEFAULT_AGENT_ID } from '@yuanxiao/contracts'
import type { YuanxiaoRuntimeDependencies } from './yuanxiao-runtime-dependencies'

/**
 * Runtime 编排器依赖的内部服务集合。
 *
 * 由 createRuntimeServices 统一创建并注入，使服务装配集中在工厂；
 * 测试可整体注入自定义集合，替换部分内部服务。
 */
export interface RuntimeServices {
  transcriptEmitter: TranscriptEmitter
  snapshotStore: RuntimeSnapshotStore
  agentManager: AgentManager
  identityService: IdentityService
  sessionModelService: SessionModelService
  bashApprovals: BashApprovalRegistry
  skillService: SkillService
  clarifications: ClarificationRegistry
}

/**
 * 创建 Runtime 编排器所需的全部内部服务。
 *
 * 提取自 YuanxiaoRuntimeOrchestrator 构造函数，集中承载服务装配，
 * 构造函数只负责接受这些服务并编排事件流。
 *
 * @param dependencies - Runtime 所需的职责模块。
 * @param emit - 向公开订阅者广播事件的回调（通常绑定 Orchestrator 实例）。
 * @param now - 当前时间戳生成函数。
 * @returns 已装配的 Runtime 内部服务集合。
 * @throws 此函数不会主动抛出错误。
 */
export function createRuntimeServices(
  dependencies: YuanxiaoRuntimeDependencies,
  emit: (event: AgentEvent) => void,
  now: () => string,
): RuntimeServices {
  const snapshotStore = new RuntimeSnapshotStore({
    configuration: dependencies.configuration,
  })

  return {
    transcriptEmitter: new TranscriptEmitter(emit),
    snapshotStore,
    agentManager: new AgentManager({
      agents: dependencies.agents,
      snapshotStore,
    }),
    identityService: new IdentityService({
      profiles: dependencies.profiles,
      snapshotStore,
    }),
    sessionModelService: new SessionModelService({
      sessions: dependencies.sessions,
    }),
    bashApprovals: new BashApprovalRegistry({ emit, now }),
    skillService: new SkillService({
      skills: dependencies.skills,
      sessions: dependencies.sessions,
      defaultAgentId: YUANXIAO_DEFAULT_AGENT_ID,
      emit,
      now,
    }),
    clarifications: new ClarificationRegistry({ emit, now }),
  }
}
