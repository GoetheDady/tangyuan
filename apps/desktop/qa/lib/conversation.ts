import type { AppHarness } from './app-harness'
import type { InvariantViolation } from './invariants'

/**
 * 一次真实对话的结果。
 */
export interface ConversationResult {
  /** 最终 transcript 快照。 */
  transcript: unknown
  /** 收到的 Agent 回复文本（可能为空——空即视为违反不变量）。 */
  replyText: string
  /** 本次对话违反的技术不变量。 */
  violations: InvariantViolation[]
}

/**
 * 通过底层 IPC 发起一次真实对话并等待运行结束。
 *
 * 直接走 window.api（而非点 UI），因为 QA 关注的是全链路技术正确性：
 * 消息能否送达、真实模型能否返回、状态机是否合法流转、有无运行时错误。
 * UI 层的交互细节由 renderer e2e 覆盖，这里不重复。
 *
 * @param harness - 应用夹具。
 * @param content - 要发送的消息内容（由 Hermes 决定，属探索空间）。
 * @param timeoutMs - 等待真实回复的超时上限。
 * @returns 对话结果，含回复文本与技术不变量违反列表。
 */
export async function sendAndAwaitReply(
  harness: AppHarness,
  content: string,
  timeoutMs = 120000
): Promise<ConversationResult> {
  const violations: InvariantViolation[] = []

  const outcome = await harness.window.evaluate(
    async ({ content, timeoutMs }) => {
      const api = (
        window as unknown as {
          api: {
            createSession: (r: { agentId: string; title: string }) => Promise<{ sessionId: string }>
            subscribeToAgentEvents: (
              l: (e: { type: string; [k: string]: unknown }) => void
            ) => (() => void) | void
            sendMessage: (r: {
              agentId: string
              sessionId: string
              content: string
            }) => Promise<void>
            getTranscript: (r: { agentId: string; sessionId: string }) => Promise<unknown>
          }
        }
      ).api

      // 新建会话
      const session = await api.createSession({
        agentId: 'tangyuan',
        title: `QA ${new Date().toISOString()}`
      })

      // 订阅事件，捕获运行状态与错误
      const states: string[] = []
      let runtimeError: string | null = null
      let sawCompleted = false
      let sawFailed = false

      const done = new Promise<void>((resolve) => {
        const unsub = api.subscribeToAgentEvents(
          (event: { type: string; [k: string]: unknown }) => {
            if (event.type === 'run-state-changed') {
              const state = String(event.state)
              states.push(state)
              if (state === 'completed') {
                sawCompleted = true
                if (typeof unsub === 'function') unsub()
                resolve()
              } else if (state === 'failed' || state === 'cancelled') {
                if (state === 'failed') sawFailed = true
                if (typeof unsub === 'function') unsub()
                resolve()
              }
            } else if (event.type === 'runtime-error' || event.type === 'turn-failed') {
              runtimeError = String(
                (event as { error?: { message?: string } }).error?.message ?? 'unknown'
              )
            }
          }
        )

        setTimeout(() => {
          if (typeof unsub === 'function') unsub()
          resolve()
        }, timeoutMs)
      })

      const startedAt = Date.now()
      await api.sendMessage({
        agentId: 'tangyuan',
        sessionId: session.sessionId,
        content
      })
      await done
      const elapsedMs = Date.now() - startedAt

      const transcript = await api.getTranscript({
        agentId: 'tangyuan',
        sessionId: session.sessionId
      })

      // 从 transcript 提取 agent 回复文本
      const entries =
        (transcript as { entries?: Array<{ kind: string; content?: string }> }).entries ?? []
      const replyText = entries
        .filter((e) => e.kind === 'agent-reply')
        .map((e) => e.content ?? '')
        .join('')

      return {
        transcript,
        replyText,
        states,
        runtimeError,
        sawCompleted,
        sawFailed,
        elapsedMs,
        timedOut: elapsedMs >= timeoutMs
      }
    },
    { content, timeoutMs }
  )

  // 硬骨架断言（与场景无关的技术不变量）
  if (outcome.timedOut && !outcome.sawCompleted && !outcome.sawFailed) {
    violations.push({
      code: 'reply-timeout',
      message: `发送消息后 ${timeoutMs}ms 内未收到运行结束事件（真实模型无响应或链路卡住）。`,
      detail: `states=${outcome.states.join('→') || '(无)'}`
    })
  }

  if (outcome.runtimeError) {
    violations.push({
      code: 'runtime-error-during-run',
      message: '运行过程中 Runtime 报告了错误。',
      detail: outcome.runtimeError
    })
  }

  if (outcome.sawCompleted && outcome.replyText.trim().length === 0) {
    violations.push({
      code: 'empty-reply',
      message: '运行标记为 completed，但 transcript 中没有任何 Agent 回复文本。'
    })
  }

  // 状态机合法性：出现的状态必须都是已知值
  const validStates = new Set(['idle', 'running', 'completed', 'cancelled', 'failed'])
  const illegal = outcome.states.filter((s) => !validStates.has(s))
  if (illegal.length > 0) {
    violations.push({
      code: 'illegal-run-state',
      message: '运行状态机出现非法状态值。',
      detail: illegal.join(', ')
    })
  }

  return {
    transcript: outcome.transcript,
    replyText: outcome.replyText,
    violations
  }
}
