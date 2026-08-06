import type { LastActiveSessionStore } from '../session/last-active-session-store'
import type {
  AgentLifecycleModule,
  ProfileModule,
  RuntimeConfigurationModule,
  SessionModule,
  SkillModule,
} from './runtime-modules'

/**
 * 创建 YuanxiaoRuntime 时需要组合的内部职责模块。
 */
export interface YuanxiaoRuntimeDependencies {
  configuration: RuntimeConfigurationModule
  sessions: SessionModule
  agents: AgentLifecycleModule
  profiles: ProfileModule
  skills: SkillModule
  lastActiveSessionStore?: Pick<
    LastActiveSessionStore,
    'read' | 'write' | 'clear'
  >
}
