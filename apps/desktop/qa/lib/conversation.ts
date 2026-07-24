import type { AppHarness } from './app-harness'
import type { InvariantViolation } from './invariants'

/**
 * 一次运行（发消息或重试）的结果。
 */
export interface RunResult {
  /** 收到的 Agent 回复文本（completed 时应非空）。 */
  replyText: string
  /** 运行经历的状态序列。 */
  states: string[]
  /** 是否收到 completed。 */
  completed: boolean
  /** 本次运行违反的技术不变量。 */
  violations: InvariantViolation[]
}

interface RunOutcome {
  replyText: string
  states: string[]
  runtimeError: string | null
  sawCompleted: boolean
  sawFailed: boolean
  sawCancelled: boolean
  timedOut: boolean
}

const VALID_STATES = new Set(['idle', 'running', 'completed', 'cancelled', 'failed'])

/**
 * 触发类型：决定本次运行由哪个 API 发起，以及是否在运行中取消。
 */
type Trigger =
  | { kind: 'send'; content: string }
  | { kind: 'retry'; userMessageId: string }
  | { kind: 'send-then-cancel'; content: string }

/**
 * 校验一次运行结果的技术不变量（与场景无关）。
 */
function assertRunInvariants(
  outcome: RunOutcome,
  timeoutMs: number,
  expectCancelled: boolean
): InvariantViolation[] {
  const violations: InvariantViolation[] = []

  if (outcome.timedOut && !outcome.sawCompleted && !outcome.sawFailed && !outcome.sawCancelled) {
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

  if (!expectCancelled && outcome.sawCompleted && outcome.replyText.trim().length === 0) {
    violations.push({
      code: 'empty-reply',
      message: '运行标记为 completed，但 transcript 中没有任何 Agent 回复文本。'
    })
  }

  const illegal = outcome.states.filter((s) => !VALID_STATES.has(s))
  if (illegal.length > 0) {
    violations.push({
      code: 'illegal-run-state',
      message: '运行状态机出现非法状态值。',
      detail: illegal.join(', ')
    })
  }

  return violations
}

/**
 * 在 page context 内发起一次运行并采集结果。
 *
 * 整个采集逻辑在 evaluate 内自包含（不引用外部作用域），
 * 通过 trigger 参数区分 send / retry / send-then-cancel 三种场景。
 */
async function runInPage(
  harness: AppHarness,
  sessionId: string,
  trigger: Trigger,
  timeoutMs: number
): Promise<RunOutcome> {
  return await harness.window.evaluate(
    async ({ sessionId, trigger, timeoutMs }) => {
      const api = (
        window as unknown as {
          api: {
            sendMessage: (r: {
              agentId: string
              sessionId: string
              content: string
            }) => Promise<void>
            retryMessage: (r: {
              agentId: string
              sessionId: string
              userMessageId: string
            }) => Promise<void>
            cancelRun: (r: { agentId: string; sessionId: string }) => Promise<unknown>
            getTranscript: (r: { agentId: string; sessionId: string }) => Promise<{
              entries?: Array<{ kind: string; content?: string }>
            }>
            subscribeToAgentEvents: (
              l: (e: { type: string; [k: string]: unknown }) => void
            ) => (() => void) | void
          }
        }
      ).api

      const states: string[] = []
      let runtimeError: string | null = null
      let sawCompleted = false
      let sawFailed = false
      let sawCancelled = false
      let cancelTriggered = false

      const done = new Promise<void>((resolve) => {
        const unsub = api.subscribeToAgentEvents((event) => {
          if (event.type === 'run-state-changed') {
            const state = String(event.state)
            states.push(state)

            // send-then-cancel：收到首个 running 后立即取消
            if (state === 'running' && trigger.kind === 'send-then-cancel' && !cancelTriggered) {
              cancelTriggered = true
              void api.cancelRun({ agentId: 'tangyuan', sessionId })
            }

            if (state === 'completed') {
              sawCompleted = true
              if (typeof unsub === 'function') unsub()
              resolve()
            } else if (state === 'failed' || state === 'cancelled') {
              if (state === 'failed') sawFailed = true
              if (state === 'cancelled') sawCancelled = true
              if (typeof unsub === 'function') unsub()
              resolve()
            }
          } else if (event.type === 'runtime-error' || event.type === 'turn-failed') {
            runtimeError = String(
              (event as { error?: { message?: string } }).error?.message ?? 'unknown'
            )
          }
        })

        setTimeout(() => {
          if (typeof unsub === 'function') unsub()
          resolve()
        }, timeoutMs)
      })

      const startedAt = Date.now()
      if (trigger.kind === 'retry') {
        await api.retryMessage({
          agentId: 'tangyuan',
          sessionId,
          userMessageId: trigger.userMessageId
        })
      } else {
        await api.sendMessage({
          agentId: 'tangyuan',
          sessionId,
          content: trigger.content
        })
      }
      await done
      const elapsedMs = Date.now() - startedAt

      const transcript = await api.getTranscript({
        agentId: 'tangyuan',
        sessionId
      })
      const entries = transcript.entries ?? []
      const replyText = entries
        .filter((e) => e.kind === 'agent-reply')
        .map((e) => e.content ?? '')
        .join('')

      return {
        replyText,
        states,
        runtimeError,
        sawCompleted,
        sawFailed,
        sawCancelled,
        timedOut: elapsedMs >= timeoutMs
      }
    },
    { sessionId, trigger, timeoutMs }
  )
}

/**
 * 新建一个会话。
 *
 * @param harness - 应用夹具。
 * @param title - 会话标题。
 * @returns 新会话 id。
 */
export async function createSession(
  harness: AppHarness,
  title = `QA ${new Date().toISOString()}`
): Promise<string> {
  return await harness.window.evaluate(async (title) => {
    const api = (
      window as unknown as {
        api: {
          createSession: (r: { agentId: string; title: string }) => Promise<{ sessionId: string }>
        }
      }
    ).api
    const session = await api.createSession({ agentId: 'tangyuan', title })
    return session.sessionId
  }, title)
}

/**
 * 在指定会话发送一条消息并等待真实回复。
 */
export async function sendMessageAndAwait(
  harness: AppHarness,
  sessionId: string,
  content: string,
  timeoutMs = 120000
): Promise<RunResult> {
  const outcome = await runInPage(harness, sessionId, { kind: 'send', content }, timeoutMs)
  return {
    replyText: outcome.replyText,
    states: outcome.states,
    completed: outcome.sawCompleted,
    violations: assertRunInvariants(outcome, timeoutMs, false)
  }
}

/**
 * 重试指定用户消息并等待新一次运行结束。
 */
export async function retryAndAwait(
  harness: AppHarness,
  sessionId: string,
  userMessageId: string,
  timeoutMs = 120000
): Promise<RunResult> {
  const outcome = await runInPage(harness, sessionId, { kind: 'retry', userMessageId }, timeoutMs)
  return {
    replyText: outcome.replyText,
    states: outcome.states,
    completed: outcome.sawCompleted,
    violations: assertRunInvariants(outcome, timeoutMs, false)
  }
}

/**
 * 发送一条消息，收到首个 running 后立即取消，等待运行收敛。
 *
 * 真实模型可能很快返回，取消不一定来得及——「无回复」在本场景不视为违反
 * （尽力而为）；状态机与 Runtime 错误仍做硬断言。
 */
export async function sendThenCancel(
  harness: AppHarness,
  sessionId: string,
  content: string,
  timeoutMs = 120000
): Promise<RunResult> {
  const outcome = await runInPage(
    harness,
    sessionId,
    { kind: 'send-then-cancel', content },
    timeoutMs
  )
  return {
    replyText: outcome.replyText,
    states: outcome.states,
    completed: outcome.sawCompleted,
    violations: assertRunInvariants(outcome, timeoutMs, true)
  }
}

/**
 * 读取会话中第一条用户消息的 id（供重试使用）。
 */
export async function firstUserMessageId(
  harness: AppHarness,
  sessionId: string
): Promise<string | null> {
  return await harness.window.evaluate(async (sessionId) => {
    const api = (
      window as unknown as {
        api: {
          getTranscript: (r: { agentId: string; sessionId: string }) => Promise<{
            entries?: Array<{ kind: string; messageId?: string }>
          }>
        }
      }
    ).api
    const t = await api.getTranscript({ agentId: 'tangyuan', sessionId })
    const entry = (t.entries ?? []).find((e) => e.kind === 'user-message')
    return entry?.messageId ?? null
  }, sessionId)
}
