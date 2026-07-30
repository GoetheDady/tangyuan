import type {
  AgentReplyEntry,
  RunTurn,
  TranscriptEntry,
  TranscriptSnapshot,
} from '@tangyuan/contracts'
import { assembleRunTurn } from './run-turn-assembly'

type TurnAssistantMessage = Parameters<typeof assembleRunTurn>[0]['message']
type TurnToolResult = Parameters<
  typeof assembleRunTurn
>[0]['toolResults'][number]

interface SdkMessageEntry {
  id: string
  timestamp: string
  message: { role: unknown; content?: unknown }
}

interface PendingTurn {
  entry: SdkMessageEntry
  message: TurnAssistantMessage
  toolResults: Array<{ entry: SdkMessageEntry; message: TurnToolResult }>
}

interface PendingReply {
  messageId: string
  createdAt: string
  runId: string
  content: string
  turns: RunTurn[]
  pendingTurn: PendingTurn
}

const EPOCH_TIMESTAMP = new Date(0).toISOString()

/**
 * 将 Pi SDK 消息内容压成纯文本。
 *
 * @param content - SDK message.content，可能是字符串或内容块数组。
 * @returns 可展示的纯文本内容。
 * @throws 此方法不会主动抛出错误。
 */
export function stringifyPiSdkMessageContent(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }

  if (!Array.isArray(content)) {
    return ''
  }

  return content
    .map((part) => {
      if (typeof part === 'string') {
        return part
      }

      if (part && typeof part === 'object' && 'text' in part) {
        const text = (part as { text?: unknown }).text
        return typeof text === 'string' ? text : ''
      }

      return ''
    })
    .filter(Boolean)
    .join('\n')
}

/**
 * 把单个 Pi SDK session entry 映射成结构化 transcript 条目。
 *
 * 单条 assistant entry 会按无工具结果的单回合回复映射；完整历史重建应使用
 * buildTranscriptSnapshotFromSdkEntries，以便关联后续 toolResult 和多个回合。
 *
 * @param entry - Pi SDK session entry。
 * @param sessionId - 当前会话标识，用于缺失 id 时生成稳定回退值。
 * @param index - 目标 transcript 条目索引。
 * @returns 结构化 transcript 条目列表；不是 user/assistant message 时返回空数组。
 * @throws 此方法不会主动抛出错误。
 */
export function mapPiSdkSessionEntryToTranscriptEntries(
  entry: unknown,
  sessionId: string,
  index: number,
): TranscriptEntry[] {
  const candidate = parseMessageEntry(entry, sessionId, index)
  if (!candidate) return []

  if (candidate.message.role === 'user') {
    return [mapUserEntry(candidate, index)]
  }

  const assistantMessage = getAssistantMessage(candidate.message)
  if (!assistantMessage) return []

  const content = stringifyAssistantText(assistantMessage)
  return [
    {
      kind: 'agent-reply',
      index,
      messageId: candidate.id,
      content,
      createdAt: candidate.timestamp,
      attempt: null,
      turns: [
        assembleRunTurn({
          turnIndex: 0,
          runId: candidate.id,
          message: assistantMessage,
          toolResults: [],
          startedAt: candidate.timestamp,
          completedAt: candidate.timestamp,
        }),
      ],
    },
  ]
}

/**
 * 从 Pi SDK session message 序列构建结构化 TranscriptSnapshot。
 *
 * user message 开始新的回复边界；同一 user 之后的每个 assistant message 对应
 * 一个回合，并消费其后、下一条 assistant/user 之前的 toolResult。回合步骤统一
 * 交给 assembleRunTurn 组装，保证实时路径与历史路径产出一致。
 *
 * @param entries - Pi SDK SessionManager.getEntries() 返回的扁平 entries。
 * @param sessionId - 当前会话标识。
 * @param agentId - 当前 Agent 标识。
 * @returns 结构化会话快照。
 * @throws 此方法不会主动抛出错误。
 */
