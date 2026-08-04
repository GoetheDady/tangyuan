import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { AgentRunState, AgentSessionSummary } from '@yuanxiao/contracts'
import type { ConfigStore, DirectoryLayout } from '../core'
import type { PiSdkGateway } from '../driver'
import { AgentRuntimeError } from '../core'
import {
  normalizePersistedIndexEntry,
  SessionIndexRebuilder,
} from './session-index-rebuilder'
import type {
  PersistedAttemptEntry,
  PersistedSessionIndex,
  PersistedSessionIndexEntry,
} from './session-index-types'

export type {
  PersistedAttemptEntry,
  PersistedSessionIndex,
  PersistedSessionIndexEntry,
} from './session-index-types'

/**
 * 创建 SessionIndexStore 所需的依赖。
 */
export interface SessionIndexStoreDependencies {
  layout: DirectoryLayout
  configStore: ConfigStore
  gateway: PiSdkGateway
}

/**
 * 与执行尝试同时生效的会话展示状态（运行状态、更新时间与可选的消息预览）。
 */
export interface AttemptSessionUpdate {
  status: AgentRunState
  updatedAt: string
  lastMessagePreview?: string
}

/**
 * 会话索引存储：持有持久化索引条目及其派生的会话摘要这一对孪生状态，
 * 承载「会话索引如何读盘、写盘、从 SDK 重建与规范化」这一条知识。
 * 只管理索引数据与持久化，不涉及 session handle 生命周期、运行执行或事件广播。
 */
export class SessionIndexStore {
  private readonly layout: DirectoryLayout
  private readonly rebuilder: SessionIndexRebuilder
  private readonly sessionIndex = new Map<string, PersistedSessionIndexEntry>()
  private readonly sessions = new Map<string, AgentSessionSummary>()
  private initialized = false
  private initialization: Promise<PersistedSessionIndexEntry[]> | null = null
  private mutationTail: Promise<void> = Promise.resolve()

  constructor(dependencies: SessionIndexStoreDependencies) {
    this.layout = dependencies.layout
    this.rebuilder = new SessionIndexRebuilder({
      layout: dependencies.layout,
      configStore: dependencies.configStore,
      gateway: dependencies.gateway,
    })
  }

  /**
   * 读取本地会话索引；索引不存在或损坏时尝试从 Pi SDK 原生 session 重建。
   *
   * @returns 当前可展示的会话索引条目。
   * @throws 当索引 JSON 损坏且 SDK 列表读取也失败时，Promise 会 reject。
   */
  private async load(): Promise<PersistedSessionIndexEntry[]> {
    if (this.initialized) {
      return [...this.sessionIndex.values()]
    }
    if (this.initialization) return this.initialization

    this.initialization = this.loadFromDisk()
    try {
      const entries = await this.initialization
      this.initialized = true
      return entries
    } finally {
      this.initialization = null
    }
  }

  private async loadFromDisk(): Promise<PersistedSessionIndexEntry[]> {
    const indexPath = this.layout.sessionIndex()

    let rawIndex: string
    try {
      rawIndex = await readFile(indexPath, 'utf8')
    } catch {
      // 索引缺失或不可读时从 Pi SDK 原生 session 重建
      return this.rebuildIndex()
    }

    try {
      const parsedIndex = JSON.parse(rawIndex) as Partial<PersistedSessionIndex>
      const entries = Array.isArray(parsedIndex.sessions)
        ? parsedIndex.sessions.flatMap((entry) =>
            normalizePersistedIndexEntry(entry),
          )
        : []
      this.replaceAll(entries)

      return entries
    } catch {
      // 索引 JSON 损坏时同样触发重建，重建器尽力保留可读的扩展数据
      return this.rebuildIndex()
    }
  }

  /**
   * 委托重建器从 Pi SDK session 目录重建索引，装回内存并落盘。
   *
   * @returns 从 SDK 恢复出的索引条目。
   * @throws 当重建器读取运行时配置或扫描 Pi session 失败时，Promise 会 reject；失败结果不会写盘。
   */
  private async rebuildIndex(): Promise<PersistedSessionIndexEntry[]> {
    const entries = await this.rebuilder.rebuild()
    await this.persistEntries(entries)
    this.replaceAll(entries)
    return entries
  }

  /**
   * 用已读取的索引条目刷新内存中的索引与会话摘要缓存。
   *
   * @param entries - 从本地索引或 SDK 恢复出的索引条目。
   * @returns 无返回值。
   * @throws 此方法不会主动抛出错误。
   */
  private replaceAll(entries: PersistedSessionIndexEntry[]): void {
    this.sessionIndex.clear()
    this.sessions.clear()

    for (const entry of entries) {
      this.sessionIndex.set(entry.sessionId, entry)
      this.sessions.set(entry.sessionId, this.toSummary(entry))
    }
  }

