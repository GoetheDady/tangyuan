import type {
  AgentReplyEntry,
  CompactionEntry,
  ExecutionAttempt,
  RunTurn,
  UserMessageEntry,
} from '@yuanxiao/contracts'

/**
 * 创建 user-message 条目所需的输入。
 */
export interface CreateUserTranscriptEntryInput {
  index: number
  messageId: string
  content: string
  createdAt: string
}

/**
 * 创建 agent-reply 条目所需的输入。
 */
export interface CreateAgentReplyTranscriptEntryInput {
  index: number
  messageId: string
  content: string
  createdAt: string
  attempt: ExecutionAttempt | null
  turns: RunTurn[]
  /** 重试时关联的原始用户消息标识。 */
  inReplyTo?: string
}

/**
 * 创建 compaction 条目所需的输入。
 */
export interface CreateCompactionTranscriptEntryInput {
  index: number
  timestamp: string
}

/**
 * 组装 user-message transcript 条目。
 *
 * 冷读重建（session-transcript）与实时增量投影（transcript-emitter）共用
 * 本函数，保证两条路径产出的条目结构一致。
 *
 * @param input - 索引、消息标识、内容与时间。
 * @returns 结构化的 user-message 条目。
 */
export function createUserTranscriptEntry(
  input: CreateUserTranscriptEntryInput,
): UserMessageEntry {
  return {
    kind: 'user-message',
    index: input.index,
    messageId: input.messageId,
    content: input.content,
    createdAt: input.createdAt,
  }
}

/**
 * 组装 agent-reply transcript 条目。
 *
 * 冷读重建与实时增量投影共用本函数；turns 由调用方按自己的节奏提供
 *（冷读一次组装完整，实时路径先给空数组再由 step 增量填充）。
 *
 * @param input - 索引、消息标识、内容、时间、attempt 与回合列表。
 * @returns 结构化的 agent-reply 条目。
 */
export function createAgentReplyTranscriptEntry(
  input: CreateAgentReplyTranscriptEntryInput,
): AgentReplyEntry {
  return {
    kind: 'agent-reply',
    index: input.index,
    messageId: input.messageId,
    content: input.content,
    createdAt: input.createdAt,
    attempt: input.attempt,
    turns: input.turns,
    ...(input.inReplyTo !== undefined ? { inReplyTo: input.inReplyTo } : {}),
  }
}

/**
 * 组装 compaction transcript 条目。
 *
 * @param input - 条目索引与压缩时间。
 * @returns 结构化的 compaction 条目。
 */
export function createCompactionTranscriptEntry(
  input: CreateCompactionTranscriptEntryInput,
): CompactionEntry {
  return {
    kind: 'compaction',
    index: input.index,
    timestamp: input.timestamp,
  }
}
