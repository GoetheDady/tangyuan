import type { AgentEvent } from '../driver'
import { AgentManager, IdentityService } from '../agent'
import { TranscriptEmitter } from '../session/transcript-emitter'
import { SkillService } from '../skill'
import { RuntimeSnapshotStore } from './runtime-snapshot-store'
import type { YuanxiaoRuntimeDependencies } from './yuanxiao-runtime-dependencies'

/** 创建 Runtime 私有实现所需的内部 module。 */
export function createRuntimeInternals(
  dependencies: YuanxiaoRuntimeDependencies,
  emit: (event: AgentEvent) => void,
) {
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
    skillService: new SkillService({
      skills: dependencies.skills,
      sessions: dependencies.sessions,
      defaultAgentId: 'yuanxiao',
    }),
  }
}
