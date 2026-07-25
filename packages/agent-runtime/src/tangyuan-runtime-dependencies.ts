import type {
  AgentSessionDriver,
  RuntimeResourceDriver,
} from './pi-sdk-driver-contracts'

/**
 * 创建 TangyuanRuntime 时需要注入的内部 Driver。
 */
export interface TangyuanRuntimeDependencies {
  runtimeDriver: RuntimeResourceDriver
  sessionDriver: AgentSessionDriver
}
