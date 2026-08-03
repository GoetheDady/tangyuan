import { AgentRuntimeError } from '../core'
import {
  type AgentEventListener,
  type AgentEventSubscription,
  type GetSessionModelInfoRequest,
  type SessionModelInfo,
  type SetSessionModelRequest,
  type SetSessionThinkingLevelRequest,
} from '@yuanxiao/contracts'
import { PiSdkDriverState } from './pi-sdk-driver-state'

export class PiSdkDriverResources extends PiSdkDriverState {
  /**
   * 订阅标准 Agent 事件。
   *
   * @param listener - 接收标准事件的回调。
   * @returns 可取消订阅的句柄。
   * @throws 此方法不会主动抛出错误。
   */
  subscribe(listener: AgentEventListener): AgentEventSubscription {
    this.listeners.add(listener)

    return {
      unsubscribe: () => {
        this.listeners.delete(listener)
      },
    }
  }

  /**
   * 重新加载指定 Agent 所有活跃 session 的 ResourceLoader。
   *
   * 用于 Agent 专属 Skill 变更后刷新该 Agent 的会话。
   *
   * @param agentId - Agent 标识。
   * @returns 无返回值。
   * @throws 当某个 session 的 reload 失败时，Promise 会 reject。
   */
  async reloadAgentSessions(agentId: string): Promise<void> {
    const promises: Promise<void>[] = []

    for (const [sessionId, handle] of this.sessionHandles) {
      const indexEntry = this.sessionIndexStore.getEntryOrNull(sessionId)
      if (indexEntry?.agentId === agentId && handle.reload) {
        promises.push(handle.reload())
      }
    }

    await Promise.all(promises)
  }

  /**
   * 重新加载全部活跃 session 的 ResourceLoader。
   *
   * 用于共享 Skill 变更后刷新所有 Agent 的会话。
   *
   * @returns 无返回值。
   * @throws 当某个 session 的 reload 失败时，Promise 会 reject。
   */
  async reloadAllSessions(): Promise<void> {
    const promises: Promise<void>[] = []

    for (const handle of this.sessionHandles.values()) {
      if (handle.reload) {
        promises.push(handle.reload())
      }
    }

    await Promise.all(promises)
  }

  /**
   * 读取当前 Session 的模型和 Thinking Level 信息。
   *
   * @param request - Agent 和 Session 标识。
   * @returns Session 模型信息。
   * @throws 当 Session 不存在或读取失败时，Promise 会 reject。
   */
  async getSessionModelInfo(
    request: GetSessionModelInfoRequest,
  ): Promise<SessionModelInfo> {
    this.assertKnownSession(request.sessionId, request.agentId)
    const handle = await this.ensureSessionHandle(request.sessionId)

    if (!handle.getModelInfo) {
      throw new AgentRuntimeError({
        code: 'driver-unavailable',
        message: '当前会话不支持读取模型信息。',
        recoverable: true,
      })
    }

    return handle.getModelInfo()
  }

  /**
   * 切换当前 Session 的 Provider 和 Model。
   *
   * @param request - Agent、Session 标识和目标 Provider/Model。
   * @returns 切换后的模型信息。
   * @throws 当 Session 不存在或模型切换失败时，Promise 会 reject。
   */
  async setSessionModel(
    request: SetSessionModelRequest,
  ): Promise<SessionModelInfo> {
    this.assertKnownSession(request.sessionId, request.agentId)
    const handle = await this.ensureSessionHandle(request.sessionId)

    if (!handle.setModel) {
      throw new AgentRuntimeError({
        code: 'driver-unavailable',
        message: '当前会话不支持切换模型。',
        recoverable: true,
      })
    }

    // 读取目标 Provider 的 API Key 用于跨 Provider 切换
    const indexEntry = this.sessionIndexStore.getEntry(request.sessionId)
    const configuration = await this.configStore.readRequired(
      indexEntry.agentId,
    )
    const targetApiKey =
      request.providerId !== (indexEntry.provider || configuration.providerId)
        ? await this.configStore.readProviderApiKey(request.providerId)
        : undefined

    await handle.setModel(request.providerId, request.modelId, targetApiKey)
    await this.sessionIndexStore.updateEntry(request.sessionId, {
      provider: request.providerId,
      model: request.modelId,
    })

    if (!handle.getModelInfo) {
      throw new AgentRuntimeError({
        code: 'driver-unavailable',
        message: '当前会话不支持读取模型信息。',
        recoverable: true,
      })
    }

    return handle.getModelInfo()
  }

  /**
   * 切换当前 Session 的 Thinking Level。
   *
   * @param request - Agent、Session 标识和目标 Thinking Level。
   * @returns 切换后的模型信息。
   * @throws 当 Session 不存在或不支持 Thinking 时，Promise 会 reject。
   */
  async setSessionThinkingLevel(
    request: SetSessionThinkingLevelRequest,
  ): Promise<SessionModelInfo> {
    this.assertKnownSession(request.sessionId, request.agentId)
    const handle = await this.ensureSessionHandle(request.sessionId)

    if (!handle.setThinkingLevel) {
      throw new AgentRuntimeError({
        code: 'driver-unavailable',
        message: '当前会话不支持切换 Thinking Level。',
        recoverable: true,
      })
    }

    await handle.setThinkingLevel(request.level)

    if (!handle.getModelInfo) {
      throw new AgentRuntimeError({
        code: 'driver-unavailable',
        message: '当前会话不支持读取模型信息。',
        recoverable: true,
      })
    }

    const info = await handle.getModelInfo()
    // Thinking Level 属于会话运行配置：持久化后重新打开会话才能恢复，
    // 而不是静默回退到 Agent 默认配置。
    await this.sessionIndexStore.updateEntry(request.sessionId, {
      thinkingLevel: request.level,
    })

    return info
  }
}