  /**
   * 把索引条目转换成 Renderer 使用的会话摘要。
   *
   * @param entry - 本地持久化索引条目。
   * @returns 对应的 AgentSessionSummary。
   * @throws 此方法不会主动抛出错误。
   */
  private toSummary(entry: PersistedSessionIndexEntry): AgentSessionSummary {
    return {
      agentId: entry.agentId,
      sessionId: entry.sessionId,
      title: entry.title,
      state: entry.status,
      updatedAt: entry.updatedAt,
      ...(entry.archivedAt !== undefined
        ? { archivedAt: entry.archivedAt }
        : {}),
      ...(entry.forkedFrom !== undefined
        ? { forkedFrom: entry.forkedFrom }
        : {}),
    }
  }

  /**
   * 将会话索引以临时文件加 rename 的方式写入 userData。
   *
   * @returns 无返回值。
   * @throws 当目录创建或文件写入失败时，Promise 会 reject。
   */
  private async persistEntries(
    sourceEntries: readonly PersistedSessionIndexEntry[],
  ): Promise<void> {
    const indexPath = this.layout.sessionIndex()
    const entries = [...sourceEntries].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    )
    const payload: PersistedSessionIndex = {
      sessions: entries,
    }

    await mkdir(dirname(indexPath), { recursive: true })
    const tempIndexPath = `${indexPath}.${process.pid}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}.tmp`
    await writeFile(
      tempIndexPath,
      `${JSON.stringify(payload, null, 2)}\n`,
      'utf8',
    )
    await rename(tempIndexPath, indexPath)
  }

  /**
   * 把一次索引 mutation 排入单写者队列。每个 mutation 基于前一次已提交状态
   * 创建草稿，写盘成功后才替换内存索引与派生摘要。
   */
  private async commitMutation<T>(
    mutate: (draft: Map<string, PersistedSessionIndexEntry>) => T,
  ): Promise<T> {
    await this.load()

    const pending = this.mutationTail.then(async () => {
      const draft = new Map(this.sessionIndex)
      const result = mutate(draft)
      const entries = [...draft.values()]
      await this.persistEntries(entries)
      this.replaceAll(entries)
      return result
    })
    this.mutationTail = pending.then(
      () => undefined,
      () => undefined,
    )
    return pending
  }

  /**
   * 列出指定 Agent 的会话摘要，按更新时间倒序。
   *
   * @param agentId - Agent 标识。
   * @param includeArchived - 是否包含已归档会话。
   * @returns 该 Agent 的会话摘要列表。
   */
  async listSummaries(
    agentId: string,
    includeArchived = false,
  ): Promise<AgentSessionSummary[]> {
    await this.load()
    return [...this.sessions.values()]
      .filter(
        (session) =>
          session.agentId === agentId &&
          (includeArchived || session.archivedAt === undefined),
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  private requireEntry(
    entries: ReadonlyMap<string, PersistedSessionIndexEntry>,
    sessionId: string,
  ): PersistedSessionIndexEntry {
    const indexEntry = entries.get(sessionId)

    if (!indexEntry) {
      throw new AgentRuntimeError({
        code: 'session-not-found',
        message: `找不到会话 ${sessionId} 的本地索引。`,
        recoverable: true,
      })
    }

    return indexEntry
  }

  /** 初始化完成后读取单个索引条目，不存在时抛错。 */
  async resolveEntry(sessionId: string): Promise<PersistedSessionIndexEntry> {
    await this.load()
    return this.requireEntry(this.sessionIndex, sessionId)
  }

  /** 初始化完成后读取可选索引条目。 */
  async findEntry(
    sessionId: string,
  ): Promise<PersistedSessionIndexEntry | undefined> {
    await this.load()
    return this.sessionIndex.get(sessionId)
  }

  /** 初始化完成后校验会话归属与归档状态。 */
  async resolveSession(
    sessionId: string,
    agentId: string,
  ): Promise<AgentSessionSummary> {
    await this.load()
    const session = this.sessions.get(sessionId)
    if (
      !session ||
      session.agentId !== agentId ||
      session.archivedAt !== undefined
    ) {
      throw new AgentRuntimeError({
        code: 'session-not-found',
        message: !session
          ? `找不到会话 ${sessionId}。`
          : session.agentId !== agentId
            ? `会话 ${sessionId} 不属于 Agent ${agentId}。`
            : `会话 ${sessionId} 已归档，请先恢复后再打开。`,
        recoverable: true,
      })
    }
    return session
  }

  /** 初始化完成后读取会话的执行尝试。 */
  async resolveAttempts(sessionId: string): Promise<PersistedAttemptEntry[]> {
    await this.load()
    return this.sessionIndex.get(sessionId)?.attempts ?? []
  }

  /**
   * 新增一个会话的索引条目与派生摘要（不写盘，由调用方统一编排持久化）。
   *
   * @param entry - 新会话的索引条目。
   * @returns 派生出的会话摘要。
   */
  async addSession(
    entry: PersistedSessionIndexEntry,
  ): Promise<AgentSessionSummary> {
    return this.commitMutation((draft) => {
      draft.set(entry.sessionId, entry)
      return this.toSummary(entry)
    })
  }

  private updateEntry(
    draft: Map<string, PersistedSessionIndexEntry>,
    sessionId: string,
    patch: Partial<PersistedSessionIndexEntry>,
  ): PersistedSessionIndexEntry {
    const currentEntry = this.requireEntry(draft, sessionId)
    const nextEntry: PersistedSessionIndexEntry = {
      ...currentEntry,
      ...patch,
    }
    draft.set(sessionId, nextEntry)
    return nextEntry
  }

  /**
   * 一次性更新一组会话的归档状态并原子写盘。
   *
   * @param sessionIds - 要更新的会话标识。
   * @param archivedAt - 归档时间；传入 null 表示恢复。
   * @returns 更新后的会话摘要。
   * @throws 任一会话不存在或索引写入失败时，Promise 会 reject。
   */
  async setArchived(
    sessionIds: readonly string[],
    archivedAt: string | null,
  ): Promise<AgentSessionSummary[]> {
    return this.commitMutation((draft) => {
      const entries = sessionIds.map((sessionId) =>
        this.requireEntry(draft, sessionId),
      )

      for (const entry of entries) {
        const nextEntry: PersistedSessionIndexEntry = {
          ...entry,
          ...(archivedAt === null ? {} : { archivedAt }),
        }

        if (archivedAt === null) {
          delete nextEntry.archivedAt
        }

        draft.set(entry.sessionId, nextEntry)
      }

      return sessionIds.flatMap((sessionId) => {
        const entry = draft.get(sessionId)
        return entry ? [this.toSummary(entry)] : []
      })
    })
  }

  /**
   * 从内存索引和摘要缓存中永久删除一组会话并原子写盘。
   * Pi session 文件的物理删除由调用方负责。
   *
   * @param sessionIds - 要删除的会话标识。
   * @returns 无返回值。
   * @throws 当索引写入失败时，Promise 会 reject。
   */
  async deleteSessions(sessionIds: readonly string[]): Promise<void> {
    await this.commitMutation((draft) => {
      for (const sessionId of sessionIds) {
        draft.delete(sessionId)
      }
    })
  }

  /**
   * 在会话索引中新增或更新一条执行尝试记录（最多保留最近 20 条），
   * 并同步写入本次运行状态变更，一次调用只落盘一次。
   *
   * 执行记录与它伴随的会话状态（running/completed/cancelled/failed）总是
   * 成对出现，收敛到本方法是执行记录唯一的写入点。
   *
   * @param sessionId - 所属会话标识。
   * @param attempt - 要持久化的执行尝试记录。
   * @param sessionUpdate - 与本次尝试同时生效的会话展示状态。
   * @returns 无返回值。
   * @throws 当会话索引不存在或写入失败时，Promise 会 reject。
   */
  async upsertAttempt(
    sessionId: string,
    attempt: PersistedAttemptEntry,
    sessionUpdate: AttemptSessionUpdate,
  ): Promise<void> {
    await this.commitMutation((draft) => {
      const currentEntry = this.requireEntry(draft, sessionId)
      const existingAttempts = currentEntry.attempts ?? []
      const existingIndex = existingAttempts.findIndex(
        (candidate) => candidate.attemptId === attempt.attemptId,
      )
      const nextAttempts =
        existingIndex >= 0
          ? [
              ...existingAttempts.slice(0, existingIndex),
              attempt,
              ...existingAttempts.slice(existingIndex + 1),
            ]
          : [...existingAttempts, attempt]

      this.updateEntry(draft, sessionId, {
        attempts: nextAttempts.slice(-20),
        status: sessionUpdate.status,
        updatedAt: sessionUpdate.updatedAt,
        ...(sessionUpdate.lastMessagePreview !== undefined
          ? { lastMessagePreview: sessionUpdate.lastMessagePreview }
          : {}),
      })
    })
  }

  /** 原子更新索引与摘要中的运行状态并落盘。 */
  async setState(
    sessionId: string,
    state: AgentRunState,
    updatedAt: string,
  ): Promise<AgentSessionSummary> {
    return this.commitMutation((draft) =>
      this.toSummary(
        this.updateEntry(draft, sessionId, { status: state, updatedAt }),
      ),
    )
  }

  /** 持久化当前会话的 Provider 与 Model。 */
  async setModel(
    sessionId: string,
    provider: string,
    model: string,
  ): Promise<void> {
    await this.commitMutation((draft) => {
      this.updateEntry(draft, sessionId, { provider, model })
    })
  }

  /** 持久化当前会话的 Thinking Level。 */
  async setThinkingLevel(sessionId: string, thinkingLevel: string): Promise<void> {
    await this.commitMutation((draft) => {
      this.updateEntry(draft, sessionId, { thinkingLevel })
    })
  }
}
