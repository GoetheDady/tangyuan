import type {
  AgentEvent,
  AgentEventListener,
  AgentEventSubscription,
} from '@yuanxiao/contracts'

/**
 * 轻量事件总线，用于 Runtime 内部模块间通信。
 *
 * 由 createDefaultStores 创建，Store 与 Driver 都通过它汇聚事件；
 * Driver 订阅后把事件转发给公开订阅者。
 */
export class EventBus {
  private readonly listeners = new Set<AgentEventListener>()

  subscribe(listener: AgentEventListener): AgentEventSubscription {
    this.listeners.add(listener)
    return {
      unsubscribe: () => {
        this.listeners.delete(listener)
      },
    }
  }

  emit(event: AgentEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }
}
