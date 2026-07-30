import type {
  AgentRuntimeErrorCode,
  AgentRuntimeErrorPayload,
} from '@tangyuan/contracts'

/**
 * 创建 AgentRuntimeError 所需的输入，允许携带非序列化的原始 cause。
 */
export interface AgentRuntimeErrorInput extends AgentRuntimeErrorPayload {
  cause?: unknown
}

/**
 * 可安全序列化并传给 Renderer 的 Runtime 错误。
 */
export class AgentRuntimeError extends Error {
  readonly code: AgentRuntimeErrorCode
  readonly recoverable: boolean

  /**
   * 创建一个可安全序列化的 Runtime 错误。
   *
   * @param input - 错误码、展示消息、可恢复状态和可选原始原因。
   * @returns AgentRuntimeError 实例。
   * @throws 此构造方法不会主动抛出错误。
   */
  constructor(input: AgentRuntimeErrorInput) {
    super(input.message)
    this.name = 'AgentRuntimeError'
    this.code = input.code
    this.recoverable = input.recoverable
  }

  /**
   * 转换为可传给 Renderer 的安全 JSON。
   *
   * @returns 不包含 cause 和敏感信息的错误载荷。
   * @throws 此方法不会主动抛出错误。
   */
  toJSON(): AgentRuntimeErrorPayload {
    return {
      code: this.code,
      message: this.message,
      recoverable: this.recoverable,
    }
  }
}
