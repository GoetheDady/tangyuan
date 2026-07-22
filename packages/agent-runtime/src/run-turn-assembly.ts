import type { TurnEndEvent } from '@earendil-works/pi-coding-agent'
import type { RunTurn, TurnStep } from '@tangyuan/contracts'
import { createToolStepSummary } from './utils'

/**
 * SDK `turn_end` 携带的 assistant message（从广義 AgentMessage 联合中窄化）。
 *
 * 其 content 为 `(TextContent | ThinkingContent | ToolCall)[]`，按产生顺序保留三类块。
 */
type TurnAssistantMessage = Extract<TurnEndEvent['message'], { role: 'assistant' }>

/**
 * 组装单个回合所需的输入。
 *
 * `message` 与 `toolResults` 直接派生自 SDK 原生 `turn_end` 事件，
 * 与历史 session 文件中持久化的 AssistantMessage 同构，因此实时路径与
 * 历史重建路径可共用本函数产出一致的回合结构。
 */
export interface AssembleRunTurnInput {
  /** 回合在 attempt 内的稳定索引，对应 SDK 权威 `turnIndex`。 */
  turnIndex: number
  /** 关联的 run 标识。 */
  runId: string
  /** 本回合的完整 assistant message（含 thinking/text/toolCall 交错的 content 块）。 */
  message: TurnAssistantMessage
  /** 本回合触发的工具结果，用于判定各工具步骤的最终状态。 */
  toolResults: TurnEndEvent['toolResults']
  /** 回合开始时间。 */
  startedAt: string
  /** 回合结束时间；进行中的回合不传或传 undefined。 */
  completedAt?: string | undefined
}

/**
 * 把单个 SDK AssistantMessage 加上对应 toolResults 组装为一个回合。
 *
 * 步骤按 content 块的真实产生顺序排列：thinking 与 text 如实交错保留，
 * 每个 toolCall 生成一个工具步骤并按启动顺序排列。工具步骤的状态由匹配的
 * toolResult（按 toolCallId）决定——有结果按 isError 判定 completed/failed，
 * 无结果视为 running；工具步骤内容用确定性安全摘要，不含原始参数或输出。
 *
 * 本函数为纯函数：不读取时钟、不产生副作用，所有时间戳由调用方传入。
 *
 * @param input - 回合索引、run 标识、assistant message、toolResults 与时间戳。
 * @returns 组装完成的 RunTurn。
 * @throws 此函数不会主动抛出错误。
 */
export function assembleRunTurn(input: AssembleRunTurnInput): RunTurn {
  const { turnIndex, runId, message, toolResults, startedAt } = input
  const completedAt = input.completedAt ?? null
  const turnCompleted = completedAt !== null

  // 建立 toolCallId → toolResult 的索引，便于按工具调用查最终状态。
  const resultByCallId = new Map<string, TurnEndEvent['toolResults'][number]>()
  for (const result of toolResults) {
    resultByCallId.set(result.toolCallId, result)
  }

  const steps: TurnStep[] = []
  for (const block of message.content) {
    const index = steps.length

    if (block.type === 'thinking') {
      steps.push({
        index,
        kind: 'thinking',
        content: block.thinking,
        status: turnCompleted ? 'completed' : 'running',
        startedAt,
        completedAt,
      })
      continue
    }

    if (block.type === 'text') {
      steps.push({
        index,
        kind: 'text',
        content: block.text,
        status: turnCompleted ? 'completed' : 'running',
        startedAt,
        completedAt,
      })
      continue
    }

    if (block.type === 'toolCall') {
      const result = resultByCallId.get(block.id)
      const status: TurnStep['status'] =
        result === undefined
          ? 'running'
          : result.isError
            ? 'failed'
            : 'completed'
      steps.push({
        index,
        kind: 'tool-call',
        content: createToolStepSummary(block.name, status),
        toolCallId: block.id,
        toolName: block.name,
        status,
        startedAt,
        completedAt: status === 'running' ? null : completedAt,
      })
    }
  }

  return {
    index: turnIndex,
    runId,
    steps,
    status: turnCompleted ? 'completed' : 'running',
    startedAt,
    completedAt,
  }
}
