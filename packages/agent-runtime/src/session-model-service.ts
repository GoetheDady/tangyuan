import type {
  GetSessionModelInfoRequest,
  SessionModelInfo,
  SetSessionModelRequest,
  SetSessionThinkingLevelRequest,
} from '@tangyuan/contracts'
import type { AgentSessionDriver } from './index'

/**
 * 创建 SessionModelService 所需的依赖。
 */
export interface SessionModelServiceDependencies {
  sessionDriver: AgentSessionDriver
}

/**
 * 会话模型服务：承载「某 Session 的模型信息如何读取、切换 Provider/Model、
 * 切换 Thinking Level」这一族操作。无独立状态，直接编排 sessionDriver。
 */
export class SessionModelService {
  private readonly sessionDriver: AgentSessionDriver

  constructor(dependencies: SessionModelServiceDependencies) {
    this.sessionDriver = dependencies.sessionDriver
  }

  /**
   * 读取当前 Session 的模型和 Thinking Level 信息。
   *
   * @param request - Agent 和 Session 标识。
   * @returns Session 模型信息。
   * @throws 当 Driver 不支持或读取失败时，Promise 会 reject。
   */
  async getInfo(request: GetSessionModelInfoRequest): Promise<SessionModelInfo> {
    if (!this.sessionDriver.getSessionModelInfo) {
      throw new Error('当前运行时不支持读取 Session 模型信息。')
    }
    return this.sessionDriver.getSessionModelInfo(request)
  }

  /**
   * 切换当前 Session 的 Provider 和 Model。
   *
   * @param request - Agent、Session 标识和目标 Provider/Model。
   * @returns 切换后的模型信息。
   * @throws 当 Driver 不支持或切换失败时，Promise 会 reject。
   */
  async setModel(request: SetSessionModelRequest): Promise<SessionModelInfo> {
    if (!this.sessionDriver.setSessionModel) {
      throw new Error('当前运行时不支持切换 Session 模型。')
    }
    return this.sessionDriver.setSessionModel(request)
  }

  /**
   * 切换当前 Session 的 Thinking Level。
   *
   * @param request - Agent、Session 标识和目标 Thinking Level。
   * @returns 切换后的模型信息。
   * @throws 当 Driver 不支持或切换失败时，Promise 会 reject。
   */
  async setThinkingLevel(
    request: SetSessionThinkingLevelRequest,
  ): Promise<SessionModelInfo> {
    if (!this.sessionDriver.setSessionThinkingLevel) {
      throw new Error('当前运行时不支持切换 Thinking Level。')
    }
    return this.sessionDriver.setSessionThinkingLevel(request)
  }
}
