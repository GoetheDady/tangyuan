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
  async load(): Promise<PersistedSessionIndexEntry[]> {
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
    this.replaceAll(entries)
    await this.write()
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
  async write(): Promise<void> {
    const indexPath = this.layout.sessionIndex()
    const entries = [...this.sessionIndex.values()].sort((left, right) =>
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
   * 判断指定会话的摘要是否已加载到内存。
   *
   * @param sessionId - 会话标识。
   * @returns 已加载返回 true。
   */
  hasSummary(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  /**
   * 读取指定会话摘要；不存在时返回 undefined。
   *
   * @param sessionId - 会话标识。
   * @returns 会话摘要或 undefined。
   */
  getSummary(sessionId: string): AgentSessionSummary | undefined {
    return this.sessions.get(sessionId)
  }

  /**
   * 列出指定 Agent 的会话摘要，按更新时间倒序。
   *
   * @param agentId - Agent 标识。
   * @param includeArchived - 是否包含已归档会话。
   * @returns 该 Agent 的会话摘要列表。
   */
  listSummaries(
    agentId: string,
    includeArchived = false,
  ): AgentSessionSummary[] {
    return [...this.sessions.values()]
      .filter(
        (session) =>
          session.agentId === agentId &&
          (includeArchived || session.archivedAt === undefined),
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  /**
   * 读取已加载的单个索引条目；不存在时返回 undefined。
   *
   * @param sessionId - 会话标识。
   * @returns 索引条目或 undefined。
   */
  getEntryOrNull(sessionId: string): PersistedSessionIndexEntry | undefined {
    return this.sessionIndex.get(sessionId)
  }

  /**
   * 读取已加载的单个索引条目，不存在时抛错。
   *
   * @param sessionId - 会话标识。
   * @returns 对应索引条目。
   * @throws 当索引条目不存在时抛出 AgentRuntimeError。
   */
  getEntry(sessionId: string): PersistedSessionIndexEntry {
    const indexEntry = this.sessionIndex.get(sessionId)

    if (!indexEntry) {
      throw new AgentRuntimeError({
        code: 'session-not-found',
        message: `找不到会话 ${sessionId} 的本地索引。`,
        recoverable: true,
      })
    }

    return indexEntry
  }

  /**
   * 读取指定会话已持久化的执行尝试记录。
   *
   * @param sessionId - 会话标识。
   * @returns 执行尝试列表；无记录时返回空数组。
   */
  getAttempts(sessionId: string): PersistedAttemptEntry[] {
    const entry = this.sessionIndex.get(sessionId)
    return entry?.attempts ?? []
  }

  /**
   * 新增一个会话的索引条目与派生摘要（不写盘，由调用方统一编排持久化）。
   *
   * @param entry - 新会话的索引条目。
   * @returns 派生出的会话摘要。
   */
  addSession(entry: PersistedSessionIndexEntry): AgentSessionSummary {
    this.sessionIndex.set(entry.sessionId, entry)
    const summary = this.toSummary(entry)
    this.sessions.set(entry.sessionId, summary)
    return summary
  }

  /**
   * 更新单个会话索引条目并同步会话摘要缓存，随后写盘。
   *
   * @param sessionId - 需要更新的会话标识。
   * @param patch - 要覆盖到索引条目上的字段。
   * @returns 更新后的索引条目。
   * @throws 当会话索引不存在时抛出 AgentRuntimeError。
   */
  async updateEntry(
    sessionId: string,
    patch: Partial<PersistedSessionIndexEntry>,
  ): Promise<PersistedSessionIndexEntry> {
    const currentEntry = this.getEntry(sessionId)
    const nextEntry = {
      ...currentEntry,
      ...patch,
    }
    this.sessionIndex.set(sessionId, nextEntry)
    this.sessions.set(sessionId, this.toSummary(nextEntry))
    await this.write()

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
    const entries = sessionIds.map((sessionId) => this.getEntry(sessionId))

    for (const entry of entries) {
      const nextEntry: PersistedSessionIndexEntry = {
        ...entry,
        ...(archivedAt === null ? {} : { archivedAt }),
      }

      if (archivedAt === null) {
        delete nextEntry.archivedAt
      }

      this.sessionIndex.set(entry.sessionId, nextEntry)
      this.sessions.set(entry.sessionId, this.toSummary(nextEntry))
    }

    await this.write()
    return sessionIds.flatMap((sessionId) => {
      const summary = this.sessions.get(sessionId)
      return summary ? [summary] : []
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
    for (const sessionId of sessionIds) {
      this.sessionIndex.delete(sessionId)
      this.sessions.delete(sessionId)
    }

    await this.write()
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
    const currentEntry = this.getEntry(sessionId)
    const existingAttempts = currentEntry.attempts ?? []
    const existingIndex = existingAttempts.findIndex(
      (a) => a.attemptId === attempt.attemptId,
    )

    const nextAttempts =
      existingIndex >= 0
        ? [
            ...existingAttempts.slice(0, existingIndex),
            attempt,
            ...existingAttempts.slice(existingIndex + 1),
          ]
        : [...existingAttempts, attempt]

    // 只保留最近 20 条，避免无限增长
    const trimmedAttempts = nextAttempts.slice(-20)

    await this.updateEntry(sessionId, {
      attempts: trimmedAttempts,
      status: sessionUpdate.status,
      updatedAt: sessionUpdate.updatedAt,
      ...(sessionUpdate.lastMessagePreview !== undefined
        ? { lastMessagePreview: sessionUpdate.lastMessagePreview }
        : {}),
    })
  }

  /**
   * 更新会话摘要的运行状态（仅改数据，不广播事件）。
   *
   * @param sessionId - 会话标识。
   * @param state - 新的运行状态。
   * @param updatedAt - 更新时间。
   * @returns 更新后的会话摘要。
   * @throws 当会话摘要不存在时抛出 AgentRuntimeError。
   */
  setSummaryState(
    sessionId: string,
    state: AgentRunState,
    updatedAt: string,
  ): AgentSessionSummary {
    const session = this.sessions.get(sessionId)

    if (!session) {
      throw new AgentRuntimeError({
        code: 'session-not-found',
        message: `找不到会话 ${sessionId}。`,
        recoverable: true,
      })
    }

    const nextSession = {
      ...session,
      state,
      updatedAt,
    }
    this.sessions.set(sessionId, nextSession)
    return nextSession
  }
}
