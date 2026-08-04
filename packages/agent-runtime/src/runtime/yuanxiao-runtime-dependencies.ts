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
  /** 生产环境的 Agent 命令许可持久化路径；测试可省略以使用内存。 */
  commandPermissionFilePath?: string
  lastActiveSessionStore?: Pick<
    LastActiveSessionStore,
    'read' | 'write' | 'clear'
  >
}