export function buildTranscriptSnapshotFromSdkEntries(
  entries: unknown[],
  sessionId: string,
  agentId: string,
): TranscriptSnapshot {
  const transcriptEntries: TranscriptEntry[] = []
  let pendingReply: PendingReply | null = null

  const flushTurn = (): void => {
    if (!pendingReply) return

    const { pendingTurn } = pendingReply
    const completedAt =
      pendingTurn.toolResults.at(-1)?.entry.timestamp ??
      pendingTurn.entry.timestamp
    pendingReply.turns.push(
      assembleRunTurn({
        turnIndex: pendingReply.turns.length,
        runId: pendingReply.runId,
        message: pendingTurn.message,
        toolResults: pendingTurn.toolResults.map((result) => result.message),
        startedAt: pendingTurn.entry.timestamp,
        completedAt,
      }),
    )
    pendingReply.content = stringifyAssistantText(pendingTurn.message)
  }

  const flushReply = (): void => {
    if (!pendingReply) return

    flushTurn()
    const reply: AgentReplyEntry = {
      kind: 'agent-reply',
      index: transcriptEntries.length,
      messageId: pendingReply.messageId,
      content: pendingReply.content,
      createdAt: pendingReply.createdAt,
      attempt: null,
      turns: pendingReply.turns,
    }
    transcriptEntries.push(reply)
    pendingReply = null
  }

  for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
    const candidate = parseMessageEntry(
      entries[entryIndex],
      sessionId,
      entryIndex,
    )
    if (!candidate) continue

    if (candidate.message.role === 'user') {
      flushReply()
      transcriptEntries.push(mapUserEntry(candidate, transcriptEntries.length))
      continue
    }

    const assistantMessage = getAssistantMessage(candidate.message)
    if (assistantMessage) {
      if (pendingReply) {
        flushTurn()
        pendingReply.pendingTurn = {
          entry: candidate,
          message: assistantMessage,
          toolResults: [],
        }
      } else {
        pendingReply = {
          messageId: candidate.id,
          createdAt: candidate.timestamp,
          runId: candidate.id,
          content: '',
          turns: [],
          pendingTurn: {
            entry: candidate,
            message: assistantMessage,
            toolResults: [],
          },
        }
      }
      continue
    }

    const toolResult = getToolResult(candidate.message)
    if (toolResult && pendingReply) {
      pendingReply.pendingTurn.toolResults.push({
        entry: candidate,
        message: toolResult,
      })
    }
  }

  flushReply()

  return {
    sessionId,
    agentId,
    entries: transcriptEntries,
    updatedAt: new Date().toISOString(),
  }
}

/**
 * 从扁平 session entries 构建 transcript 后查找 attempt 记录并填充。
 *
 * @param entries - SDK session entries。
 * @param sessionId - 会话标识。
 * @param agentId - Agent 标识。
 * @param attempts - 持久化的执行尝试记录。
 * @returns 填充了 attempt 的结构化快照。
 * @throws 此方法不会主动抛出错误。
 */
export function buildTranscriptWithAttempts(
  entries: unknown[],
  sessionId: string,
  agentId: string,
  attempts: ReadonlyArray<{
    attemptId: string
    runId: string
    messageId: string
    status: 'running' | 'completed' | 'cancelled' | 'failed'
    startedAt: string
    completedAt: string | null
    error?: import('@tangyuan/contracts').AgentRuntimeErrorPayload
    inReplyTo?: string
  }>,
): TranscriptSnapshot {
  const snapshot = buildTranscriptSnapshotFromSdkEntries(
    entries,
    sessionId,
    agentId,
  )

  if (attempts.length === 0) {
    return snapshot
  }

  const attemptByMessageId = new Map(attempts.map((a) => [a.messageId, a]))
  const enrichedEntries = snapshot.entries.map((entry) => {
    if (entry.kind !== 'agent-reply') return entry
    const persisted = attemptByMessageId.get(entry.messageId)
    if (!persisted) return entry
    return {
      ...entry,
      attempt: {
        attemptId: persisted.attemptId,
        runId: persisted.runId,
        status: persisted.status,
        startedAt: persisted.startedAt,
        completedAt: persisted.completedAt,
        ...(persisted.error ? { error: persisted.error } : {}),
      },
      turns: entry.turns.map((turn) => ({
        ...turn,
        runId: persisted.runId,
      })),
      ...(persisted.inReplyTo ? { inReplyTo: persisted.inReplyTo } : {}),
    }
  })

  return { ...snapshot, entries: enrichedEntries }
}

function parseMessageEntry(
  entry: unknown,
  sessionId: string,
  entryIndex: number,
): SdkMessageEntry | null {
  if (!entry || typeof entry !== 'object') return null

  const candidate = entry as {
    type?: unknown
    id?: unknown
    timestamp?: unknown
    message?: unknown
  }
  if (
    candidate.type !== 'message' ||
    !candidate.message ||
    typeof candidate.message !== 'object'
  ) {
    return null
  }

  return {
    id:
      typeof candidate.id === 'string'
        ? candidate.id
        : `${sessionId}-sdk-message-${entryIndex}`,
    timestamp:
      typeof candidate.timestamp === 'string'
        ? candidate.timestamp
        : EPOCH_TIMESTAMP,
    message: candidate.message as SdkMessageEntry['message'],
  }
}

function stringifyAssistantText(message: TurnAssistantMessage): string {
  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
}

function getAssistantMessage(
  message: SdkMessageEntry['message'],
): TurnAssistantMessage | null {
  if (message.role !== 'assistant' || !Array.isArray(message.content)) {
    return null
  }
  return message as TurnAssistantMessage
}

function getToolResult(
  message: SdkMessageEntry['message'],
): TurnToolResult | null {
  const candidate = message as {
    role?: unknown
    toolCallId?: unknown
    toolName?: unknown
    isError?: unknown
  }
  if (
    candidate.role !== 'toolResult' ||
    typeof candidate.toolCallId !== 'string' ||
    typeof candidate.toolName !== 'string' ||
    typeof candidate.isError !== 'boolean'
  ) {
    return null
  }
  return message as TurnToolResult
}

function mapUserEntry(entry: SdkMessageEntry, index: number): TranscriptEntry {
  return {
    kind: 'user-message',
    index,
    messageId: entry.id,
    content: stringifyPiSdkMessageContent(entry.message.content),
    createdAt: entry.timestamp,
  }
}
