import type {
  GetSessionModelInfoRequest,
  SessionModelInfo,
  SetSessionModelRequest,
  SetSessionThinkingLevelRequest,
} from '@yuanxiao/contracts'
import type { SessionModule } from '../runtime/runtime-modules'

/**
 * 创建 SessionModelService 所需的依赖。
 */
export interface SessionModelServiceDependencies {
  sessions: SessionModule
}

/**
 * 会话模型服务：承载「某 Session 的模型信息如何读取、切换 Provider/Model、
 * 切换 Thinking Level」这一族操作。无独立状态，直接编排 SessionModule。
 */
export class SessionModelService {
  private readonly sessions: SessionModule

  constructor(dependencies: SessionModelServiceDependencies) {
    this.sessions = dependencies.sessions
  }

  /**
   * 读取当前 Session 的模型和 Thinking Level 信息。
   *
   * @param request - Agent 和 Session 标识。
   * @returns Session 模型信息。
   * @throws 当 Session 模块读取失败时，Promise 会 reject。
   */
  async getInfo(
    request: GetSessionModelInfoRequest,
  ): Promise<SessionModelInfo> {
    return this.sessions.getSessionModelInfo(request)
  }

  /**
   * 切换当前 Session 的 Provider 和 Model。
   *
   * @param request - Agent、Session 标识和目标 Provider/Model。
   * @returns 切换后的模型信息。
   * @throws 当 Session 模块切换失败时，Promise 会 reject。
   */
  async setModel(request: SetSessionModelRequest): Promise<SessionModelInfo> {
    return this.sessions.setSessionModel(request)
  }

  /**
   * 切换当前 Session 的 Thinking Level。
   *
   * @param request - Agent、Session 标识和目标 Thinking Level。
   * @returns 切换后的模型信息。
   * @throws 当 Session 模块切换失败时，Promise 会 reject。
   */
  async setThinkingLevel(
    request: SetSessionThinkingLevelRequest,
  ): Promise<SessionModelInfo> {
    return this.sessions.setSessionThinkingLevel(request)
  }
}
