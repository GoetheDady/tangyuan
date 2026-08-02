import type { AgentSessionDriver, RuntimeResourceDriver } from '../driver'
import type { LastActiveSessionStore } from '../session/last-active-session-store'

/**
 * 创建 YuanxiaoRuntime 时需要注入的内部 Driver。
 */
export interface YuanxiaoRuntimeDependencies {
  runtimeDriver: RuntimeResourceDriver
  sessionDriver: AgentSessionDriver
  lastActiveSessionStore?: Pick<
    LastActiveSessionStore,
    'read' | 'write' | 'clear'
  >
}
