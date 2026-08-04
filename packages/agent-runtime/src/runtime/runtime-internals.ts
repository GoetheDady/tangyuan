import { YUANXIAO_DEFAULT_AGENT_ID } from '@yuanxiao/contracts'
import type { AgentEvent } from '../driver'
import { CommandPermissionModule, ClarificationRegistry } from '../approval'
import { AgentManager, IdentityService } from '../agent'
import { TranscriptEmitter } from '../session/transcript-emitter'
import { SkillService } from '../skill'
import { RuntimeSnapshotStore } from './runtime-snapshot-store'
import type { YuanxiaoRuntimeDependencies } from './yuanxiao-runtime-dependencies'

/** 创建 Runtime 私有实现所需的内部 module。 */
export function createRuntimeInternals(
  dependencies: YuanxiaoRuntimeDependencies,
  emit: (event: AgentEvent) => void,
  now: () => string,
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
    commandPermissions: new CommandPermissionModule({
      emit,
      now,
      ...(dependencies.commandPermissionFilePath
        ? { filePath: dependencies.commandPermissionFilePath }
        : {}),
    }),
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
