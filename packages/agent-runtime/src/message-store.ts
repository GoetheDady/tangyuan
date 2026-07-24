import type { AgentId } from '@tangyuan/contracts'
import type { InternalMessage } from './index'
import { AgentRuntimeError } from './errors'

/**
 * 创建 MessageStore 所需的依赖。
 */
export interface MessageStoreDependencies {
  now: () => string
}

/**
 * 会话消息存储：持有每个会话的本地 transcript 消息列表，
 * 承载「消息如何追加、流式拼接、完成与清理空消息」这一条状态知识。
 * 纯状态容器，不做会话存在性校验（由调用方编排），不广播事件。
 */
export class MessageStore {
  private readonly now: () => string
  private readonly messages = new Map<string, InternalMessage[]>()

  constructor(dependencies: MessageStoreDependencies) {
    this.now = dependencies.now
  }

  /**
   * 初始化一个会话的空消息列表。
   *
   * @param sessionId - 会话标识。
   * @returns 无返回值。
   */
  initSession(sessionId: string): void {
    this.messages.set(sessionId, [])
  }

  /**
   * 读取指定会话已追加的消息列表。
   *
   * @param sessionId - 会话标识。
   * @returns 消息列表；无记录时返回空数组。
   */
  getMessages(sessionId: string): InternalMessage[] {
    return this.messages.get(sessionId) ?? []
  }

  /**
   * 向指定会话追加一条消息。
   *
   * @param input - 消息归属、角色和文本内容。
   * @returns 已追加的消息。
   */
  append(input: {
    agentId: AgentId
    sessionId: string
    role: InternalMessage['role']
    content: string
  }): InternalMessage {
    const messages = this.messages.get(input.sessionId) ?? []
    const message: InternalMessage = {
      messageId: `${input.sessionId}-message-${messages.length + 1}`,
      agentId: input.agentId,
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
      createdAt: this.now(),
    }
    this.messages.set(input.sessionId, [...messages, message])

    return message
  }

  /**
   * 把 Agent 文本增量拼接到指定消息。
   *
   * @param messageId - 需要更新的消息标识。
   * @param delta - 本次新增的文本片段。
   * @returns 更新后的消息。
   * @throws 当消息不存在时抛出 AgentRuntimeError。
   */
  appendDelta(messageId: string, delta: string): InternalMessage {
    for (const [sessionId, messages] of this.messages) {
      const messageIndex = messages.findIndex(
        (message) => message.messageId === messageId,
      )

      if (messageIndex === -1) {
        continue
      }

      const currentMessage = messages[messageIndex]

      if (!currentMessage) {
        break
      }

      const nextMessage = {
        ...currentMessage,
        content: `${currentMessage.content}${delta}`,
      }
      const nextMessages = [...messages]
      nextMessages[messageIndex] = nextMessage
      this.messages.set(sessionId, nextMessages)

      return nextMessage
    }

    throw new AgentRuntimeError({
      code: 'session-not-found',
      message: `找不到消息 ${messageId}。`,
      recoverable: true,
    })
  }

  /**
   * 读取已经完成流式拼接的消息。
   *
   * @param messageId - 需要读取的消息标识。
   * @returns 完成后的消息。
   * @throws 当消息不存在时抛出 AgentRuntimeError。
   */
  complete(messageId: string): InternalMessage {
    for (const messages of this.messages.values()) {
      const message = messages.find(
        (candidate) => candidate.messageId === messageId,
      )

      if (message) {
        return message
      }
    }

    throw new AgentRuntimeError({
      code: 'session-not-found',
      message: `找不到消息 ${messageId}。`,
      recoverable: true,
    })
  }

  /**
   * 当指定消息仍为空时从 transcript 中移除。
   *
   * @param messageId - 需要按需移除的消息标识。
   * @returns 移除了空消息则返回 true，否则返回 false。
   */
  removeIfEmpty(messageId: string): boolean {
    for (const [sessionId, messages] of this.messages) {
      const message = messages.find(
        (candidate) => candidate.messageId === messageId,
      )

      if (!message || message.content) {
        continue
      }

      this.messages.set(
        sessionId,
        messages.filter((candidate) => candidate.messageId !== messageId),
      )

      return true
    }

    return false
  }
}
